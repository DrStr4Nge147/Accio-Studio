"""What this PC has: graphics card(s), driver, CUDA and RAM (Settings > This PC). Read-only; hardware does not change while Accio runs."""
from __future__ import annotations

import ctypes
import re
import subprocess
import sys
import threading
import time
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


class _MemStatus(ctypes.Structure):
    _fields_ = [
        ("length", ctypes.c_ulong), ("load", ctypes.c_ulong),
        ("total_phys", ctypes.c_ulonglong), ("avail_phys", ctypes.c_ulonglong),
        ("total_page", ctypes.c_ulonglong), ("avail_page", ctypes.c_ulonglong),
        ("total_virt", ctypes.c_ulonglong), ("avail_virt", ctypes.c_ulonglong),
        ("avail_ext", ctypes.c_ulonglong),
    ]


def _mem_status() -> _MemStatus | None:
    if sys.platform != "win32":
        return None
    st = _MemStatus()
    st.length = ctypes.sizeof(_MemStatus)
    if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(st)):  # type: ignore[attr-defined]
        return None
    return st


def _ram_mb() -> int | None:
    st = _mem_status()
    return None if st is None else int(st.total_phys // (1024 * 1024))


def torch_cuda(pytorch_version: str | None) -> str | None:
    """CUDA the backend's PyTorch was built for, from a version like "2.9.0+cu130" -> "13.0"; None for CPU/AMD/unknown builds."""
    m = TORCH_CUDA.search(pytorch_version or "")
    if not m:
        return None
    digits = m.group(1)
    return f"{digits[:-1]}.{digits[-1]}"


def _gpu_temps() -> list[int | None]:
    """Degrees C per Nvidia card from nvidia-smi; [] without an Nvidia driver."""
    out = _run(["nvidia-smi", "--query-gpu=temperature.gpu", "--format=csv,noheader,nounits"], 10)
    temps: list[int | None] = []
    for line in out.strip().splitlines():
        try:
            temps.append(int(float(line.strip())))
        except ValueError:
            temps.append(None)
    return temps


# Windows reports no CPU temperature on its own. LibreHardwareMonitor / OpenHardwareMonitor publish their sensors
# to WMI while they run, so read those (and the ACPI thermal zone as a last resort).
_CPU_TEMP_SCRIPT = r"""
$ErrorActionPreference = 'SilentlyContinue'
foreach ($ns in 'root/LibreHardwareMonitor', 'root/OpenHardwareMonitor') {
  $rows = Get-CimInstance -Namespace $ns -ClassName Sensor | Where-Object { $_.SensorType -eq 'Temperature' -and $_.Identifier -match '/(intelcpu|amdcpu)/' }
  if ($rows) { $rows | ForEach-Object { "$($_.Name)|$($_.Value)" }; return }
}
Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZone | ForEach-Object { "ACPI|" + ($_.CurrentTemperature / 10 - 273.15) }
"""
PREFERRED_CPU_SENSORS = ("package", "tctl", "tdie")


def pick_cpu_temp(lines: str) -> int | None:
    """One CPU temperature from "name|celsius" lines: the package sensor if there is one, else the hottest core. Implausible values are dropped."""
    sensors: list[tuple[str, float]] = []
    for line in lines.splitlines():
        name, _, value = line.partition("|")
        try:
            celsius = float(value)
        except ValueError:
            continue
        if 1 <= celsius <= 125:
            sensors.append((name.lower(), celsius))
    if not sensors:
        return None
    for key in PREFERRED_CPU_SENSORS:
        for name, celsius in sensors:
            if key in name:
                return round(celsius)
    return round(max(c for _, c in sensors))


def temperatures() -> dict[str, Any]:
    """Live temperatures in degrees C: `gpus` (one per Nvidia card) and `cpu` (None when no sensor is readable)."""
    cpu = pick_cpu_temp(_run(["powershell", "-NoProfile", "-Command", _CPU_TEMP_SCRIPT], 15)) if sys.platform == "win32" else None
    return {"gpus": _gpu_temps(), "cpu": cpu}


@lru_cache(maxsize=1)
def hardware() -> dict[str, Any]:
    cards, driver_cuda = _nvidia()
    return {
        "gpus": cards or _other_cards(),
        "driver_cuda": driver_cuda,
        "ram_mb": _ram_mb(),
    }


# --------------------------------------------------------------------------- live load (header badge)

def parse_gpu_live(out: str) -> list[dict[str, int | None]]:
    """Rows of "temp, utilization %, vram used MB, vram total MB" from nvidia-smi into one dict per card (None where unreadable)."""
    cards: list[dict[str, int | None]] = []
    for line in out.strip().splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) != 4:
            continue

        def num(v: str) -> int | None:
            try:
                return int(float(v))
            except ValueError:
                return None

        cards.append({"temp": num(parts[0]), "util": num(parts[1]), "vram_used_mb": num(parts[2]), "vram_total_mb": num(parts[3])})
    return cards


def _gpu_live() -> list[dict[str, int | None]]:
    out = _run(["nvidia-smi", "--query-gpu=temperature.gpu,utilization.gpu,memory.used,memory.total", "--format=csv,noheader,nounits"], 10)
    return parse_gpu_live(out)


def cpu_busy_percent(prev: tuple[int, int, int], cur: tuple[int, int, int]) -> int | None:
    """CPU busy percent between two (idle, kernel, user) samples; kernel time includes idle time, as GetSystemTimes reports it."""
    idle = cur[0] - prev[0]
    total = (cur[1] - prev[1]) + (cur[2] - prev[2])
    if total <= 0:
        return None
    return max(0, min(100, round(100 * (1 - idle / total))))


def _cpu_times() -> tuple[int, int, int] | None:
    if sys.platform != "win32":
        return None

    class FileTime(ctypes.Structure):
        _fields_ = [("low", ctypes.c_ulong), ("high", ctypes.c_ulong)]

    idle, kernel, user = FileTime(), FileTime(), FileTime()
    if not ctypes.windll.kernel32.GetSystemTimes(ctypes.byref(idle), ctypes.byref(kernel), ctypes.byref(user)):  # type: ignore[attr-defined]
        return None
    return tuple((f.high << 32) | f.low for f in (idle, kernel, user))  # type: ignore[return-value]


_cpu_lock = threading.Lock()
_cpu_last: tuple[int, int, int] | None = None


def _cpu_percent() -> int | None:
    """CPU busy percent since the previous call (the first call measures over a short pause)."""
    global _cpu_last
    with _cpu_lock:
        cur = _cpu_times()
        if cur is None:
            return None
        prev = _cpu_last
        if prev is None:
            time.sleep(0.25)
            prev, cur = cur, _cpu_times() or cur
        _cpu_last = cur
        return cpu_busy_percent(prev, cur)


def live() -> dict[str, Any]:
    """Everything the header badge shows: per-card temperature, load and VRAM, plus CPU load and RAM use."""
    mem = _mem_status()
    ram = None
    if mem is not None:
        total = int(mem.total_phys // (1024 * 1024))
        ram = {"percent": int(mem.load), "used_mb": total - int(mem.avail_phys // (1024 * 1024)), "total_mb": total}
    return {"gpus": _gpu_live(), "cpu": {"percent": _cpu_percent()}, "ram": ram}
