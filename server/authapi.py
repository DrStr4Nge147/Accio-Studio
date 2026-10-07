"""HTTP side of the login: the ASGI guard in front of everything private, and the /api/auth routes."""
from __future__ import annotations

import json

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

import auth as authlib
from auth import Auth, AuthError

PUBLIC_PATHS = {"/api/auth/status", "/api/auth/login", "/api/auth/setup"}
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
SECURITY_HEADERS = [
    (b"x-content-type-options", b"nosniff"),
    (b"x-frame-options", b"DENY"),
    (b"referrer-policy", b"no-referrer"),
]


def guarded(path: str) -> bool:
    """The API, the live socket and the dev page need a session. The built app and its assets are public (they hold no data)."""
    return (path.startswith("/api/") or path == "/dev") and path not in PUBLIC_PATHS


def _json_error(status: int, code: str, message: str) -> bytes:
    return json.dumps({"error": {"code": code, "message": message}}).encode()


class GuardMiddleware:
    """Pure ASGI so it covers WebSockets too. Rejects unauthenticated and cross-origin requests before any route runs."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket"):
            return await self.app(scope, receive, send)
        path = scope["path"]
        unsafe = scope["type"] == "websocket" or scope["method"] not in SAFE_METHODS
        denial: tuple[int, str, str] | None = None
        if unsafe and path.startswith("/api/") and not authlib.same_origin(scope):
            denial = (403, "origin", "This request came from another site.")
        elif guarded(path):
            auth: Auth = scope["app"].state.auth
            if not auth.configured:
                denial = (401, "setup_required", "Set a password first.")
            elif not auth.valid(authlib.cookie_token(scope)):
                denial = (401, "auth", "Please sign in.")
        if denial:
            return await self._deny(scope, receive, send, *denial)

        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                message["headers"] = [*message.get("headers", []), *SECURITY_HEADERS]
            await send(message)

        await self.app(scope, receive, send_with_headers if scope["type"] == "http" else send)

    @staticmethod
    async def _deny(scope, receive, send, status: int, code: str, message: str):
        if scope["type"] == "websocket":
            await receive()  # the connect event
            await send({"type": "websocket.close", "code": 4401})
            return
        body = _json_error(status, code, message)
        await send(
            {
                "type": "http.response.start",
                "status": status,
                "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode()), (b"cache-control", b"no-store"), *SECURITY_HEADERS],
            }
        )
        await send({"type": "http.response.body", "body": body})


class SetupBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    password: str = Field(max_length=authlib.MAX_PASSWORD)
    code: str | None = Field(None, max_length=64)


class LoginBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    password: str = Field(max_length=authlib.MAX_PASSWORD)


class ChangeBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    current: str = Field(max_length=authlib.MAX_PASSWORD)
    new: str = Field(max_length=authlib.MAX_PASSWORD)


router = APIRouter(prefix="/api/auth")


def _auth(request: Request) -> Auth:
    return request.app.state.auth


def _local_setup_ok(request: Request) -> bool:
    """No setup code from this PC's own browser, except while a tunnel is up: a tunnel may rewrite Host and hide who is calling."""
    return getattr(request.app.state, "tunnel_mode", "local") == "local" and authlib.is_local_direct(request.scope)


def _error(e: AuthError) -> JSONResponse:
    return JSONResponse({"error": {"code": e.code, "message": e.message}}, status_code=e.status)


def _with_session(request: Request, body: dict) -> JSONResponse:
    auth = _auth(request)
    token = auth.create_session()
    res = JSONResponse(body)
    res.headers["set-cookie"] = authlib.session_cookie(token, int(auth.session_seconds), authlib.is_https(request.scope))
    res.headers["cache-control"] = "no-store"
    return res


@router.get("/status")
async def status(request: Request):
    auth = _auth(request)
    configured = auth.configured
    return JSONResponse(
        {
            "configured": configured,
            "authenticated": configured and auth.valid(authlib.cookie_token(request.scope)),
            # Setting the first password from this PC's own browser needs no code; from anywhere else it does.
            "setup_code_needed": not configured and not _local_setup_ok(request),
        },
        headers={"cache-control": "no-store"},
    )


@router.post("/setup")
async def setup(body: SetupBody, request: Request):
    try:
        _auth(request).setup(body.password, body.code, _local_setup_ok(request), authlib.client_key(request.scope))
    except AuthError as e:
        return _error(e)
    return _with_session(request, {"ok": True})


@router.post("/login")
async def login(body: LoginBody, request: Request):
    try:
        _auth(request).verify(body.password, authlib.client_key(request.scope))
    except AuthError as e:
        return _error(e)
    return _with_session(request, {"ok": True})


@router.post("/logout")
async def logout(request: Request):
    _auth(request).end_session(authlib.cookie_token(request.scope))
    res = JSONResponse({"ok": True})
    res.headers["set-cookie"] = authlib.clear_cookie(authlib.is_https(request.scope))
    return res


@router.post("/password")
async def change_password(body: ChangeBody, request: Request):
    try:
        _auth(request).change_password(body.current, body.new, authlib.client_key(request.scope))
    except AuthError as e:
        return _error(e)
    return _with_session(request, {"ok": True})  # other devices are signed out; this one gets a fresh session
