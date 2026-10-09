"""Shared installer helpers (stdlib only; runs under the project venv or any Python 3.10+).

Downloads use the curl.exe that ships with Windows 10+ (resumable, with its own progress bar).
Nothing here writes outside the Accio folder it is pointed at.
"""
from __future__ import annotations

import json
import os
import shutil
import struct
import subprocess
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "server" / "templates" / "manifest.json"


def load_manifest() -> dict[str, Any]:
    return json.loads(MANIFEST.read_text(encoding="utf-8"))


# --------------------------------------------------------------------------- safetensors verification

def verify_safetensors(path: Path, expected_size: int | None = None) -> tuple[bool, str]:
    """A safetensors file is complete when size == 8 + header_len + max(data_offsets end).

    Catches truncated downloads (this check found two truncated LoRAs during the audit).
    A GGUF file has no offset table: it must start with the GGUF magic and match the manifest size."""
    if path.suffix.lower() == ".gguf":
        try:
            size = path.stat().st_size
            with path.open("rb") as f:
                if f.read(4) != b"GGUF":
                    return False, "not a GGUF file"
        except OSError as e:
            return False, f"unreadable ({type(e).__name__})"
        if expected_size is not None and size != expected_size:
            return False, f"size {size} != manifest {expected_size}"
        return True, "ok"
    try:
        size = path.stat().st_size
        with path.open("rb") as f:
            raw = f.read(8)
            if len(raw) < 8:
                return False, "file too small"
            (header_len,) = struct.unpack("<Q", raw)
            if header_len <= 0 or header_len > 100 * 1024 * 1024 or 8 + header_len > size:
                return False, "invalid header length"
            header = json.loads(f.read(header_len))
    except (OSError, ValueError) as e:
        return False, f"unreadable ({type(e).__name__})"
    ends = [v["data_offsets"][1] for k, v in header.items() if k != "__metadata__" and isinstance(v, dict) and "data_offsets" in v]
    needed = 8 + header_len + (max(ends) if ends else 0)
    if size != needed:
        return False, f"size {size} != expected {needed} (truncated or padded)"
    if expected_size is not None and size != expected_size:
        return False, f"size {size} != manifest {expected_size}"
    return True, "ok"


# --------------------------------------------------------------------------- install location

# Windows loads DLLs through paths limited to 260 characters, and the deepest ones inside the bundled ComfyUI are about
# 110 characters below comfyui\. A fresh install in a very deep folder failed with "WinError 206: The filename or
# extension is too long" while torch loaded. Install.bat applies the same limit before it downloads anything.
MAX_ROOT_PATH_LEN = 100


def install_path_problem(root: Path) -> str | None:
    """A message when `root` cannot hold an install, else None. ACCIO_SKIP_PATH_CHECK=1 turns the check off."""
    if os.environ.get("ACCIO_SKIP_PATH_CHECK") == "1":
        return None
    text = str(root)
    if "!" in text:
        return f"The folder path contains '!' ({text}). Windows batch files cannot handle that. Move the folder to a path without it, e.g. C:\\AccioStudio."
    if len(text) > MAX_ROOT_PATH_LEN:
        return (
            f"This folder path is too long ({len(text)} characters, the limit is {MAX_ROOT_PATH_LEN}):\n  {text}\n"
            "Windows cannot load some of the engine's files from a path that deep. Move the whole folder closer to the "
            "drive root, e.g. C:\\AccioStudio, then run Install.bat again."
        )
    return None


# --------------------------------------------------------------------------- downloading

# Without these, a connection that stalls (no bytes arriving) hangs the installer forever. With them curl gives up
# (exit 28), and curl_download resumes the .part file.
CURL_STALL_GUARD = ["--connect-timeout", "30", "--speed-time", "60", "--speed-limit", "1024"]


def curl_download(url: str, dest: Path, *, expected_size: int | None = None, retries: int = 5) -> None:
    """Resumable download: <dest>.part is continued with `-C -`, then renamed. Raises RuntimeError on failure."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    for attempt in range(1, retries + 1):
        rc = subprocess.run(
            ["curl.exe", "-L", "-f", "-C", "-", "--retry", "3", "--retry-delay", "3", "--ssl-no-revoke", *CURL_STALL_GUARD, "-o", str(part), url]
        ).returncode
        if rc == 0:
            break
        if rc == 33 and part.exists():  # "range not satisfiable": the .part is already complete or stale
            if expected_size is None or part.stat().st_size == expected_size:
                break
            part.unlink()
        print(f"   download attempt {attempt}/{retries} failed (curl exit {rc})")
    else:
        raise RuntimeError(f"download failed: {dest.name}")
    if expected_size is not None and part.stat().st_size != expected_size:
        got = part.stat().st_size
        part.unlink()
        raise RuntimeError(f"{dest.name}: size {got} != expected {expected_size}")
    part.replace(dest)


def extract_zip(archive: Path, out_dir: Path) -> None:
    """Windows' built-in bsdtar handles .zip."""
    out_dir.mkdir(parents=True, exist_ok=True)
    r = subprocess.run(["tar", "-xf", str(archive), "-C", str(out_dir)], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"extract failed: {archive.name}: {r.stderr.strip()[:200]}")


def fmt_size(n: float) -> str:
    """Decimal units, matching the spec's "~37 GB"."""
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1000 or unit == "GB":
            return f"{n:.1f} {unit}" if unit != "B" else f"{int(n)} B"
        n /= 1000
    return str(n)


def free_space(path: Path) -> int:
    p = path
    while not p.exists():
        p = p.parent
    return shutil.disk_usage(p).free
