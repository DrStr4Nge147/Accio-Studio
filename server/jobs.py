"""Job lifecycle: queue a built prompt in ComfyUI, follow it over ComfyUI's WebSocket, record results,
and relay progress to the app's own clients. Jobs live on the server; a reconnecting UI just re-attaches."""
from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from typing import Any

import websockets
from fastapi import WebSocket

from comfy import ComfyClient, ComfyError
from engine import Built
from history import History

log = logging.getLogger("accio.jobs")

PREVIEW_MIN_INTERVAL = 0.1  # <= 10 preview frames/s towards the UI


def friendly_execution_error(data: dict[str, Any]) -> str:
    text = f"{data.get('exception_type', '')} {data.get('exception_message', '')}".lower()
    if "out of memory" in text or "oom" in text:
        return "ComfyUI ran out of GPU memory for this job."
    if "not found" in text or "no such file" in text:
        return "A model file required by this job wasn't found."
    return "ComfyUI hit an error while running this job."


class JobManager:
    def __init__(self, comfy: ComfyClient, history: History):
        self.comfy = comfy
        self.history = history
        self.client_id = uuid.uuid4().hex
        self.clients: set[WebSocket] = set()
        self.live: dict[str, dict[str, Any]] = {}  # job id -> transient state (node, step, queue position)
        self._built: dict[str, Built] = {}  # job id -> build info (outputs map) for active jobs
        self._task: asyncio.Task | None = None
        self._last_preview = 0.0

    # ------------------------------------------------------------------ lifecycle

    async def start(self) -> None:
        self._task = asyncio.create_task(self._listen(), name="comfy-ws")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)

    # ------------------------------------------------------------------ public API

    async def submit(self, built: Built, params: dict[str, Any]) -> dict[str, Any]:
        job = {
            "id": uuid.uuid4().hex,
            "created_at": time.time(),
            "mode": built.mode,
            "label": built.label,
            "template": built.template,
            "status": "queued",
            "params": params,
            "seeds": built.seeds,
            "warnings": built.warnings,
        }
        job["prompt_id"] = await self.comfy.post_prompt(built.prompt, self.client_id)
        self.history.create(job)
        self._built[job["id"]] = built
        self.live[job["id"]] = {}
        await self._refresh_positions()
        await self._broadcast_job(job["id"])
        return self.public(job["id"])

    async def cancel(self, job_id: str) -> dict[str, Any] | None:
        job = self.history.get(job_id)
        if not job or job["status"] not in ("queued", "running") or not job["prompt_id"]:
            return job and self.public(job_id)
        # The queue is shared with the user's own ComfyUI use: only touch our own prompt.
        q = await self.comfy.queue()
        running_ids = [e[1] for e in q.get("queue_running", [])]
        if job["prompt_id"] in running_ids:
            await self.comfy.interrupt()
        else:
            await self.comfy.delete_queued([job["prompt_id"]])
            self._finish(job_id, "cancelled")
            await self._broadcast_job(job_id)
        return self.public(job_id)

    def public(self, job_id: str) -> dict[str, Any] | None:
        job = self.history.get(job_id)
        if not job:
            return None
        job = dict(job)
        job["live"] = self.live.get(job_id, {})
        return job

    # ------------------------------------------------------------------ app clients

    async def add_client(self, ws: WebSocket) -> None:
        self.clients.add(ws)
        await ws.send_json({"type": "snapshot", "jobs": [self.public(j["id"]) for j in self.history.active()]})

    def drop_client(self, ws: WebSocket) -> None:
        self.clients.discard(ws)

    async def _send_all(self, send) -> None:
        for ws in list(self.clients):
            try:
                await send(ws)
            except Exception:  # client went away
                self.clients.discard(ws)

    async def _broadcast_job(self, job_id: str) -> None:
        msg = {"type": "job", "job": self.public(job_id)}
        await self._send_all(lambda ws: ws.send_json(msg))

    # ------------------------------------------------------------------ ComfyUI event loop

    async def _listen(self) -> None:
        url = f"{self.comfy.ws_url}?clientId={self.client_id}"
        delay = 1.0
        while True:
            try:
                async with websockets.connect(url, max_size=None, ping_interval=20) as ws:
                    log.info("connected to ComfyUI websocket")
                    delay = 1.0
                    await self._reconcile()
                    async for raw in ws:
                        if isinstance(raw, bytes):
                            await self._on_preview(raw)
                        else:
                            await self._on_event(json.loads(raw))
            except asyncio.CancelledError:
                raise
            except Exception as e:  # offline, restart, bad frame...
                log.warning("ComfyUI websocket down (%r); retry in %.0fs", e, delay)
            await asyncio.sleep(delay)
            delay = min(delay * 2, 10.0)

    async def _on_preview(self, frame: bytes) -> None:
        now = time.monotonic()
        if now - self._last_preview < PREVIEW_MIN_INTERVAL or not self.clients:
            return
        self._last_preview = now
        await self._send_all(lambda ws: ws.send_bytes(frame))  # 8-byte ComfyUI header + image; the UI strips it

    def _job_for(self, prompt_id: str | None) -> dict[str, Any] | None:
        return self.history.by_prompt_id(prompt_id) if prompt_id else None

    async def _on_event(self, ev: dict[str, Any]) -> None:
        kind, data = ev.get("type"), ev.get("data", {})
        if kind == "status":
            await self._refresh_positions()
            return
        job = self._job_for(data.get("prompt_id"))
        if not job or job["status"] not in ("queued", "running"):
            return
        jid = job["id"]
        live = self.live.setdefault(jid, {})
        if kind == "execution_start":
            self.history.update(jid, status="running")
            live["queue_ahead"] = 0
        elif kind == "executing":
            if data.get("node") is None:
                await self._complete(jid)
                return
            live["node"] = data["node"]
            live["class"] = self._node_class(jid, data["node"])  # lets the UI show a phase (e.g. VAE decode)
            live.pop("step", None)
            live.pop("max", None)
        elif kind == "progress":
            live.update(node=data.get("node", live.get("node")), step=data.get("value"), max=data.get("max"))
        elif kind == "execution_success":
            await self._complete(jid)
            return
        elif kind == "execution_error":
            log.warning("execution_error for job %s: %s", jid, {k: str(v)[:300] for k, v in data.items() if k != "traceback"})
            self._finish(jid, "error", error=friendly_execution_error(data))
        elif kind == "execution_interrupted":
            self._finish(jid, "cancelled")
        else:
            return
        await self._broadcast_job(jid)

    def _node_class(self, jid: str, node: str) -> str | None:
        built = self._built.get(jid)
        n = built.prompt.get(node) if built else None
        return n["class_type"] if n else None

    async def _complete(self, jid: str) -> None:
        job = self.history.get(jid)
        try:
            hist = (await self.comfy.history(job["prompt_id"])).get(job["prompt_id"])
        except ComfyError:
            hist = None
        if not hist:
            self._finish(jid, "error", error="The job finished but its result couldn't be read from ComfyUI.")
        elif hist.get("status", {}).get("status_str") == "error":
            self._finish(jid, "error", error="ComfyUI hit an error while running this job.")
        else:
            built = self._built.get(jid)
            outs = hist.get("outputs", {})
            files = []
            for node, role in (built.outputs.items() if built else []):
                for img in outs.get(node, {}).get("images", []):
                    files.append({"node": node, "role": role, **{k: img[k] for k in ("filename", "subfolder", "type")}})
            used = None
            if built and built.prompt_used_node:
                texts = outs.get(built.prompt_used_node, {}).get("text") or []
                used = texts[0] if texts else None
            self._finish(jid, "done", outputs=files, prompt_used=used)
        await self._broadcast_job(jid)

    def _finish(self, jid: str, status: str, **fields: Any) -> None:
        self.history.finish(jid, status, **fields)
        self.live.pop(jid, None)
        self._built.pop(jid, None)

    # ------------------------------------------------------------------ queue position / recovery

    async def _refresh_positions(self) -> None:
        active = self.history.active()
        if not active:
            return
        try:
            q = await self.comfy.queue()
        except ComfyError:
            return
        running = [e[1] for e in q.get("queue_running", [])]
        pending = [e[1] for e in sorted(q.get("queue_pending", []), key=lambda e: e[0])]
        for job in active:
            pid = job["prompt_id"]
            live = self.live.setdefault(job["id"], {})
            if pid in running:
                live["queue_ahead"] = 0
            elif pid in pending:
                live["queue_ahead"] = len(running) + pending.index(pid)
            else:
                continue
            await self._broadcast_job(job["id"])

    async def _reconcile(self) -> None:
        """After (re)connecting, settle jobs whose events we missed (server restart, dropped socket)."""
        for job in self.history.active():
            pid = job["prompt_id"]
            try:
                hist = (await self.comfy.history(pid)).get(pid)
                q = await self.comfy.queue()
            except ComfyError:
                return
            in_queue = pid in [e[1] for e in q.get("queue_running", []) + q.get("queue_pending", [])]
            if hist and hist.get("outputs") is not None and hist.get("status", {}).get("completed", False):
                if job["id"] not in self._built:  # restart: outputs map unknown, rebuild from the template name
                    self._built[job["id"]] = _built_stub(job)
                await self._complete(job["id"])
            elif not in_queue and not hist:
                self._finish(job["id"], "error", error="This job was lost (ComfyUI restarted or cleared its queue).")
                await self._broadcast_job(job["id"])
        await self._refresh_positions()


def _built_stub(job: dict[str, Any]) -> Built:
    """Output map for a job recovered after a server restart (same constants as engine.py)."""
    t = job["template"]
    if t.startswith("krea_t2i"):
        outs, used = {"12": "final"}, None
    elif t.startswith("krea_combo"):
        outs, used = {"183": "final", "160": "first_pass"}, None
    elif t.startswith("qwen_multiedit"):
        outs, used = {"45": "final"}, "280"
    elif t == "qwen_inpaint":
        outs, used = {"64": "final"}, "215"
    else:
        outs, used = {"78": "final"}, None
    return Built({}, t, job["seeds"], outs, used, job["mode"], job["label"])
