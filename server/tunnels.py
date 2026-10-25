"""Cloudflare quick tunnel and zrok share, run as background threads next to the server (APP_SPEC 9.2).

Both connect to the server on localhost, so the server itself can stay on 127.0.0.1. Each prints its public URL with an
ASCII QR code and records it in `state` so the settings page can show it too. zrok reconnects forever.

Tailscale (optional, never bundled: it needs a system-wide install) is different: `tailscale serve` publishes the port to
your private tailnet only, so just devices signed into your Tailscale account can open the address.
"""
from __future__ import annotations

import atexit
import io
import json
import re
import shutil
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from typing import Any

import httpx
import qrcode
import qrcode.image.svg

from config import ROOT

CLOUDFLARED = ROOT / "cloudflared.exe"
ZROK = ROOT / "zrok2.exe"  # zrok v2: the hosted zrok.io refuses v1 clients, and v2 renamed the program
ZROK_SHARE_FILE = ROOT / ".zrok_share"
CLOUDFLARED_URL = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
ZROK_NAME = re.compile(r"^[A-Za-z0-9]{4,32}$")
CLOUDFLARE_URL = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")
ZROK_URL = re.compile(r"https://[a-z0-9-]+\.shares?\.zrok\.io")
ZROK_NAMESPACE = "public"
TAILSCALE_DEFAULT = Path(r"C:\Program Files\Tailscale\tailscale.exe")
NO_WINDOW = 0x08000000  # CREATE_NO_WINDOW: no console flashing up for the child process

state: dict[str, Any] = {"mode": "local", "public_url": None, "status": "local"}


def qr_ascii(url: str) -> str:
    qr = qrcode.QRCode()
    qr.add_data(url)
    out = io.StringIO()
    qr.print_ascii(out=out)
    return out.getvalue()


def qr_svg_data_uri(url: str) -> str:
    """QR code as an SVG data URI (for an <img>; no scripting involved)."""
    import base64

    img = qrcode.make(url, image_factory=qrcode.image.svg.SvgPathImage, box_size=10, border=2)
    buf = io.BytesIO()
    img.save(buf)
    return "data:image/svg+xml;base64," + base64.b64encode(buf.getvalue()).decode()


def announce(label: str, url: str) -> None:
    print("\n" + "=" * 60)
    print(f"  {label}: {url}")
    print("=" * 60)
    print(qr_ascii(url))
    print("=" * 60 + "\n", flush=True)


def ensure_cloudflared() -> Path | None:
    if CLOUDFLARED.is_file():
        return CLOUDFLARED
    print("Downloading cloudflared (first Cloudflare use)...", flush=True)
    part = CLOUDFLARED.with_suffix(".part")
    try:
        with httpx.stream("GET", CLOUDFLARED_URL, follow_redirects=True, timeout=60) as r:
            r.raise_for_status()
            with part.open("wb") as f:
                for chunk in r.iter_bytes():
                    f.write(chunk)
        if part.stat().st_size < 1_000_000:  # an error page, not the program
            raise ValueError("download too small")
        part.replace(CLOUDFLARED)
    except (httpx.HTTPError, OSError, ValueError) as e:
        part.unlink(missing_ok=True)
        print(f"[ERROR] Could not download cloudflared ({e!r}). Check the connection and try again.", flush=True)
        return None
    print("cloudflared ready.", flush=True)
    return CLOUDFLARED


def run_cloudflare(port: int) -> None:
    binary = ensure_cloudflared()
    if not binary:
        state.update(mode="cloudflare", status="failed")
        return
    state.update(mode="cloudflare", status="starting")

    def work() -> None:
        while True:
            cmd = [str(binary), "tunnel", "--url", f"http://127.0.0.1:{port}", "--no-autoupdate"]
            try:
                proc = subprocess.Popen(
                    cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1, creationflags=NO_WINDOW
                )
                assert proc.stdout
                for line in proc.stdout:
                    match = CLOUDFLARE_URL.search(line)
                    if match and state["public_url"] != match.group(0):
                        state.update(public_url=match.group(0), status="up")
                        announce("CLOUDFLARE TUNNEL ACTIVE", match.group(0))
                state.update(public_url=None, status="reconnecting")
                print("Cloudflare tunnel closed; reconnecting in 5 s (the URL will change).", flush=True)
            except OSError as e:
                state["status"] = "failed"
                print(f"[ERROR] Could not start cloudflared: {e!r}. Retrying in 5 s.", flush=True)
            time.sleep(5)

    threading.Thread(target=work, daemon=True, name="cloudflare").start()


def reserved_name() -> str | None:
    """The zrok name saved by Setup_Zrok.bat, or None (then a random public share is used)."""
    try:
        name = ZROK_SHARE_FILE.read_text(encoding="utf-8").strip()
    except OSError:
        return None
    return name if ZROK_NAME.fullmatch(name) else None


def run_zrok(port: int) -> None:
    if not ZROK.is_file():
        state.update(mode="zrok", status="failed")
        print("\n[ERROR] zrok2.exe was not found next to the app. Run Setup_Zrok.bat first.\n", flush=True)
        return
    state.update(mode="zrok", status="starting")

    def work() -> None:
        while True:  # keep the share alive forever
            name = reserved_name()
            if name:
                cmd = [str(ZROK), "share", "public", f"http://127.0.0.1:{port}", "-n", f"{ZROK_NAMESPACE}:{name}", "--headless"]
            else:
                cmd = [str(ZROK), "share", "public", f"http://127.0.0.1:{port}", "--headless"]
            try:
                proc = subprocess.Popen(
                    cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1, creationflags=NO_WINDOW
                )
                assert proc.stdout
                for line in proc.stdout:
                    low = line.lower()
                    if "[error]" in low or "error:" in low:
                        print(f"zrok: {line.strip()}", flush=True)
                    match = ZROK_URL.search(line)
                    if match and state["public_url"] != match.group(0):
                        state.update(public_url=match.group(0), status="up")
                        announce("ZROK TUNNEL ACTIVE" + (" (RESERVED NAME)" if name else ""), match.group(0))
                state["status"] = "reconnecting"
                print("zrok share closed; reconnecting in 5 s...", flush=True)
            except OSError as e:
                state["status"] = "failed"
                print(f"[ERROR] Could not start zrok: {e!r}. Retrying in 5 s.", flush=True)
            time.sleep(5)

    threading.Thread(target=work, daemon=True, name="zrok").start()


# ---------------------------------------------------------------------------------------------- Tailscale

def find_tailscale() -> str | None:
    return shutil.which("tailscale") or (str(TAILSCALE_DEFAULT) if TAILSCALE_DEFAULT.is_file() else None)


def run_limited(cmd: list[str], timeout: float) -> tuple[int | None, str]:
    """Run a command with output going to a temp file, kill it after `timeout` s. (returncode or None, its output).

    A file instead of pipes: a child that keeps running would otherwise hold the pipes open and block us past the timeout.
    """
    with tempfile.TemporaryFile() as out:
        proc = subprocess.Popen(cmd, stdout=out, stderr=subprocess.STDOUT, creationflags=NO_WINDOW)
        try:
            code: int | None = proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            proc.kill()
            code = None
        out.seek(0)
        return code, out.read().decode("utf-8", "replace").strip()


def tailscale_status(binary: str) -> dict[str, Any]:
    out = subprocess.run([binary, "status", "--json"], capture_output=True, text=True, timeout=20, creationflags=NO_WINDOW)
    return json.loads(out.stdout or "{}")


def tailnet_url(status: dict[str, Any]) -> tuple[str | None, str | None]:
    """(https URL, problem). The problem is a user-facing sentence when this PC cannot serve on the tailnet."""
    if status.get("BackendState") != "Running":
        return None, "Tailscale is not connected. Open the Tailscale app and sign in."
    name = str(status.get("Self", {}).get("DNSName", "")).rstrip(".")
    if not name:
        return None, "Tailscale did not report this PC's name. Turn on MagicDNS in the Tailscale admin page."
    return f"https://{name}", None


def run_tailscale(port: int) -> None:
    """Publish the app to the private tailnet (HTTPS on 443) and print the address. Needs HTTPS enabled for the tailnet."""
    state.update(mode="tailscale", status="starting")
    binary = find_tailscale()
    if not binary:
        state["status"] = "failed"
        print("[ERROR] Tailscale is not installed. Get it from https://tailscale.com/download, sign in, then try again.", flush=True)
        return
    try:
        url, problem = tailnet_url(tailscale_status(binary))
        if not url:
            raise RuntimeError(problem)
        returncode, detail = run_limited([binary, "serve", "--bg", "--https=443", f"http://127.0.0.1:{port}"], 20)
        ok = returncode == 0  # None = it never finished: `tailscale serve` waits forever when the tailnet has not enabled Serve
        if not ok:
            link = re.search(r"https://login\.tailscale\.com/\S+", detail)
            if link:
                raise RuntimeError(f"Serve is not enabled on your tailnet yet. Open {link.group(0)} once (as the tailnet admin), enable it, then start again.")
            hint = " Enable HTTPS certificates for your tailnet in the Tailscale admin page (DNS > HTTPS Certificates)." if "https" in detail.lower() or "cert" in detail.lower() else ""
            raise RuntimeError(f"tailscale serve failed: {detail[:300] or 'no answer'}.{hint}")
    except (OSError, subprocess.SubprocessError, ValueError, RuntimeError) as e:
        state["status"] = "failed"
        print(f"[ERROR] Tailscale: {e}", flush=True)
        return
    state.update(public_url=url, status="up")
    atexit.register(stop_tailscale, binary)  # best effort; Stop_Accio.bat also switches it off
    announce("TAILSCALE ADDRESS (only your own devices on your tailnet)", url)


def stop_tailscale(binary: str | None = None) -> None:
    """Stop publishing port 443 (only that serve entry, not the rest of the user's Tailscale configuration)."""
    binary = binary or find_tailscale()
    if binary:
        subprocess.run([binary, "serve", "--https=443", "off"], capture_output=True, timeout=30, creationflags=NO_WINDOW)
