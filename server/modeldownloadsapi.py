"""/api/models: what is installed and the download job (Settings > Models). Behind the login like every other route."""
from __future__ import annotations

import asyncio

import config
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from modeldownloads import DownloadError

router = APIRouter(prefix="/api/models")


class DownloadBody(BaseModel):
    ids: list[str]


def _models_dir(request: Request):
    settings = request.app.state.settings
    if str(settings["external_comfy_url"]).strip():
        raise HTTPException(400, "This app uses an external backend, so its models are managed there.")
    return config.comfy_dir(settings) / "ComfyUI" / "models"


@router.get("")
async def read(request: Request):
    settings = request.app.state.settings
    if str(settings["external_comfy_url"]).strip():
        return {"available": False, "models": [], "job": request.app.state.downloads.job(), "free_bytes": 0}
    out = await asyncio.to_thread(request.app.state.downloads.listing, _models_dir(request))
    return {"available": True, **out}


@router.post("/download", status_code=202)
async def download(request: Request, body: DownloadBody):
    try:
        await asyncio.to_thread(request.app.state.downloads.start, body.ids, _models_dir(request))
    except DownloadError as e:
        raise HTTPException(e.status, str(e)) from None
    return {"job": request.app.state.downloads.job()}


@router.post("/cancel")
async def cancel(request: Request):
    request.app.state.downloads.cancel()
    return {"job": request.app.state.downloads.job()}
