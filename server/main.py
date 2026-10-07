"""Accio Studio server. One origin, one port (default 7862): REST + WebSocket API and the built frontend.

Phase 1-2: no login yet, so the server listens on loopback unless `lan_access` is set in settings.json.
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import re
import socket
import threading
import time
import webbrowser
import uuid
from contextlib import asynccontextmanager
from typing import Any

import httpx
import uvicorn
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

import engine
from comfy import ComfyClient, ComfyError
from config import DATA_DIR, FRONTEND_DIST, ROOT, comfy_url, load_manifest, load_settings, template_files
from history import History
from jobs import JobManager
from logtail import read_log
from schemas import JobRequest

log = logging.getLogger("accio")
STATIC_DIR = ROOT / "server" / "static"

MANIFEST = load_manifest()
REQUIRED_MODELS: dict[str, list[str]] = {}
for _m in MANIFEST["models"]:
    if _m["required"]:
        REQUIRED_MODELS.setdefault(_m["folder"], []).append(_m["file"])
UPLOADS_DIR = DATA_DIR / "uploads"  # our own copy of every upload, so previews never wait on the busy backend
INPUT_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")
UPLOAD_KINDS = {"media": engine.MEDIA_SUBFOLDER, "image": engine.UPLOAD_SUBFOLDER, "mask": engine.UPLOAD_SUBFOLDER}


def sniff_image(head: bytes) -> tuple[str, str] | None:
    """(extension, mime) from magic bytes. Extensions are never trusted."""
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png", "image/png"
    if head.startswith(b"\xff\xd8\xff"):
        return "jpg", "image/jpeg"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "webp", "image/webp"
    return None


def save_upload_copy(subfolder: str, name: str, data: bytes) -> None:
    """Best effort: a failed copy only means the preview falls back to the backend's own file."""
    try:
        if not INPUT_NAME.fullmatch(name):
            return
        folder = UPLOADS_DIR / subfolder
        folder.mkdir(parents=True, exist_ok=True)
        (folder / name).write_bytes(data)
    except OSError:
        log.warning("could not keep a copy of an upload")


def png_has_alpha(head: bytes) -> bool:
    return len(head) > 25 and head[25] == 6  # IHDR colour type 6 = RGBA


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = load_settings()
    DATA_DIR.mkdir(exist_ok=True)
    app.state.settings = settings
    app.state.comfy = ComfyClient(comfy_url(settings))
    app.state.history = History(DATA_DIR / "history.db")
    app.state.jobs = JobManager(app.state.comfy, app.state.history)
    app.state.cache = {}
    await app.state.jobs.start()
    yield
    await app.state.jobs.stop()
    await app.state.comfy.aclose()


app = FastAPI(title="Accio Studio", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


class SkipImageGZip:
    """Gzip JSON/HTML/JS but never result images (already compressed)."""

    def __init__(self, inner):
        self.gzip = GZipMiddleware(inner, minimum_size=1024)
        self.inner = inner

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and ("/image/" in scope["path"] or scope["path"].startswith("/api/input/")):
            await self.inner(scope, receive, send)
        else:
            await self.gzip(scope, receive, send)


app.add_middleware(SkipImageGZip)


# --------------------------------------------------------------------------- error mapping

@app.exception_handler(ComfyError)
async def comfy_error(_: Request, e: ComfyError):
    log.warning("ComfyError kind=%s detail=%s", e.kind, e.detail[:500])
    code = 503 if e.kind == "offline" else 502 if e.kind == "error" else 422
    return JSONResponse({"error": {"code": e.kind, "message": e.user_message}}, status_code=code)


@app.exception_handler(engine.BuildError)
async def build_error(_: Request, e: engine.BuildError):
    return JSONResponse({"error": {"code": "invalid", "message": str(e)}}, status_code=422)


@app.exception_handler(StarletteHTTPException)
async def http_error(_: Request, e: StarletteHTTPException):
    return JSONResponse({"error": {"code": "http", "message": str(e.detail)}}, status_code=e.status_code)


@app.exception_handler(Exception)
async def unhandled(_: Request, e: Exception):
    log.exception("unhandled error")
    return JSONResponse({"error": {"code": "internal", "message": "Something went wrong on the server."}}, status_code=500)


# --------------------------------------------------------------------------- helpers

async def cached(request: Request, key: str, ttl: float, fetch):
    cache = request.app.state.cache
    hit = cache.get(key)
    if hit and time.monotonic() - hit[0] < ttl:
        return hit[1]
    value = await fetch()
    cache[key] = (time.monotonic(), value)
    return value


async def make_catalog(request: Request, need_loras: bool = True) -> engine.Catalog:
    comfy: ComfyClient = request.app.state.comfy

    async def ksampler():
        return (await comfy.object_info("KSampler"))["KSampler"]["input"]["required"]

    async def variance():
        return (await comfy.object_info("RBG_Smart_Seed_Variance"))["RBG_Smart_Seed_Variance"]["input"]["required"]

    ks = await cached(request, "ksampler", 300, ksampler)
    var = await cached(request, "variance", 300, variance)
    loras = set(await comfy.models("loras")) if need_loras else None  # fresh each time (spec 6.6)
    return engine.Catalog(
        loras=loras, samplers=set(ks["sampler_name"][0]), schedulers=set(ks["scheduler"][0]), variance_spec=var
    )


def template_classes() -> set[str]:
    """Classes the app actually sends (output-only nodes are stripped before queueing, spec 4.4)."""
    return {
        n["class_type"]
        for p in template_files()
        for n in engine.strip_output_only(engine.load_template(p.stem)).values()
    }


# --------------------------------------------------------------------------- routes

@app.get("/api/health")
async def health(request: Request):
    comfy: ComfyClient = request.app.state.comfy
    try:
        stats = await comfy.system_stats()
    except ComfyError:
        return {"comfy_online": False, "missing_models": [], "missing_nodes": [], "warnings": []}
    missing = []
    for folder, names in REQUIRED_MODELS.items():
        have = set(await comfy.models(folder))
        missing += [f"{folder}/{n}" for n in names if n not in have]
    info = await cached(request, "object_info_keys", 300, lambda: _object_info_keys(comfy))
    version = stats.get("system", {}).get("comfyui_version")
    pinned = MANIFEST["comfyui"]["version"]
    warnings = []
    if version and version != pinned:  # non-blocking (spec 11.3)
        warnings.append(
            f"The backend is version {version}, but the templates were exported against {pinned}. "
            "Outputs may differ; see scripts/export-templates.md to re-export."
        )
    return {
        "comfy_online": True,
        "comfy_version": version,
        "missing_models": missing,
        "missing_nodes": sorted(template_classes() - info),
        "warnings": warnings,
    }


async def _object_info_keys(comfy: ComfyClient) -> set[str]:
    return set((await comfy.object_info()).keys())


@app.get("/api/catalog")
async def catalog(request: Request):
    cat = await make_catalog(request)
    return {
        "loras": sorted(cat.loras or []),
        "samplers": sorted(cat.samplers or []),
        "schedulers": sorted(cat.schedulers or []),
        "variance": cat.variance_spec,
        "defaults": {**engine.create_defaults(), "edit": engine.edit_defaults()},
    }


@app.post("/api/build")
async def dry_run(req: JobRequest, request: Request):
    """Build the prompt without queueing it (inspection / structural comparison)."""
    cat = await make_catalog(request, need_loras=bool(getattr(req.params, "loras", None)))
    built = engine.build(req.params, cat, output_prefix=request.app.state.settings["output_prefix"])
    return {"template": built.template, "seeds": built.seeds, "warnings": built.warnings, "prompt": built.prompt}


@app.post("/api/jobs", status_code=201)
async def create_job(req: JobRequest, request: Request):
    cat = await make_catalog(request, need_loras=bool(getattr(req.params, "loras", None)))
    built = engine.build(req.params, cat, output_prefix=request.app.state.settings["output_prefix"])
    return await request.app.state.jobs.submit(built, req.params.model_dump(mode="json"))


@app.get("/api/jobs")
async def list_jobs(request: Request, limit: int = 30, before: float | None = None):
    jobs = request.app.state.history.list(max(1, min(limit, 100)), before)
    return {"jobs": [request.app.state.jobs.public(j["id"]) for j in jobs]}


@app.get("/api/jobs/{job_id}")
async def get_job(job_id: str, request: Request):
    job = request.app.state.jobs.public(job_id)
    if not job:
        raise HTTPException(404, "Job not found.")
    return job


@app.post("/api/jobs/{job_id}/cancel")
async def cancel_job(job_id: str, request: Request):
    job = await request.app.state.jobs.cancel(job_id)
    if not job:
        raise HTTPException(404, "Job not found.")
    return job


@app.get("/api/jobs/{job_id}/image/{index}")
async def job_image(job_id: str, index: int, request: Request):
    job = request.app.state.history.get(job_id)
    if not job or not (0 <= index < len(job["outputs"])):
        raise HTTPException(404, "Image not found.")
    o = job["outputs"][index]  # filename/subfolder come from our own history, never from the client
    comfy: ComfyClient = request.app.state.comfy
    upstream = await comfy.send(comfy.view_stream(o["filename"], o["subfolder"], o["type"]), stream=True)
    if upstream.status_code != 200:
        await upstream.aclose()
        raise HTTPException(404, "Image not found.")

    async def body():
        try:
            async for chunk in upstream.aiter_bytes():
                yield chunk
        except httpx.HTTPError:
            log.warning("image stream interrupted")
        finally:
            await upstream.aclose()

    headers = {"Cache-Control": "private, max-age=31536000, immutable"}
    return StreamingResponse(body(), media_type=upstream.headers.get("content-type", "image/png"), headers=headers)


@app.get("/api/queue")
async def queue(request: Request):
    q = await request.app.state.comfy.queue()
    return {"running": len(q.get("queue_running", [])), "pending": len(q.get("queue_pending", []))}


@app.get("/api/logs/comfy")
async def comfy_log(request: Request, after: int | None = None):
    """The bundled ComfyUI console output, by byte offset. Not available when an external backend is used."""
    if str(request.app.state.settings["external_comfy_url"]).strip():
        return {"available": False, "offset": 0, "text": "", "reset": False, "external": True}
    return read_log(DATA_DIR / "logs" / "comfyui.log", after)


@app.post("/api/upload")
async def upload(request: Request, kind: str):
    """Raw image body (Content-Type ignored; magic bytes decide). Not re-encoded, to keep parity."""
    if kind not in UPLOAD_KINDS:
        raise HTTPException(422, "Unknown upload kind.")
    limit = int(request.app.state.settings["max_upload_mb"]) * 1024 * 1024
    data = bytearray()
    async for chunk in request.stream():
        data += chunk
        if len(data) > limit:
            raise HTTPException(413, "That image is too large.")
    sniffed = sniff_image(bytes(data[:16]))
    if not sniffed:
        raise HTTPException(415, "Only PNG, JPEG and WebP images are supported.")
    ext, mime = sniffed
    if kind == "mask" and not (ext == "png" and png_has_alpha(bytes(data[:32]))):
        raise HTTPException(422, "The mask upload must be an RGBA PNG.")
    name = f"{uuid.uuid4().hex}.{ext}"
    res = await request.app.state.comfy.upload_image(bytes(data), name, UPLOAD_KINDS[kind], mime)
    await asyncio.to_thread(save_upload_copy, UPLOAD_KINDS[kind], res["name"], bytes(data))
    return {"file": res["name"], "kind": kind}


@app.get("/api/input/{kind}/{file}")
async def input_image(kind: str, file: str, request: Request):
    """Serve back an image this app uploaded (compare slider, reuse). Only our own upload folders, validated names."""
    if kind not in ("media", "image") or not INPUT_NAME.fullmatch(file):
        raise HTTPException(404, "Image not found.")
    local = UPLOADS_DIR / UPLOAD_KINDS[kind] / file
    if local.is_file():
        return FileResponse(local, headers={"Cache-Control": "private, max-age=31536000, immutable"})
    comfy: ComfyClient = request.app.state.comfy
    upstream = await comfy.send(comfy.view_stream(file, UPLOAD_KINDS[kind], "input"), stream=True)
    if upstream.status_code != 200:
        await upstream.aclose()
        raise HTTPException(404, "Image not found.")

    async def body():
        try:
            async for chunk in upstream.aiter_bytes():
                yield chunk
        except httpx.HTTPError:
            log.warning("input stream interrupted")
        finally:
            await upstream.aclose()

    headers = {"Cache-Control": "private, max-age=31536000, immutable"}
    return StreamingResponse(body(), media_type=upstream.headers.get("content-type", "image/png"), headers=headers)


@app.websocket("/api/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    jobs: JobManager = ws.app.state.jobs
    await jobs.add_client(ws)
    try:
        while True:
            await ws.receive_text()  # clients only listen; this detects disconnects
    except WebSocketDisconnect:
        pass
    finally:
        jobs.drop_client(ws)


@app.get("/dev", include_in_schema=False)
async def dev_page():
    return FileResponse(STATIC_DIR / "testpage.html")


if (FRONTEND_DIST / "index.html").is_file():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")  # last, so /api/* wins


# --------------------------------------------------------------------------- entry point

def lan_ip() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"


def open_browser_when_ready(port: int) -> None:
    """Open the app in the default browser once the server accepts connections (started from Run_Accio.bat)."""

    def wait_then_open() -> None:
        for _ in range(120):
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=1):
                    break
            except OSError:
                time.sleep(0.5)
        else:
            return
        webbrowser.open(f"http://127.0.0.1:{port}")

    threading.Thread(target=wait_then_open, daemon=True).start()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--open-browser", action="store_true", help="open the app in the default browser once it is up")
    parser.add_argument("--tunnel", choices=["local", "cloudflare", "zrok"], default="local")
    parser.add_argument("--host")
    parser.add_argument("--port", type=int)
    args = parser.parse_args()
    s = load_settings()
    host = args.host or ("0.0.0.0" if s["lan_access"] else "127.0.0.1")
    port = args.port or int(s["port"])
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    if args.tunnel != "local":
        print(f"[!] --tunnel {args.tunnel} arrives with login and tunnels (phase 7); running local only.")
    print(f"\n  Accio Studio on  http://127.0.0.1:{port}")
    if host == "0.0.0.0":
        print(f"  LAN address      http://{lan_ip()}:{port}")
    else:
        print("  (loopback only until login exists; set lan_access in settings.json to open it to the LAN)")
    print(f"  ComfyUI backend  {comfy_url(s)}\n")
    if args.open_browser:
        open_browser_when_ready(port)
    uvicorn.run(app, host=host, port=port, log_level="warning")


if __name__ == "__main__":
    main()
