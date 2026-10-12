"""What this PC has: graphics card(s), driver, CUDA and RAM (Settings > This PC). Read-only; hardware does not change while Accio runs."""
from __future__ import annotations

import ctypes
import re
import subprocess
import sys
from functools import lru_cache
from typing import Any

CUDA_HEADER = re.compile(r"CUDA (?:UMD )?Version:\s*([0-9]+(?:\.[0-9]+)?)")
TORCH_CUDA = re.compile(r"\+cu(\d{2,3})\b")


def _run(cmd: list[str], timeout: int) -> str:
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout).stdout
    except (OSError, subprocess.SubprocessError):
        return ""


def _nvidia() -> tuple[list[dict[str, Any]], str | None]:
    """(cards, newest CUDA the driver supports) from nvidia-smi, or ([], None) without an Nvidia driver."""
    out = _run(["nvidia-smi", "--query-gpu=name,memory.total,driver_version", "--format=csv,noheader,nounits"], 15)
    cards = []
    for line in out.strip().splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) != 3:
            continue
        try:
            vram = int(float(parts[1]))
        except ValueError:
            vram = None
        cards.append({"name": parts[0], "vram_mb": vram, "driver": parts[2]})
    match = CUDA_HEADER.search(_run(["nvidia-smi"], 15)) if cards else None
    return cards, match.group(1) if match else None


def _other_cards() -> list[dict[str, Any]]:
    out = _run(["powershell", "-NoProfile", "-Command", "(Get-CimInstance Win32_VideoController).Name -join \"`n\""], 30)
    return [{"name": n.strip(), "vram_mb": None, "driver": None} for n in out.splitlines() if n.strip()]


def _ram_mb() -> int | None:
    if sys.platform != "win32":
        return None

    class Status(ctypes.Structure):
        _fields_ = [
            ("length", ctypes.c_ulong), ("load", ctypes.c_ulong),
            ("total_phys", ctypes.c_ulonglong), ("avail_phys", ctypes.c_ulonglong),
            ("total_page", ctypes.c_ulonglong), ("avail_page", ctypes.c_ulonglong),
            ("total_virt", ctypes.c_ulonglong), ("avail_virt", ctypes.c_ulonglong),
            ("avail_ext", ctypes.c_ulonglong),
        ]

    st = Status()
    st.length = ctypes.sizeof(Status)
    if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(st)):  # type: ignore[attr-defined]
        return None
    return int(st.total_phys // (1024 * 1024))


def torch_cuda(pytorch_version: str | None) -> str | None:
    """CUDA the backend's PyTorch was built for, from a version like "2.9.0+cu130" -> "13.0"; None for CPU/AMD/unknown builds."""
    m = TORCH_CUDA.search(pytorch_version or "")
    if not m:
        return None
    digits = m.group(1)
    return f"{digits[:-1]}.{digits[-1]}"


@lru_cache(maxsize=1)
def hardware() -> dict[str, Any]:
    cards, driver_cuda = _nvidia()
    return {
        "gpus": cards or _other_cards(),
        "driver_cuda": driver_cuda,
        "ram_mb": _ram_mb(),
    }
