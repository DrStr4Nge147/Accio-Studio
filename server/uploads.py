"""Uploaded source images. The bundled ComfyUI is started with its input folder set to data/uploads, so there is one copy of each
image: ComfyUI writes it there, jobs read it from there, and Accio previews and recalls it from there. (An external ComfyUI cannot
share the folder; there Accio keeps its own copy next to the backend's.)

/api/uploads: list what was uploaded before (Edit > previous uploads), make one usable in another mode, delete one, clear all."""
from __future__ import annotations

import asyncio
import os
import re
import shutil
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request

import backend
import engine
from config import UPLOADS_DIR

INPUT_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")
UPLOAD_KINDS = {"media": engine.MEDIA_SUBFOLDER, "image": engine.UPLOAD_SUBFOLDER, "mask": engine.UPLOAD_SUBFOLDER}
FOLDER_KIND = {engine.MEDIA_SUBFOLDER: "media", engine.UPLOAD_SUBFOLDER: "image"}  # folder -> kind used by /api/input
MASK_PREFIX = "mask-"  # masks share the image folder but are not source images, so the list skips them
IMAGE_EXT = {".png", ".jpg", ".webp"}
router = APIRouter(prefix="/api/uploads")


def local_copy(name: str, prefer: str | None = None, root: Path | None = None) -> Path | None:
    """Where an upload is stored, in `prefer`'s folder first, else in the other one (a photo uploaded for one mode can be reused in another)."""
    root = root or UPLOADS_DIR
    folders = list(FOLDER_KIND)
    if prefer in folders:
        folders.sort(key=lambda f: f != prefer)
    for folder in folders:
        p = root / folder / name
        if p.is_file():
            return p
    return None


def ensure_in_kind(name: str, kind: str, root: Path | None = None) -> bool:
    """Make an upload readable by the mode that uses `kind`. Modes read different subfolders; a hard link puts the file in
    the other one without a second copy on disk (a plain copy is the fallback when links are not possible)."""
    root = root or UPLOADS_DIR
    folder = UPLOAD_KINDS[kind]
    dst = root / folder / name
    if dst.is_file():
        return True
    src = local_copy(name, folder, root)
    if not src:
        return False
    dst.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.link(src, dst)
    except OSError:
        shutil.copy2(src, dst)
    return True


def list_uploads(root: Path | None = None) -> list[dict[str, Any]]:
    """Newest first; one entry per image even when it is linked into both subfolders."""
    root = root or UPLOADS_DIR
    found: dict[str, dict[str, Any]] = {}
    for folder, kind in FOLDER_KIND.items():
        d = root / folder
        if not d.is_dir():
            continue
        for p in d.iterdir():
            if p.suffix.lower() in IMAGE_EXT and INPUT_NAME.fullmatch(p.name) and not p.name.startswith(MASK_PREFIX) and p.is_file():
                if p.name not in found:
                    st = p.stat()
                    found[p.name] = {"file": p.name, "kind": kind, "size": st.st_size, "time": st.st_mtime}
    return sorted(found.values(), key=lambda u: u["time"], reverse=True)


def delete_upload(name: str, root: Path | None = None) -> int:
    """Remove an upload from every subfolder it is in. Returns how many files went."""
    root = root or UPLOADS_DIR
    gone = 0
    for folder in FOLDER_KIND:
        try:
            (root / folder / name).unlink()
            gone += 1
        except OSError:
            pass
    return gone


def migrate_legacy_input(comfy_input: Path, root: Path | None = None) -> int:
    """Earlier versions kept uploads inside ComfyUI's own input folder. Move ours over once (nothing is overwritten)."""
    root = root or UPLOADS_DIR
    moved = 0
    for folder in FOLDER_KIND:
        src = comfy_input / folder
        if not src.is_dir():
            continue
        for p in src.iterdir():
            dst = root / folder / p.name
            try:
                if p.is_file() and not dst.exists():
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    shutil.move(str(p), dst)
                    moved += 1
                elif p.is_file():
                    p.unlink()  # already stored by Accio: the leftover is the duplicate this change removes
            except OSError:
                pass
        try:
            src.rmdir()
        except OSError:
            pass
    return moved


def _busy(request: Request) -> None:
    if request.app.state.history.active():
        raise HTTPException(409, "Wait for the running jobs to finish first.")


@router.get("")
async def list_all():
    return {"uploads": await asyncio.to_thread(list_uploads)}


@router.post("/{file}/use")
async def use_in(file: str, kind: str):
    """Make a stored upload readable for one mode's kind ("media" = Multi-edit / Character sheet, "image" = Inpaint / Outpaint)."""
    if kind not in ("media", "image") or not INPUT_NAME.fullmatch(file):
        raise HTTPException(404, "Image not found.")
    if not await asyncio.to_thread(ensure_in_kind, file, kind):
        raise HTTPException(404, "That image was deleted.")
    return {"file": file, "kind": kind}


@router.delete("/{file}")
async def delete_one(file: str, request: Request):
    if not INPUT_NAME.fullmatch(file):
        raise HTTPException(404, "Image not found.")
    _busy(request)
    if not await asyncio.to_thread(delete_upload, file):
        raise HTTPException(404, "Image not found.")
    return {"ok": True}


@router.post("/clear")
async def clear_all(request: Request):
    """Delete every uploaded source image (data/uploads, which is also the bundled backend's input folder)."""
    _busy(request)
    removed = 0
    for folder in FOLDER_KIND:
        removed += await asyncio.to_thread(backend.clear_folder, UPLOADS_DIR / folder)
    return {"removed": removed}
