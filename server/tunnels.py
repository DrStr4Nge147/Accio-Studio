"""Cloudflare quick tunnel and zrok share, run as background threads next to the server (APP_SPEC 9.2).

Both connect to the server on localhost, so the server itself can stay on 127.0.0.1. Each prints its public URL with an
ASCII QR code and records it in `state` so the settings page can show it too. zrok reconnects forever.
"""
from __future__ import annotations

import io
import re
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

import httpx
import qrcode
import qrcode.image.svg

from config import ROOT

CLOUDFLARED = ROOT / "cloudflared.exe"
ZROK = ROOT / "zrok.exe"
ZROK_SHARE_FILE = ROOT / ".zrok_share"
CLOUDFLARED_URL = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
ZROK_NAME = re.compile(r"^[A-Za-z0-9]{4,32}$")
CLOUDFLARE_URL = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")
ZROK_URL = re.compile(r"https://[a-z0-9-]+\.share\.zrok\.io")
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
        print("\n[ERROR] zrok.exe was not found next to the app. Run Setup_Zrok.bat first.\n", flush=True)
        return
    state.update(mode="zrok", status="starting")

    def work() -> None:
        while True:  # keep the share alive forever
            name = reserved_name()
            if name:
                cmd = [str(ZROK), "share", "reserved", name, "--headless"]
                url = f"https://{name}.share.zrok.io"
                state.update(public_url=url, status="up")
                if not work.announced:
                    announce("ZROK TUNNEL ACTIVE (RESERVED)", url)
                    work.announced = True
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
                    if match and not name and state["public_url"] != match.group(0):
                        state.update(public_url=match.group(0), status="up")
                        announce("ZROK TUNNEL ACTIVE", match.group(0))
                state["status"] = "reconnecting"
                print("zrok share closed; reconnecting in 5 s...", flush=True)
            except OSError as e:
                state["status"] = "failed"
                print(f"[ERROR] Could not start zrok: {e!r}. Retrying in 5 s.", flush=True)
            time.sleep(5)

    work.announced = False  # type: ignore[attr-defined]
    threading.Thread(target=work, daemon=True, name="zrok").start()
