"""Reads the bundled ComfyUI's console log (data/logs/comfyui.log, written by Run_Accio.bat) by byte offset."""
from __future__ import annotations

from pathlib import Path

CHUNK = 64 * 1024  # most bytes returned per call
FIRST_TAIL = 48 * 1024  # what a client that has no offset yet gets: the end of the log


def _trim_partial_char(data: bytes) -> bytes:
    """Cut a trailing, incomplete UTF-8 sequence so it is delivered whole with the next chunk."""
    for back in range(1, min(4, len(data)) + 1):
        b = data[-back]
        if b & 0xC0 == 0x80:  # continuation byte: keep looking for its lead byte
            continue
        need = 4 if b >= 0xF0 else 3 if b >= 0xE0 else 2 if b >= 0xC0 else 1
        return data[:-back] if need > back else data
    return data


def read_log(path: Path, after: int | None) -> dict:
    """{offset, text, reset}. `after` is the offset the client already has (None = first request).

    `reset` means the log is a new one (Run_Accio.bat truncates it on every start): drop what you showed and use `text`.
    """
    try:
        size = path.stat().st_size
        with path.open("rb") as f:
            reset = after is not None and after > size
            if after is None or reset:
                start = max(0, size - FIRST_TAIL)
            else:
                start = after
            f.seek(start)
            data = f.read(min(CHUNK, size - start))
    except OSError:
        return {"available": False, "offset": 0, "text": "", "reset": False}
    data = _trim_partial_char(data)
    if start > 0 and (after is None or reset):
        while data and data[0] & 0xC0 == 0x80:  # tail began mid-character
            data = data[1:]
            start += 1
    return {
        "available": True,
        "offset": start + len(data),
        "text": data.decode("utf-8", errors="replace"),
        "reset": reset or after is None,
    }
