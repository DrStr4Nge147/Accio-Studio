"""Restart the bundled ComfyUI (needed after the model folders change: it reads extra_model_paths.yaml only at startup).

Mirrors what Run_Accio.bat does to start it: same python, same arguments (input folder = data/uploads), console output to data/logs/comfyui.log.
Only a process whose program lives inside the bundled ComfyUI folder is ever stopped.
"""
from __future__ import annotations

import os
import shlex
import shutil
import socket
import subprocess
import time
from pathlib import Path
from typing import Any

import config

STOP_SCRIPT = (
    "$base = $env:ACCIO_BASE.TrimEnd('\\') + '\\'; $port = [int]$env:ACCIO_PORT;"
    "Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object {"
    "  $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue;"
    "  if ($p -and $p.Path -and $p.Path.StartsWith($base, [StringComparison]::OrdinalIgnoreCase)) { Stop-Process -Id $p.Id -Force }"
    "}"
)
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
DETACHED = getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)


class BackendError(RuntimeError):
    """The message is safe to show to the user."""


def _port_open(port: int) -> bool:
    with socket.socket() as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


def stop(base: Path, port: int) -> None:
    env = {**os.environ, "ACCIO_BASE": str(base), "ACCIO_PORT": str(port)}
    subprocess.run(  # noqa: S603
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", STOP_SCRIPT],
        env=env, capture_output=True, timeout=30, creationflags=NO_WINDOW, check=False,
    )
    deadline = time.time() + 20
    while _port_open(port) and time.time() < deadline:
        time.sleep(0.3)
    if _port_open(port):
        raise BackendError("The backend did not stop. Close it with Stop_Accio.bat and start Accio again.")


def clear_folder(folder: Path) -> int:
    """Delete everything inside `folder` (the folder stays). Returns how many entries were removed; locked ones are skipped."""
    if not folder.is_dir():
        return 0
    removed = 0
    for item in folder.iterdir():
        try:
            if item.is_dir() and not item.is_symlink():
                shutil.rmtree(item)
            else:
                item.unlink()
            removed += 1
        except OSError:
            pass  # in use or locked: leave it, the next clear tries again
    return removed


def start(base: Path, port: int, flags: str, log_file: Path) -> None:
    py = base / "python_embeded" / "python.exe"
    if not py.is_file():
        raise BackendError("The bundled backend was not found. Run Install.bat.")
    log_file.parent.mkdir(parents=True, exist_ok=True)
    config.UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    args = [str(py), "-s", r"ComfyUI\main.py", "--windows-standalone-build", "--listen", "127.0.0.1", "--port", str(port),
            "--disable-auto-launch", "--input-directory", str(config.UPLOADS_DIR), *shlex.split(flags, posix=False)]
    env = {**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"}
    with log_file.open("wb") as log:
        subprocess.Popen(args, cwd=base, env=env, stdout=log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,  # noqa: S603
                         creationflags=DETACHED | NO_WINDOW, close_fds=True)


def restart(settings: dict[str, Any]) -> None:
    """Blocking: stop the bundled backend, start it again. Run it in a thread."""
    if str(settings["external_comfy_url"]).strip():
        raise BackendError("This app uses an external backend. Restart that one yourself.")
    base, port = config.comfy_dir(settings), int(settings["comfy_port"])
    stop(base, port)
    start(base, port, config.install_state().get("launch_flags", ""), config.DATA_DIR / "logs" / "comfyui.log")
