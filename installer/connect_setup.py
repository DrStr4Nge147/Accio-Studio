"""Guided setup for the zrok and Tailscale connection modes (Setup_Zrok.bat, Setup_Tailscale.bat).

    env\\Scripts\\python.exe installer\\connect_setup.py zrok [--port 7862]
    env\\Scripts\\python.exe installer\\connect_setup.py tailscale [--port 7862]

Each mode is a short checklist. A step is polled every few seconds until it is done, then the next one starts. After about
10 minutes without progress the step offers "press Enter to retry". Exit code 0 = READY, 1 = gave up.

Only the standard library is used. The parsing and decision functions are pure so tests/test_connect_setup.py can feed them
fixtures. Environment variables for testing without touching the real setup (all optional):
    ACCIO_SETUP_TIMEOUT / ACCIO_SETUP_INTERVAL   seconds (defaults 600 / 3)
    ACCIO_TAILSCALE_BIN                          use this program instead of the installed tailscale.exe
    ACCIO_ZROK_BIN / ACCIO_ZROK_SHARE_FILE       use another zrok2 program / another .zrok_share file
    ACCIO_SETUP_NO_WINGET=1                      never try winget (go straight to the download link)
    USERPROFILE                                  where zrok2 keeps its environment (~/.zrok2)
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
import webbrowser
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).resolve().parent.parent

# Every link the setup prints or opens. Change them here.
LINKS = {
    "tailscale_download": "https://tailscale.com/download",
    "tailscale_admin_dns": "https://login.tailscale.com/admin/dns",
    "tailscale_admin_machines": "https://login.tailscale.com/admin/machines",
    "zrok_site": "https://zrok.io",
    "zrok_docs_install": "https://docs.zrok.io/docs/guides/install/",
    "zrok_latest_api": "https://api.github.com/repos/openziti/zrok/releases/latest",
    "zrok_download": "https://github.com/openziti/zrok/releases/download/v{version}/zrok_{version}_windows_amd64.tar.gz",
    "zrok_checksums": "https://github.com/openziti/zrok/releases/download/v{version}/checksums.sha256.txt",
}

ZROK_PINNED = "2.0.8"  # used when GitHub cannot be reached; zrok v1 clients are refused by the hosted zrok.io since v2
ZROK_EXE = Path(os.environ.get("ACCIO_ZROK_BIN") or ROOT / "zrok2.exe")
ZROK_SHARE_FILE = Path(os.environ.get("ACCIO_ZROK_SHARE_FILE") or ROOT / ".zrok_share")
ZROK_NAMESPACE = "public"
ZROK_NAME = re.compile(r"^[A-Za-z0-9]{4,32}$")
TAILSCALE_DEFAULT = Path(r"C:\Program Files\Tailscale\tailscale.exe")
LOGIN_LINK = re.compile(r"https://login\.tailscale\.com/\S+")
NO_WINDOW = 0x08000000 if os.name == "nt" else 0

TIMEOUT = float(os.environ.get("ACCIO_SETUP_TIMEOUT", 600))
INTERVAL = float(os.environ.get("ACCIO_SETUP_INTERVAL", 3))


# ------------------------------------------------------------------------------------------------ pure helpers

def clean_token(raw: str) -> str:
    """The zrok enable token from what the user pasted: strips whitespace, quotes and a leading `zrok enable` / `zrok2 enable`."""
    text = raw.strip().strip("\"'")
    text = re.sub(r"^zrok2?(\.exe)?\s+enable\s+", "", text, flags=re.I)
    return text.strip().strip("\"'")


def valid_token(token: str) -> bool:
    return bool(re.fullmatch(r"[A-Za-z0-9_-]{4,64}", token))


def valid_name(name: str) -> bool:
    return bool(ZROK_NAME.fullmatch(name))


def version_tuple(text: str) -> tuple[int, ...] | None:
    """(2, 0, 8) from 'v2.0.8 [7d46bbfd]' or '2.0.8'; None when there is no version in the text."""
    m = re.search(r"v?(\d+)\.(\d+)\.(\d+)", text)
    return tuple(int(x) for x in m.groups()) if m else None


def pick_zrok_version(latest_tag: str | None) -> str:
    """The version to install: the latest release when it is a v2.x, else the pinned one."""
    t = version_tuple(latest_tag or "")
    if t and t[0] == 2:
        return ".".join(map(str, t))
    return ZROK_PINNED


def zrok_is_current(version_output: str, wanted: str) -> bool:
    have, want = version_tuple(version_output), version_tuple(wanted)
    return bool(have and want and have[0] == want[0] and have >= want)


def parse_checksums(text: str) -> dict[str, str]:
    """{file name: sha256} from a `sha256sum` style list."""
    out: dict[str, str] = {}
    for line in text.splitlines():
        parts = line.split()
        if len(parts) == 2 and re.fullmatch(r"[0-9a-fA-F]{64}", parts[0]):
            out[parts[1].lstrip("*").removeprefix("./")] = parts[0].lower()
    return out


def zrok_names(names_json: str) -> list[dict]:
    """The name rows of `zrok2 list names --json` (a list, or an object holding one); [] when it cannot be read."""
    try:
        data = json.loads(names_json)
    except (ValueError, TypeError):
        return []
    if isinstance(data, dict):
        for key in ("names", "items", "data"):
            if isinstance(data.get(key), list):
                data = data[key]
                break
        else:
            return []
    return [row for row in data if isinstance(row, dict)] if isinstance(data, list) else []


def find_zrok_name(rows: list[dict], name: str, namespace: str = ZROK_NAMESPACE) -> dict | None:
    for row in rows:
        row_name = str(row.get("name", row.get("Name", ""))).lower()
        space = str(row.get("namespaceToken", row.get("namespace", row.get("Namespace", namespace)))).lower()
        if row_name == name.lower() and space in (namespace.lower(), ""):
            return row
    return None


def zrok_url(row: dict | None, name: str) -> str:
    """The public address of a name: the url zrok reports, else the usual shape."""
    url = str((row or {}).get("url", (row or {}).get("Url", ""))).strip()
    if url.startswith("https://"):
        return url.rstrip("/")
    if url:
        return "https://" + url.rstrip("/")
    return f"https://{name.lower()}.shares.zrok.io"


def classify_create_name_failure(output: str) -> str:
    """One plain sentence for why `zrok2 create name` failed."""
    low = output.lower()
    if any(w in low for w in ("already", "exists", "taken", "conflict", "409")):
        return "That name is already taken on zrok. Pick another one."
    if any(w in low for w in ("profan", "invalid", "not allowed", "400")):
        return "zrok refused that name (invalid or not allowed). Pick another one."
    if any(w in low for w in ("unauthorized", "401", "token", "not enabled", "no environment")):
        return "This PC is not linked to your zrok account any more. Run this setup again."
    return "zrok could not reserve the name: " + (output.strip().splitlines()[-1][:200] if output.strip() else "no answer") + "."


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


def ask(prompt: str) -> str:
    """input() without a byte-order mark, which a piped console can put in front of the first line."""
    return input(prompt).replace(chr(0xFEFF), "")


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


# ------------------------------------------------------------------------------------------------ zrok

def zrok_env_file() -> Path:
    return Path(os.environ.get("USERPROFILE") or Path.home()) / ".zrok2" / "environment.json"


def latest_zrok_tag() -> str | None:
    try:
        req = urllib.request.Request(LINKS["zrok_latest_api"], headers={"User-Agent": "AccioStudio-setup"})
        with urllib.request.urlopen(req, timeout=15) as r:
            return str(json.load(r).get("tag_name", ""))
    except (OSError, ValueError):
        return None


def download(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "AccioStudio-setup"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def install_zrok() -> str | None:
    """Download zrok2.exe next to the app. Returns an error sentence, or None on success."""
    version = pick_zrok_version(latest_zrok_tag())
    say(f"      Downloading zrok v{version} ...")
    asset = f"zrok_{version}_windows_amd64.tar.gz"
    try:
        blob = download(LINKS["zrok_download"].format(version=version))
    except OSError as e:
        return f"Could not download zrok ({e}). Check the internet connection and try again."
    try:
        want = parse_checksums(download(LINKS["zrok_checksums"].format(version=version)).decode()).get(asset)
    except OSError:
        want = None
    if want and hashlib.sha256(blob).hexdigest() != want:
        return "The zrok download failed its checksum check. Try again."
    if not want:
        say("      (no checksum list available, skipped the checksum check)")
    try:
        with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as tar:
            member = next((m for m in tar.getmembers() if m.isfile() and Path(m.name).name == "zrok2.exe"), None)
            data = tar.extractfile(member).read() if member else None
    except (tarfile.TarError, OSError):
        data = None
    if not data:
        return "zrok2.exe was not found in the download."
    part = ZROK_EXE.with_suffix(".part")
    part.write_bytes(data)
    part.replace(ZROK_EXE)
    return None


def zrok_version_output() -> str:
    if not ZROK_EXE.is_file():
        return ""
    return run([str(ZROK_EXE), "version"], 20)[1]


def zrok_list_names() -> list[dict]:
    code, out = run([str(ZROK_EXE), "list", "names", "--json"], 30)
    return zrok_names(out) if code == 0 else []


def setup_zrok(port: int) -> int:
    cl = Checklist("zrok (public link that stays the same)", [
        "zrok2.exe is here and current",
        "This PC is linked to your zrok account",
        "Accio's name is reserved",
        "Address ready",
    ])
    cl.show()

    # 1. zrok2.exe
    cl.set(0, "wait")
    old = ROOT / "zrok.exe"
    if old.is_file():
        say("      Removing the old zrok v1 program from this folder (zrok.io no longer accepts it).")
        old.unlink(missing_ok=True)
    tag = latest_zrok_tag()
    wanted = pick_zrok_version(tag)
    if not zrok_is_current(zrok_version_output(), wanted):
        while True:
            problem = install_zrok()
            if not problem:
                break
            say(f"      {problem}")
            try:
                input("      Press Enter to retry, or close this window to stop. ")
            except EOFError:
                cl.set(0, "fail")
                return 1
    if not zrok_version_output():
        cl.set(0, "fail")
        say("      zrok2.exe does not start. Delete it and run this again.")
        return 1
    cl.set(0, "done")
    say(f"      {zrok_version_output().splitlines()[-1].strip()}")

    # 2. account linked
    cl.set(1, "wait")
    env = zrok_env_file()
    while not env.is_file():
        say("      Create a free zrok account (or sign in), then copy your enable token from the dashboard.")
        open_link(LINKS["zrok_site"])
        try:
            raw = ask("      Paste the token here (or just press Enter if you link it in another window): ")
        except EOFError:
            cl.set(1, "fail")
            return 1
        if raw.strip():
            token = clean_token(raw)
            if not valid_token(token):
                say("      That does not look like a zrok token (letters, digits, - and _ only). Copy it again.")
                continue
            code, out = run([str(ZROK_EXE), "enable", token, "--headless"], 120)
            if code != 0 or not env.is_file():
                say("      [ERROR] zrok enable failed" + (f": {out.splitlines()[-1][:200]}" if out else "."))
                say("      Check the token (copy it again from the dashboard) and try again.")
                continue
        elif not poll(env.is_file, "this PC to be linked (run `zrok2 enable <token>` in another window)"):
            cl.set(1, "fail")
            return 1
    cl.set(1, "done")

    # 3. name reserved
    cl.set(2, "wait")
    saved = ""
    try:
        saved = ZROK_SHARE_FILE.read_text(encoding="utf-8").strip()
    except OSError:
        pass
    name, row = "", None
    if valid_name(saved):
        row = find_zrok_name(zrok_list_names(), saved)
        if row:
            say(f"      Accio already has the reserved name {saved}.")
            name = saved
        else:
            say(f"      The saved name {saved} is not reserved on your account (any more).")
    while not name:
        say("      Pick Accio's own name: letters and digits only, 4 to 32 characters. Use a NEW name, not one used by another app.")
        try:
            wish = ask("      Name for Accio [e.g. myaccio]: ").strip()
        except EOFError:
            cl.set(2, "fail")
            return 1
        if not valid_name(wish):
            say("      Not valid: use letters and digits only, 4 to 32 characters.")
            continue
        code, out = run([str(ZROK_EXE), "create", "name", "-n", ZROK_NAMESPACE, wish], 60)
        row = find_zrok_name(zrok_list_names(), wish)
        if code != 0 or not row:
            say("      [ERROR] " + classify_create_name_failure(out))
            continue
        name = wish
    ZROK_SHARE_FILE.write_text(name + "\n", encoding="utf-8")
    cl.set(2, "done")

    # 4. address
    cl.set(3, "done")
    cl.show()
    say("=" * 64)
    say("READY")
    say("=" * 64)
    say("Start Accio with Run_Accio-zrok-only.bat, or pick option 3 in Run_Accio.bat.")
    say(f"Your address: {zrok_url(row, name)}  (shown with a QR code when it starts)")
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
        if mode == "zrok":
            return setup_zrok(port)
        if mode == "tailscale":
            return setup_tailscale(port)
    except KeyboardInterrupt:
        say("\nStopped.")
        return 1
    say("Usage: connect_setup.py zrok|tailscale [--port N]")
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
