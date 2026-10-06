"""Thin async client for ComfyUI's HTTP API. The browser never talks to ComfyUI directly."""
from __future__ import annotations

import logging
from typing import Any

import httpx

log = logging.getLogger("accio.comfy")


class ComfyError(Exception):
    """Carries a friendly message for end users; technical detail goes to the log only."""

    def __init__(self, user_message: str, *, kind: str = "error", detail: str = "", node_errors: dict | None = None):
        super().__init__(user_message)
        self.user_message = user_message
        self.kind = kind
        self.detail = detail
        self.node_errors = node_errors or {}


class ComfyOffline(ComfyError):
    def __init__(self, detail: str = ""):
        super().__init__("ComfyUI isn't reachable. Make sure it is running.", kind="offline", detail=detail)


class ComfyClient:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")
        self._http = httpx.AsyncClient(base_url=self.base_url, timeout=httpx.Timeout(30.0, connect=5.0))

    async def aclose(self) -> None:
        await self._http.aclose()

    @property
    def ws_url(self) -> str:
        return self.base_url.replace("http://", "ws://", 1).replace("https://", "wss://", 1) + "/ws"

    async def _request(self, method: str, path: str, **kw: Any) -> httpx.Response:
        try:
            return await self._http.request(method, path, **kw)
        except httpx.HTTPError as e:
            raise ComfyOffline(repr(e)) from e

    async def _json(self, method: str, path: str, **kw: Any) -> Any:
        r = await self._request(method, path, **kw)
        if r.status_code >= 400:
            log.warning("ComfyUI %s %s -> %s %s", method, path, r.status_code, r.text[:500])
            raise ComfyError("ComfyUI returned an error.", detail=f"{r.status_code} {r.text[:500]}")
        return r.json()

    async def system_stats(self) -> dict:
        return await self._json("GET", "/system_stats")

    async def object_info(self, node: str | None = None) -> dict:
        return await self._json("GET", f"/object_info/{node}" if node else "/object_info")

    async def models(self, folder: str) -> list[str]:
        return await self._json("GET", f"/models/{folder}")

    async def queue(self) -> dict:
        return await self._json("GET", "/queue")

    async def history(self, prompt_id: str) -> dict:
        return await self._json("GET", f"/history/{prompt_id}")

    async def interrupt(self) -> None:
        await self._request("POST", "/interrupt")

    async def delete_queued(self, prompt_ids: list[str]) -> None:
        await self._request("POST", "/queue", json={"delete": prompt_ids})

    async def free(self) -> None:
        await self._request("POST", "/free", json={"unload_models": True, "free_memory": True})

    async def post_prompt(self, prompt: dict, client_id: str) -> str:
        r = await self._request("POST", "/prompt", json={"prompt": prompt, "client_id": client_id})
        if r.status_code == 200:
            return r.json()["prompt_id"]
        detail = r.text[:2000]
        log.warning("ComfyUI rejected prompt: %s %s", r.status_code, detail)
        node_errors: dict = {}
        try:
            body = r.json()
            node_errors = body.get("node_errors") or {}
        except ValueError:
            pass
        raise ComfyError(
            "ComfyUI rejected this job. A model or input may be missing or invalid.",
            kind="validation",
            detail=detail,
            node_errors=node_errors,
        )

    async def upload_image(self, data: bytes, filename: str, subfolder: str, content_type: str) -> dict:
        r = await self._request(
            "POST",
            "/upload/image",
            files={"image": (filename, data, content_type)},
            data={"subfolder": subfolder, "type": "input", "overwrite": "false"},
        )
        if r.status_code != 200:
            log.warning("ComfyUI upload failed: %s %s", r.status_code, r.text[:500])
            raise ComfyError("Couldn't upload the image to ComfyUI.", detail=r.text[:500])
        return r.json()

    def view_stream(self, filename: str, subfolder: str, type_: str) -> httpx.Request:
        return self._http.build_request("GET", "/view", params={"filename": filename, "subfolder": subfolder, "type": type_})

    async def send(self, request: httpx.Request, *, stream: bool = False) -> httpx.Response:
        try:
            return await self._http.send(request, stream=stream)
        except httpx.HTTPError as e:
            raise ComfyOffline(repr(e)) from e
