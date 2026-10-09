"""Single-user login (APP_SPEC 5.5).

- No default password: the first run forces a setup screen. Over a tunnel or the LAN, setup also needs the one-time code
  printed in this server's console, so a stranger who finds the URL first cannot claim the app. A browser on this PC
  talking to localhost directly does not need the code.
- A browser on this PC talking to localhost directly needs no login at all (authapi.local_trusted). Tunnels (cloudflare,
  zrok, tailscale) and the same-network address always require the password.
- The password is hashed with scrypt (random salt) and stored in settings.json under `_auth`.
- A login creates a random session token; only its SHA-256 is stored (data/sessions.json) with an expiry. Logout and a
  password change delete sessions. The token travels in an httpOnly, SameSite=Lax cookie (Secure over https).
- Failed logins are rate limited per client and globally. All secret comparisons are constant-time.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import secrets
import threading
import time
from collections import defaultdict, deque
from pathlib import Path
from typing import Any, Callable

import config

log = logging.getLogger("accio.auth")

COOKIE = "accio_session"
MIN_PASSWORD = 10
MAX_PASSWORD = 256
SCRYPT = {"n": 2**15, "r": 8, "p": 1, "dklen": 32}
SCRYPT_MAXMEM = 128 * 1024 * 1024
FORWARD_HEADERS = (b"x-forwarded-for", b"x-forwarded-host", b"forwarded", b"x-real-ip", b"cf-connecting-ip", b"cf-ray")
LOOPBACK = {"127.0.0.1", "::1", "localhost"}
LOCAL_HOSTS = {"localhost", "127.0.0.1", "[::1]", "::1"}


class AuthError(Exception):
    """Carries a message that is safe to show to the user."""

    def __init__(self, message: str, status: int = 400, code: str = "auth"):
        super().__init__(message)
        self.message, self.status, self.code = message, status, code


def hash_password(password: str, salt: bytes | None = None) -> dict[str, Any]:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, maxmem=SCRYPT_MAXMEM, **SCRYPT)
    return {"salt": base64.b64encode(salt).decode(), "hash": base64.b64encode(digest).decode(), "params": dict(SCRYPT)}


def check_hash(password: str, record: dict[str, Any]) -> bool:
    try:
        params = {k: int(v) for k, v in record["params"].items()}
        digest = hashlib.scrypt(
            password.encode("utf-8"), salt=base64.b64decode(record["salt"]), maxmem=SCRYPT_MAXMEM, **params
        )
        return hmac.compare_digest(digest, base64.b64decode(record["hash"]))
    except (KeyError, ValueError, TypeError):
        return False


def validate_new_password(password: str) -> None:
    if len(password) < MIN_PASSWORD:
        raise AuthError(f"Use at least {MIN_PASSWORD} characters.", 422, "weak_password")
    if len(password) > MAX_PASSWORD:
        raise AuthError("That password is too long.", 422, "weak_password")


class RateLimiter:
    """Failed attempts per key (and one global bucket) inside a sliding window."""

    def __init__(self, per_key: int = 5, overall: int = 40, window: float = 600.0, clock: Callable[[], float] = time.monotonic):
        self.per_key, self.overall, self.window, self.clock = per_key, overall, window, clock
        self._fails: dict[str, deque[float]] = defaultdict(deque)
        self._all: deque[float] = deque()
        self._lock = threading.Lock()

    def _trim(self, q: deque[float], now: float) -> None:
        while q and now - q[0] > self.window:
            q.popleft()

    def retry_after(self, key: str) -> int:
        """Seconds to wait, or 0 when an attempt is allowed."""
        now = self.clock()
        with self._lock:
            self._trim(self._all, now)
            q = self._fails[key]
            self._trim(q, now)
            waits = []
            if len(q) >= self.per_key:
                waits.append(q[0] + self.window - now)
            if len(self._all) >= self.overall:
                waits.append(self._all[0] + self.window - now)
            if not q:
                self._fails.pop(key, None)
            return int(max(waits)) + 1 if waits else 0

    def fail(self, key: str) -> None:
        now = self.clock()
        with self._lock:
            self._fails[key].append(now)
            self._all.append(now)

    def success(self, key: str) -> None:
        with self._lock:
            self._fails.pop(key, None)


class Auth:
    def __init__(self, sessions_file: Path, session_days: float = 14):
        self.sessions_file = sessions_file
        self.session_seconds = max(1.0, float(session_days)) * 86400
        self.limiter = RateLimiter()
        self._lock = threading.RLock()
        self.setup_code: str | None = None
        if not self.configured:
            self.setup_code = secrets.token_urlsafe(6)

    # ------------------------------------------------------------------ password

    @staticmethod
    def _record() -> dict[str, Any] | None:
        rec = config.load_settings().get("_auth")
        return rec if isinstance(rec, dict) and "hash" in rec else None

    @property
    def configured(self) -> bool:
        return self._record() is not None

    def setup(self, password: str, code: str | None, local_direct: bool, client: str) -> None:
        if self.configured:
            raise AuthError("A password is already set.", 409, "already_configured")
        wait = self.limiter.retry_after(client)
        if wait:
            raise AuthError(f"Too many attempts. Try again in {wait} s.", 429, "rate_limited")
        if not local_direct:
            if not self.setup_code or not code or not hmac.compare_digest(code.strip().encode(), self.setup_code.encode()):
                self.limiter.fail(client)
                raise AuthError("That setup code is not right. It is printed in the Accio server window.", 403, "bad_code")
        validate_new_password(password)
        config.save_setting("_auth", hash_password(password))
        self.setup_code = None
        self.limiter.success(client)
        self._write_sessions({})

    def verify(self, password: str, client: str) -> None:
        """Raises AuthError unless the password is right (rate limited, constant-time)."""
        wait = self.limiter.retry_after(client)
        if wait:
            raise AuthError(f"Too many attempts. Try again in {wait} s.", 429, "rate_limited")
        rec = self._record()
        # Always run the KDF so a wrong password and "no password set" take the same time.
        ok = check_hash(password, rec) if rec else (check_hash(password, _DUMMY) and False)
        if not ok:
            self.limiter.fail(client)
            raise AuthError("That password is not right.", 401, "bad_password")
        self.limiter.success(client)

    def change_password(self, current: str, new: str, client: str) -> None:
        self.verify(current, client)
        validate_new_password(new)
        config.save_setting("_auth", hash_password(new))
        self._write_sessions({})  # every session, on every device, is signed out

    # ------------------------------------------------------------------ sessions

    def _read_sessions(self) -> dict[str, float]:
        try:
            data = json.loads(self.sessions_file.read_text(encoding="utf-8"))
            return {k: float(v) for k, v in data.items()} if isinstance(data, dict) else {}
        except (OSError, ValueError, TypeError):
            return {}

    def _write_sessions(self, sessions: dict[str, float]) -> None:
        with self._lock:
            self.sessions_file.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.sessions_file.with_suffix(".tmp")
            tmp.write_text(json.dumps(sessions), encoding="utf-8")
            tmp.replace(self.sessions_file)

    @staticmethod
    def _digest(token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    def create_session(self) -> str:
        token = secrets.token_urlsafe(32)
        now = time.time()
        with self._lock:
            sessions = {k: v for k, v in self._read_sessions().items() if v > now}
            sessions[self._digest(token)] = now + self.session_seconds
            self._write_sessions(sessions)
        return token

    def valid(self, token: str | None) -> bool:
        if not token or len(token) > 200 or not self.configured:
            return False
        key = self._digest(token)
        with self._lock:
            expiry = self._read_sessions().get(key)
        return expiry is not None and expiry > time.time()

    def end_session(self, token: str | None) -> None:
        if not token:
            return
        with self._lock:
            sessions = self._read_sessions()
            if sessions.pop(self._digest(token), None) is not None:
                self._write_sessions(sessions)


_DUMMY = hash_password("not-a-real-password", b"\x00" * 16)


# ---------------------------------------------------------------------- request helpers (ASGI scope based)

def _headers(scope: dict) -> dict[bytes, bytes]:
    return {k.lower(): v for k, v in scope.get("headers", [])}


def peer(scope: dict) -> str:
    client = scope.get("client")
    return client[0] if client else ""


def is_local_direct(scope: dict) -> bool:
    """A browser on this PC talking straight to localhost: loopback peer, no proxy headers, a localhost Host."""
    h = _headers(scope)
    if peer(scope) not in LOOPBACK or any(name in h for name in FORWARD_HEADERS):
        return False
    host = h.get(b"host", b"").decode("latin-1").lower()
    hostname = host.rsplit(":", 1)[0] if not host.startswith("[") else host.split("]")[0] + "]"
    return hostname in LOCAL_HOSTS


def client_key(scope: dict) -> str:
    """Who a rate-limit bucket belongs to. Behind a local tunnel every peer is loopback, so use the forwarded address."""
    h = _headers(scope)
    p = peer(scope)
    if p in LOOPBACK:
        for name in (b"cf-connecting-ip", b"x-forwarded-for", b"x-real-ip"):
            if name in h:
                return h[name].decode("latin-1").split(",")[0].strip()[:64]
    return p or "unknown"


def cookie_token(scope: dict) -> str | None:
    raw = _headers(scope).get(b"cookie", b"").decode("latin-1")
    for part in raw.split(";"):
        name, _, value = part.strip().partition("=")
        if name == COOKIE:
            return value
    return None


def is_https(scope: dict) -> bool:
    if scope.get("scheme") in ("https", "wss"):
        return True
    return _headers(scope).get(b"x-forwarded-proto", b"").decode("latin-1").split(",")[0].strip().lower() == "https"


def same_origin(scope: dict) -> bool:
    """True unless the request looks cross-site. Blocks cross-site form posts and sockets.

    Tunnels and proxies may rewrite the Host header, so a plain Origin == Host comparison would refuse our own page. The
    browser-set Sec-Fetch-Site header (a page cannot forge it) decides when present; otherwise the Origin must match
    Host or X-Forwarded-Host.
    """
    h = _headers(scope)
    fetch_site = h.get(b"sec-fetch-site", b"").decode("latin-1").lower()
    if fetch_site:
        return fetch_site in ("same-origin", "none")
    origin = h.get(b"origin")
    if origin is None:
        return True
    value = origin.decode("latin-1").lower().split("://", 1)[-1]
    allowed = {h.get(name, b"").decode("latin-1").lower().split(",")[0].strip() for name in (b"host", b"x-forwarded-host")}
    return value in allowed


def session_cookie(token: str, max_age: int, secure: bool) -> str:
    parts = [f"{COOKIE}={token}", "Path=/", f"Max-Age={max_age}", "HttpOnly", "SameSite=Lax"]
    if secure:
        parts.append("Secure")
    return "; ".join(parts)


def clear_cookie(secure: bool) -> str:
    return session_cookie("", 0, secure)
