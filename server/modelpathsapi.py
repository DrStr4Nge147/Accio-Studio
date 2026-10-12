"""/api/model-paths: read and change the model folders (Settings > Model folders). Changing them restarts the backend."""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

import backend
import config
import modelpaths
from auth import is_local_direct

log = logging.getLogger("accio")
router = APIRouter(prefix="/api/model-paths")
READY_TIMEOUT = 180


class PathsBody(BaseModel):
    paths: dict[str, dict[str, str]]


def on_this_pc(request: Request) -> bool:
    """The browser is on the PC that runs Accio, opened at localhost. Unlike skipping the login, this holds in every tunnel
    mode: a request that came through a tunnel or the LAN address carries another Host or forwarding headers."""
    return is_local_direct(request.scope)


def _state(request: Request) -> dict[str, Any]:
    return getattr(request.app.state, "backend_restart", None) or {"state": "idle", "message": ""}


@router.get("")
async def read(request: Request):
    st = request.app.state
    saved = st.settings.get("model_paths") or {}
    families = []
    for fid, info in modelpaths.FAMILIES.items():
        fields = []
        for kind, label in modelpaths.KINDS.items():
            path = saved.get(fid, {}).get(kind, "")
            found = await asyncio.to_thread(modelpaths.count_models, path) if path else None
            default = modelpaths.default_folder(config.comfy_dir(st.settings), fid, kind)
            fields.append({"kind": kind, "label": label, "path": path, "default": default, "found": found, "missing": bool(path) and found is None})
        families.append({"id": fid, "label": info["label"], "fields": fields})
    return {
        "available": not str(st.settings["external_comfy_url"]).strip(),
        "can_pick": on_this_pc(request),
        "restart": _state(request),
        "families": families,
    }


@router.get("/browse")
async def browse(path: str = ""):
    """Folders under `path` (empty = drives), for the Browse picker. The login guards it like every other API route."""
    return await asyncio.to_thread(modelpaths.browse, path[:1024])


class PickBody(BaseModel):
    start: str = ""


@router.post("/pick")
async def pick(request: Request, body: PickBody):
    """Open Windows' folder dialog on the PC that runs Accio. It appears on that PC's screen, so only its own browser may ask."""
    if not on_this_pc(request):
        raise HTTPException(403, "The folder dialog opens on the PC that runs Accio, so it can only be used from that PC's browser.")
    try:
        chosen = await asyncio.to_thread(modelpaths.pick_folder, body.start)
    except modelpaths.ModelPathError as e:
        raise HTTPException(500, str(e)) from None
    return {"path": chosen}


async def _restart_and_wait(app) -> None:
    st = app.state
    try:
        await asyncio.to_thread(backend.restart, st.settings)
        deadline = time.time() + READY_TIMEOUT
        while time.time() < deadline:
            try:
                await st.comfy.system_stats()
                st.backend_restart = {"state": "ready", "message": "The backend is back with your model folders."}
                return
            except Exception:  # noqa: BLE001 - still starting
                await asyncio.sleep(2)
        st.backend_restart = {"state": "failed", "message": "The backend did not come back in time. See its console log in the app."}
    except backend.BackendError as e:
        st.backend_restart = {"state": "failed", "message": str(e)}
    except Exception:  # noqa: BLE001
        log.exception("backend restart failed")
        st.backend_restart = {"state": "failed", "message": "Could not restart the backend. Stop and start Accio to apply the folders."}


@router.put("", status_code=202)
async def save(request: Request, body: PathsBody):
    st = request.app.state
    if str(st.settings["external_comfy_url"]).strip():
        raise HTTPException(400, "This app uses an external backend, so its model folders are set up there.")
    if _state(request)["state"] == "restarting":
        raise HTTPException(409, "The backend is still restarting. Try again in a moment.")
    try:
        paths = modelpaths.normalize(body.paths)
        await asyncio.to_thread(modelpaths.apply, config.comfy_dir(st.settings), paths)
    except modelpaths.ModelPathError as e:
        raise HTTPException(400, str(e)) from None
    except OSError:
        log.exception("could not apply model folders")
        raise HTTPException(500, "Could not set up the model folders. Check that the app can write to its own folder.") from None
    config.save_setting("model_paths", paths)
    st.settings["model_paths"] = paths
    st.cache.clear()
    st.backend_restart = {"state": "restarting", "message": "Restarting the backend…"}
    st.backend_restart_task = asyncio.create_task(_restart_and_wait(request.app))
    return {"restart": st.backend_restart}
