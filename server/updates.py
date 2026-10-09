"""Update check for the Settings page. The real work is done by installer/update.py, the same code Update.bat runs."""
from __future__ import annotations

import asyncio
import subprocess
import sys
import time
from typing import Any

from config import ROOT

sys.path.insert(0, str(ROOT / "installer"))
import update as updater  # noqa: E402

CHECK_EVERY = 6 * 3600  # seconds between asking GitHub
RETRY_AFTER_FAILURE = 600
_cache: dict[str, Any] = {"at": 0.0, "wait": CHECK_EVERY, "latest": None, "error": None}


async def status(settings: dict[str, Any], *, refresh: bool = False) -> dict[str, Any]:
    """Installed and newest version. Never raises and never exposes network error details."""
    current = updater.installed_version(ROOT)
    out: dict[str, Any] = {"current": current, "enabled": bool(settings["check_updates"]), "available": False,
                           "latest": None, "notes_url": None, "error": None}
    if not out["enabled"]:
        return out
    now = time.time()
    if refresh or now - _cache["at"] >= _cache["wait"]:
        try:
            info = await asyncio.to_thread(updater.fetch_latest)
            _cache.update(at=now, wait=CHECK_EVERY, latest=info, error=None)
        except Exception:  # noqa: BLE001 - offline, rate limited, a release without its checksum: all the same to the user
            _cache.update(at=now, wait=RETRY_AFTER_FAILURE, latest=None, error="Could not check for updates right now.")
    latest = _cache["latest"]
    out["error"] = _cache["error"]
    if latest:
        out.update(latest=latest["version"], notes_url=latest["notes_url"], available=updater.is_newer(latest["version"], current))
    return out


def start_update() -> None:
    """Open Update.bat in its own console, detached from this server (the updater stops the server itself)."""
    bat = ROOT / "Update.bat"
    if not bat.is_file():
        raise FileNotFoundError("Update.bat is missing")
    flags = getattr(subprocess, "CREATE_NEW_CONSOLE", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    subprocess.Popen(["cmd.exe", "/c", str(bat), "--yes"], cwd=ROOT, creationflags=flags, close_fds=True)  # noqa: S603
