"""WebP thumbnails for the gallery and history (display only: generation inputs and outputs are never touched).

Made once from the full result, cached on disk under data/thumbs, served with immutable caching headers.
"""
from __future__ import annotations

import asyncio
import io
import logging
from pathlib import Path

from PIL import Image

log = logging.getLogger("accio.thumbs")

SIZES = (384, 1024)  # longest side in px
_slots = asyncio.Semaphore(2)  # resizing a big PNG is CPU heavy; keep the server responsive


def cache_path(root: Path, job_id: str, index: int, size: int) -> Path:
    return root / f"{job_id}_{index}_{size}.webp"


def make_webp(data: bytes, size: int) -> bytes:
    with Image.open(io.BytesIO(data)) as im:
        im.load()
        im = im.convert("RGBA" if "A" in im.getbands() else "RGB")
        im.thumbnail((size, size), Image.Resampling.LANCZOS)  # never enlarges
        out = io.BytesIO()
        im.save(out, "WEBP", quality=80, method=4)
        return out.getvalue()


async def get_or_create(root: Path, job_id: str, index: int, size: int, fetch_source) -> Path | None:
    """Path of the cached thumbnail, creating it from `await fetch_source()` (full image bytes or None) when missing."""
    path = cache_path(root, job_id, index, size)
    if path.is_file():
        return path
    async with _slots:
        if path.is_file():
            return path
        data = await fetch_source()
        if not data:
            return None
        try:
            webp = await asyncio.to_thread(make_webp, data, size)
        except Exception:  # Pillow raises many types for broken images
            log.warning("could not make a thumbnail for job %s image %s", job_id, index)
            return None
        root.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_bytes(webp)
        tmp.replace(path)
        return path


def remove_for_job(root: Path, job_id: str) -> None:
    for p in root.glob(f"{job_id}_*.webp"):
        p.unlink(missing_ok=True)
