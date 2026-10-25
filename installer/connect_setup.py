"""Guided setup for the Tailscale connection mode (Setup_Tailscale.bat).

    env\Scripts\python.exe installer\connect_setup.py tailscale [--port 7862]

It is a short checklist. A step is polled every few seconds until it is done, then the next one starts. After about
10 minutes without progress the step offers "press Enter to retry". Exit code 0 = READY, 1 = gave up.

Only the standard library is used. The parsing and decision functions are pure so tests/test_connect_setup.py can feed them
fixtures. Environment variables for testing without touching the real setup (all optional):
    ACCIO_SETUP_TIMEOUT / ACCIO_SETUP_INTERVAL   seconds (defaults 600 / 3)
    ACCIO_TAILSCALE_BIN                          use this program instead of the installed tailscale.exe
    ACCIO_SETUP_NO_WINGET=1                      never try winget (go straight to the download link)
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import webbrowser
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).resolve().parent.parent

# Every link the setup prints or opens. Change them here.
LINKS = {
    "tailscale_download": "https://tailscale.com/download",
    "tailscale_admin_dns": "https://login.tailscale.com/admin/dns",
    "tailscale_admin_machines": "https://login.tailscale.com/admin/machines",
}

TAILSCALE_DEFAULT = Path(r"C:\Program Files\Tailscale\tailscale.exe")
LOGIN_LINK = re.compile(r"https://login\.tailscale\.com/\S+")
NO_WINDOW = 0x08000000 if os.name == "nt" else 0

TIMEOUT = float(os.environ.get("ACCIO_SETUP_TIMEOUT", 600))
INTERVAL = float(os.environ.get("ACCIO_SETUP_INTERVAL", 3))


# ------------------------------------------------------------------------------------------------ pure helpers

def tailscale_login_state(status: dict) -> tuple[str, str]:
    """('ok'|'login'|'stopped'|'other', plain sentence) from `tailscale status --json`."""
    state = status.get("BackendState")
    if state == "Running":
        return "ok", "Signed in."
    if state in ("NeedsLogin", "NoState", "NeedsMachineAuth", None):
        return "login", "Not signed in yet."
    if state == "Stopped":
        return "stopped", "Tailscale is turned off."
    return "other", f"Tailscale reports: {state}."


def tailscale_dns_name(status: dict) -> str:
    return str(status.get("Self", {}).get("DNSName", "")).rstrip(".")


def classify_serve_output(returncode: int | None, output: str) -> tuple[str, str | None]:
    """('ok'|'serve_disabled'|'https_off'|'other', link). returncode None = the probe never finished (killed after the limit)."""
    if returncode == 0:
        return "ok", None
    link = LOGIN_LINK.search(output)
    if link:
        return "serve_disabled", link.group(0)
    low = output.lower()
    if "https" in low or "cert" in low:
        return "https_off", None
    if returncode is None and not output.strip():
        return "serve_disabled", None  # it waits forever, silently, when Serve is not enabled
    return "other", None


def serve_443_target(serve_status_json: str) -> str | None:
    """The proxy target currently published on port 443 (from `tailscale serve status --json`), or None."""
    try:
        web = json.loads(serve_status_json or "{}").get("Web", {})
    except (ValueError, AttributeError):
        return None
    for host, cfg in web.items():
        if str(host).endswith(":443"):
            for handler in cfg.get("Handlers", {}).values():
                if handler.get("Proxy"):
                    return str(handler["Proxy"])
    return None


# ------------------------------------------------------------------------------------------------ terminal UI

class Checklist:
    """A short list of steps with live status. Reprinted whenever a step changes."""

    MARK = {"todo": "[ ]", "wait": "[..]", "done": "[OK]", "fail": "[!!]"}

    def __init__(self, title: str, steps: list[str]):
        self.title, self.steps = title, steps
        self.status = ["todo"] * len(steps)
        if os.name == "nt":
            os.system("")  # enables ANSI escapes in the Windows console

    def set(self, index: int, status: str) -> None:
        """Record a step change and print just that line (`n/total`); the whole list is printed at the start and the end."""
        self.status[index] = status
        print(f"  {self.MARK[status]} {index + 1}/{len(self.steps)} {self.steps[index]}" + ("  ..." if status == "wait" else ""), flush=True)

    def show(self) -> None:
        print()
        print(f"  {self.title}")
        for text, st in zip(self.steps, self.status):
            print(f"   {self.MARK[st]} {text}" + ("   <- waiting" if st == "wait" else ""))
        print(flush=True)


def say(text: str = "") -> None:
    print(text, flush=True)


def open_link(url: str) -> None:
    say(f"      Link: {url}")
    try:
        webbrowser.open(url)
    except Exception:  # noqa: BLE001 - opening a browser is a courtesy only
        pass


def poll(check: Callable[[], object], what: str, timeout: float | None = None, interval: float | None = None):
    """Call `check` every `interval` s until it returns something truthy. On timeout asks 'press Enter to retry'.

    Returns the truthy value, or None when the user does not retry (or there is no console to ask).
    """
    timeout = TIMEOUT if timeout is None else timeout
    interval = INTERVAL if interval is None else interval
    while True:
        deadline = time.monotonic() + timeout
        shown = False
        while True:
            result = check()
            if result:
                if shown:
                    say()
                return result
            if time.monotonic() >= deadline:
                break
            if not shown:
                say(f"      Waiting for: {what} (checking every {interval:g} s, Ctrl+C to stop)")
                shown = True
            else:
                print(".", end="", flush=True)
            time.sleep(interval)
        span = f"{timeout / 60:.0f} min" if timeout >= 60 else f"{timeout:g} s"
        say(f"\n      Timed out after {span} waiting for: {what}")
        try:
            input("      Press Enter to retry, or close this window to stop. ")
        except EOFError:
            return None


def run(cmd: list[str], timeout: float = 30) -> tuple[int | None, str]:
    """Run a program, returncode (None = killed on timeout) and its combined output. Output goes to a file so a child that
    outlives the kill cannot hold a pipe open."""
    with tempfile.TemporaryFile() as out:
        try:
            proc = subprocess.Popen(cmd, stdout=out, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, creationflags=NO_WINDOW)
        except OSError as e:
            return 127, str(e)
        try:
            code: int | None = proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
            code = None
        out.seek(0)
        return code, out.read().decode("utf-8", "replace").strip()


# ------------------------------------------------------------------------------------------------ Tailscale

def find_tailscale() -> str | None:
    override = os.environ.get("ACCIO_TAILSCALE_BIN")
    if override:
        return override if Path(override).is_file() else None
    return shutil.which("tailscale") or (str(TAILSCALE_DEFAULT) if TAILSCALE_DEFAULT.is_file() else None)


def ts_status(binary: str) -> dict:
    code, out = run([binary, "status", "--json"], 20)
    try:
        data = json.loads(out)
        return data if isinstance(data, dict) else {}
    except ValueError:
        return {}


def setup_tailscale(port: int) -> int:
    cl = Checklist("Tailscale (private link, only your own devices)", [
        "Tailscale is installed",
        "Signed in to Tailscale",
        "This PC has a machine name (MagicDNS)",
        "Serve and HTTPS certificates are enabled on your tailnet",
        "Address ready",
    ])
    cl.show()

    # 1. installed
    cl.set(0, "wait")
    binary = find_tailscale()
    if not binary:
        say("      Tailscale is not installed. Trying winget (Windows asks for permission, click Yes)...")
        if shutil.which("winget") and not os.environ.get("ACCIO_SETUP_NO_WINGET"):
            code, out = run(["winget", "install", "--id", "Tailscale.Tailscale", "-e", "--silent",
                             "--accept-package-agreements", "--accept-source-agreements"], 600)
            if code != 0:
                say(f"      winget did not finish the install ({(out.splitlines() or ['no answer'])[-1][:150]}).")
        else:
            say("      winget is not available (or turned off) here.")
        if not find_tailscale():
            say("      Install it by hand, then this window moves on by itself:")
            open_link(LINKS["tailscale_download"])
        binary = poll(find_tailscale, "tailscale.exe to appear")
        if not binary:
            cl.set(0, "fail")
            return 1
    cl.set(0, "done")
    say(f"      Found: {binary}")

    # 2. signed in
    cl.set(1, "wait")
    kind, _ = tailscale_login_state(ts_status(binary))
    if kind != "ok":
        say("      Opening the Tailscale sign-in in your browser. Finish signing in there.")
        login = subprocess.Popen([binary, "up"], stdin=subprocess.DEVNULL, creationflags=NO_WINDOW,
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            ok = poll(lambda: tailscale_login_state(ts_status(binary))[0] == "ok", "you to sign in to Tailscale")
        finally:
            if login.poll() is None:
                login.terminate()
        if not ok:
            cl.set(1, "fail")
            return 1
    cl.set(1, "done")

    # 3. machine name
    cl.set(2, "wait")
    dns = tailscale_dns_name(ts_status(binary))
    if not dns:
        say("      Tailscale did not report a name for this PC. Turn on MagicDNS in the admin console (DNS page):")
        open_link(LINKS["tailscale_admin_dns"])
        dns = poll(lambda: tailscale_dns_name(ts_status(binary)), "MagicDNS (a machine name for this PC)")
        if not dns:
            cl.set(2, "fail")
            return 1
    cl.set(2, "done")
    say(f"      Machine name: {dns}")

    # 4. serve + https
    cl.set(3, "wait")
    target = f"http://127.0.0.1:{port}"
    existing = serve_443_target(run([binary, "serve", "status", "--json"], 20)[1])
    if existing == target:
        say("      Accio is already published on this tailnet address, so Serve and HTTPS work.")
    else:
        if existing:
            say(f"      Port 443 of Tailscale Serve already points to {existing}.")
            say("      Testing here replaces that entry and switches it off afterwards.")
            if input("      Continue? [y/N]: ").strip().lower() != "y":
                cl.set(3, "fail")
                return 1
        told: set[str] = set()

        def probe() -> bool:
            code, out = run([binary, "serve", "--bg", "--https=443", target], 20)
            kind, link = classify_serve_output(code, out)
            run([binary, "serve", "--https=443", "off"], 30)  # only that entry
            if kind == "ok":
                return True
            if kind == "serve_disabled" and "serve" not in told:
                told.add("serve")
                say("      Serve is not enabled on your tailnet. Open this page as the tailnet admin and enable it:")
                open_link(link or LINKS["tailscale_admin_machines"])
            elif kind == "https_off" and "https" not in told:
                told.add("https")
                say("      HTTPS certificates are off. In the admin console go to DNS > HTTPS Certificates and enable them:")
                open_link(LINKS["tailscale_admin_dns"])
            elif kind == "other" and "other" not in told:
                told.add("other")
                say(f"      tailscale serve answered: {out.strip()[:300] or 'nothing'}")
            return False

        if not poll(probe, "Serve and HTTPS certificates to be enabled"):
            cl.set(3, "fail")
            return 1
    cl.set(3, "done")

    # 5. address
    cl.set(4, "done")
    cl.show()
    say("=" * 64)
    say("READY")
    say("=" * 64)
    say("Start Accio with Run_Accio.bat and pick option 5 (Tailscale).")
    say(f"Your address (only devices signed into your Tailscale account): https://{dns}")
    say("=" * 64)
    return 0


def main(argv: list[str]) -> int:
    mode = argv[1] if len(argv) > 1 else ""
    port = 7862
    if "--port" in argv:
        try:
            port = int(argv[argv.index("--port") + 1])
        except (ValueError, IndexError):
            say("Bad --port value.")
            return 2
    try:
        if mode == "tailscale":
            return setup_tailscale(port)
    except KeyboardInterrupt:
        say("\nStopped.")
        return 1
    say("Usage: connect_setup.py tailscale [--port N]")
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
