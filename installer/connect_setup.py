r"""Guided setup for the Tailscale connection mode (Setup_Tailscale.bat).

    env\Scripts\python.exe installer\connect_setup.py tailscale [--port 7862]

It is a short checklist, in the terminal and on a local progress page in the browser. A step is polled every few seconds until it is done, then the next one starts. After about
10 minutes without progress the step offers "press Enter to retry". Exit code 0 = READY, 1 = gave up.

Only the standard library is used. The parsing and decision functions are pure so tests/test_connect_setup.py can feed them
fixtures. Environment variables for testing without touching the real setup (all optional):
    ACCIO_SETUP_TIMEOUT / ACCIO_SETUP_INTERVAL   seconds (defaults 600 / 3)
    ACCIO_TAILSCALE_BIN                          use this program instead of the installed tailscale.exe
    ACCIO_SETUP_NO_PAGE=1                        no browser progress page (same as --no-page)
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

sys.path.insert(0, str(Path(__file__).resolve().parent))
from setup_page import GuidePage  # noqa: E402

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

    def __init__(self, title: str, steps: list[str], page: GuidePage | None = None):
        self.title, self.steps, self.page = title, steps, page
        self.status = ["todo"] * len(steps)
        if os.name == "nt":
            os.system("")  # enables ANSI escapes in the Windows console

    def set(self, index: int, status: str) -> None:
        """Record a step change and print just that line (`n/total`); the whole list is printed at the start and the end."""
        self.status[index] = status
        print(f"  {self.MARK[status]} {index + 1}/{len(self.steps)} {self.steps[index]}" + ("  ..." if status == "wait" else ""), flush=True)
        if self.page:
            self.page.update(status=list(self.status), hint=None)  # the instruction belongs to the step that was waiting

    def hint(self, title: str, text: str, link: str | None = None, button: str | None = None) -> None:
        """What to do at the waiting step: printed in the terminal and shown on the page (with a button for the link)."""
        say(f"      {title}")
        for line in text.split("\n"):
            say(f"      {line}")
        if link:
            say(f"      Link: {link}")
        if self.page:
            self.page.update(hint={"title": title, "text": text, "link": link, "button": button})
        elif link:  # no page: open the link for the user
            try:
                webbrowser.open(link)
            except Exception:  # noqa: BLE001 - opening a browser is a courtesy only
                pass

    def show(self) -> None:
        print()
        print(f"  {self.title}")
        for text, st in zip(self.steps, self.status):
            print(f"   {self.MARK[st]} {text}" + ("   <- waiting" if st == "wait" else ""))
        print(flush=True)


def say(text: str = "") -> None:
    print(text, flush=True)


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


STEPS = [
    "Tailscale is installed",
    "Signed in to Tailscale",
    "This PC has a machine name (MagicDNS)",
    "Serve and HTTPS certificates are enabled on your tailnet",
    "Address ready",
]


def setup_tailscale(port: int, show_page: bool = True) -> int:
    page = GuidePage(STEPS) if show_page and not os.environ.get("ACCIO_SETUP_NO_PAGE") else None
    if page:
        url = page.start()
        say(f"Progress page: {url}  (opening it in your browser)")
        try:
            webbrowser.open(url)
        except Exception:  # noqa: BLE001 - the terminal checklist works without it
            pass
    try:
        return _setup_tailscale(port, Checklist("Tailscale (private link, only your own devices)", STEPS, page), page)
    finally:
        if page:
            time.sleep(2 * 2)  # let an open page poll the final state once
            page.stop()


def _fail(cl: Checklist, page: GuidePage | None, index: int, why: str) -> int:
    cl.set(index, "fail")
    if page:
        page.update(failed=why)
    return 1


def _setup_tailscale(port: int, cl: Checklist, page: GuidePage | None) -> int:
    again = "Run Setup_Tailscale.bat again to continue where it stopped."
    cl.show()

    # 1. installed
    cl.set(0, "wait")
    binary = find_tailscale()
    if not binary:
        say("      Tailscale is not installed. Trying winget (Windows asks for permission, click Yes)...")
        cl.hint("Installing Tailscale",
                "Trying to install it automatically. If Windows asks for permission, click Yes.\n"
                "If that does not work, download it from the button and run the installer.\n"
                "This page moves on by itself once Tailscale is installed.",
                LINKS["tailscale_download"], "Download Tailscale")
        if shutil.which("winget") and not os.environ.get("ACCIO_SETUP_NO_WINGET"):
            code, out = run(["winget", "install", "--id", "Tailscale.Tailscale", "-e", "--silent",
                             "--accept-package-agreements", "--accept-source-agreements"], 600)
            if code != 0:
                say(f"      winget did not finish the install ({(out.splitlines() or ['no answer'])[-1][:150]}).")
        else:
            say("      winget is not available (or turned off) here.")
        binary = poll(find_tailscale, "tailscale.exe to appear")
        if not binary:
            return _fail(cl, page, 0, "Tailscale was not installed. " + again)
    cl.set(0, "done")
    say(f"      Found: {binary}")

    # 2. signed in
    cl.set(1, "wait")
    kind, _ = tailscale_login_state(ts_status(binary))
    if kind != "ok":
        with tempfile.TemporaryFile() as up_out:
            login = subprocess.Popen([binary, "up"], stdin=subprocess.DEVNULL, creationflags=NO_WINDOW,
                                     stdout=up_out, stderr=subprocess.STDOUT)
            shown = False

            def signed_in() -> bool:
                nonlocal shown
                if not shown:  # `tailscale up` prints the sign-in link a moment after it starts
                    up_out.seek(0)
                    link = LOGIN_LINK.search(up_out.read().decode("utf-8", "replace"))
                    if link:
                        shown = True
                        cl.hint("Sign in to Tailscale",
                                "A sign-in page opens in your browser (or use the button).\n"
                                "Sign in with your Google, Microsoft, Apple or GitHub account and approve this PC.\n"
                                "No account yet? Creating one there is free.", link.group(0), "Sign in to Tailscale")
                return tailscale_login_state(ts_status(binary))[0] == "ok"

            cl.hint("Sign in to Tailscale", "Waiting for the Tailscale sign-in link...")
            try:
                ok = poll(signed_in, "you to sign in to Tailscale")
            finally:
                if login.poll() is None:
                    login.terminate()
        if not ok:
            return _fail(cl, page, 1, "Tailscale was not signed in. " + again)
    cl.set(1, "done")

    # 3. machine name
    cl.set(2, "wait")
    dns = tailscale_dns_name(ts_status(binary))
    if not dns:
        cl.hint("Turn on MagicDNS",
                "Tailscale did not give this PC a name. Open the DNS page in the Tailscale admin console "
                "(as the tailnet admin) and turn on MagicDNS.\nThis page moves on by itself.",
                LINKS["tailscale_admin_dns"], "Open the DNS page")
        dns = poll(lambda: tailscale_dns_name(ts_status(binary)), "MagicDNS (a machine name for this PC)")
        if not dns:
            return _fail(cl, page, 2, "MagicDNS stayed off. " + again)
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
                return _fail(cl, page, 3, "Left your existing Tailscale Serve entry alone. " + again)
        told: set[str] = set()

        def probe() -> bool:
            code, out = run([binary, "serve", "--bg", "--https=443", target], 20)
            kind, link = classify_serve_output(code, out)
            run([binary, "serve", "--https=443", "off"], 30)  # only that entry
            if kind == "ok":
                return True
            if kind == "serve_disabled" and "serve" not in told:
                told.add("serve")
                cl.hint("Enable Tailscale Serve",
                        "Serve is not turned on for your tailnet yet. Open the page, sign in as the tailnet admin "
                        "and click Enable.\nThis page moves on by itself.",
                        link or LINKS["tailscale_admin_machines"], "Open the Serve page")
            elif kind == "https_off" and "https" not in told:
                told.add("https")
                cl.hint("Enable HTTPS certificates",
                        "Open the DNS page, scroll to HTTPS Certificates and click Enable HTTPS.\n"
                        "This page moves on by itself.", LINKS["tailscale_admin_dns"], "Open the DNS page")
            elif kind == "other" and "other" not in told:
                told.add("other")
                say(f"      tailscale serve answered: {out.strip()[:300] or 'nothing'}")
            return False

        cl.hint("Checking Serve and HTTPS", "Testing that Tailscale can publish Accio. This takes a few seconds.")
        if not poll(probe, "Serve and HTTPS certificates to be enabled"):
            return _fail(cl, page, 3, "Serve or HTTPS certificates are still off. " + again)
    cl.set(3, "done")

    # 5. address
    cl.set(4, "done")
    cl.show()
    nxt = "Start Accio with Run_Accio.bat and pick option 4 (Tailscale)."
    if page:
        page.update(done=True, address=f"https://{dns}", next=nxt)
    say("=" * 64)
    say("READY")
    say("=" * 64)
    say(nxt)
    say(f"Your address (only devices signed into your Tailscale account): https://{dns}")
    if page:
        say("You can now close the browser page.")
    say("=" * 64)
    return 0


def main(argv: list[str]) -> int:
    mode = argv[1] if len(argv) > 1 else ""
    port = 7862
    show_page = "--no-page" not in argv
    if "--port" in argv:
        try:
            port = int(argv[argv.index("--port") + 1])
        except (ValueError, IndexError):
            say("Bad --port value.")
            return 2
    try:
        if mode == "tailscale":
            return setup_tailscale(port, show_page)
    except KeyboardInterrupt:
        say("\nStopped.")
        return 1
    say("Usage: connect_setup.py tailscale [--port N] [--no-page]")
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
