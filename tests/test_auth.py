"""Login, sessions, the request guard and its edge cases (APP_SPEC 5.5)."""
import json

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

import auth as authlib
import config
import main

PASSWORD = "correct horse battery"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "SETTINGS_FILE", tmp_path / "settings.json")
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(main, "DATA_DIR", tmp_path)
    monkeypatch.setattr(main, "THUMBS_DIR", tmp_path / "thumbs")
    with TestClient(main.app) as c:
        yield c


def code_of(client) -> str:
    return client.app.state.auth.setup_code


def setup_and_login(client) -> None:
    r = client.post("/api/auth/setup", json={"password": PASSWORD, "code": code_of(client)})
    assert r.status_code == 200, r.text


# ----------------------------------------------------------------------------- unit


def test_scrypt_hash_roundtrip_and_salt():
    a, b = authlib.hash_password("hunter2hunter2"), authlib.hash_password("hunter2hunter2")
    assert a["salt"] != b["salt"] and a["hash"] != b["hash"]
    assert authlib.check_hash("hunter2hunter2", a)
    assert not authlib.check_hash("hunter2hunter3", a)
    assert not authlib.check_hash("x", {"nonsense": 1})


def test_password_rules():
    with pytest.raises(authlib.AuthError):
        authlib.validate_new_password("short")
    with pytest.raises(authlib.AuthError):
        authlib.validate_new_password("x" * 300)
    authlib.validate_new_password("x" * 10)


def test_rate_limiter_window_and_reset():
    now = [0.0]
    rl = authlib.RateLimiter(per_key=3, overall=100, window=60, clock=lambda: now[0])
    for _ in range(3):
        assert rl.retry_after("a") == 0
        rl.fail("a")
    assert rl.retry_after("a") > 0
    assert rl.retry_after("b") == 0  # another client is not blocked
    now[0] = 61
    assert rl.retry_after("a") == 0
    rl.fail("a")
    rl.success("a")
    assert rl.retry_after("a") == 0


def test_global_rate_limit_blocks_every_client():
    now = [0.0]
    rl = authlib.RateLimiter(per_key=100, overall=3, window=60, clock=lambda: now[0])
    for i in range(3):
        rl.fail(f"c{i}")
    assert rl.retry_after("new") > 0


def scope(host="localhost:7862", peer="127.0.0.1", headers=(), origin=None):
    h = [(b"host", host.encode()), *headers]
    if origin:
        h.append((b"origin", origin.encode()))
    return {"type": "http", "headers": h, "client": (peer, 1234), "scheme": "http"}


def test_local_direct_detection():
    assert authlib.is_local_direct(scope())
    assert authlib.is_local_direct(scope(host="127.0.0.1:7862"))
    assert authlib.is_local_direct(scope(host="[::1]:7862", peer="::1"))
    assert not authlib.is_local_direct(scope(host="abc.trycloudflare.com"))
    assert not authlib.is_local_direct(scope(headers=[(b"cf-connecting-ip", b"1.2.3.4")]))
    assert not authlib.is_local_direct(scope(headers=[(b"x-forwarded-for", b"1.2.3.4")]))
    assert not authlib.is_local_direct(scope(peer="192.168.1.20"))
    assert not authlib.is_local_direct(scope(host="evil.localhost.example.com"))


def test_same_origin():
    assert authlib.same_origin(scope())  # no Origin header
    assert authlib.same_origin(scope(origin="http://localhost:7862"))
    assert not authlib.same_origin(scope(origin="https://evil.example"))
    assert not authlib.same_origin(scope(origin="null"))


def test_same_origin_survives_a_tunnel_that_rewrites_host():
    rewritten = scope(host="127.0.0.1:7862", origin="https://abc.trycloudflare.com")
    assert not authlib.same_origin(rewritten)  # no other evidence: refuse
    assert authlib.same_origin(scope(host="127.0.0.1:7862", origin="https://abc.trycloudflare.com", headers=[(b"x-forwarded-host", b"abc.trycloudflare.com")]))
    assert authlib.same_origin(scope(host="127.0.0.1:7862", origin="https://abc.trycloudflare.com", headers=[(b"sec-fetch-site", b"same-origin")]))
    assert not authlib.same_origin(scope(origin="http://localhost:7862", headers=[(b"sec-fetch-site", b"cross-site")]))
    assert not authlib.same_origin(scope(origin="http://localhost:7862", headers=[(b"sec-fetch-site", b"same-site")]))


def test_client_key_uses_forwarded_address_only_behind_loopback():
    fwd = [(b"cf-connecting-ip", b"9.9.9.9")]
    assert authlib.client_key(scope(headers=fwd)) == "9.9.9.9"
    assert authlib.client_key(scope(peer="192.168.1.5", headers=fwd)) == "192.168.1.5"  # spoofable header ignored


def test_cookie_helpers():
    c = authlib.session_cookie("tok", 100, secure=True)
    assert "HttpOnly" in c and "SameSite=Lax" in c and "Secure" in c
    assert "Secure" not in authlib.session_cookie("tok", 100, secure=False)
    assert authlib.cookie_token({"headers": [(b"cookie", b"a=1; accio_session=abc; b=2")]}) == "abc"


# ----------------------------------------------------------------------------- integration


def test_private_routes_need_a_session(client):
    for path in ("/api/health", "/api/jobs", "/api/catalog", "/api/connection", "/api/queue", "/dev"):
        r = client.get(path)
        assert r.status_code == 401, path
    assert client.get("/api/auth/status").json() == {"configured": False, "authenticated": False, "setup_code_needed": True}


def test_first_run_setup_needs_the_code_from_afar(client):
    assert client.post("/api/auth/setup", json={"password": PASSWORD}).status_code == 403
    assert client.post("/api/auth/setup", json={"password": PASSWORD, "code": "wrong"}).status_code == 403
    assert client.post("/api/auth/setup", json={"password": "short", "code": code_of(client)}).status_code == 422
    assert not client.app.state.auth.configured
    r = client.post("/api/auth/setup", json={"password": PASSWORD, "code": code_of(client)})
    assert r.status_code == 200
    cookie = r.headers["set-cookie"]
    assert "HttpOnly" in cookie and "SameSite=lax" in cookie.replace("Lax", "lax")
    assert client.get("/api/queue").status_code in (200, 503)  # past the guard
    assert client.post("/api/auth/setup", json={"password": "another password", "code": "x"}).status_code == 409


def test_setup_from_this_pc_needs_no_code(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "SETTINGS_FILE", tmp_path / "settings.json")
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(main, "DATA_DIR", tmp_path)
    with TestClient(main.app, base_url="http://localhost:7862", client=("127.0.0.1", 50000)) as c:
        assert c.get("/api/auth/status").json()["setup_code_needed"] is False
        assert c.post("/api/auth/setup", json={"password": PASSWORD}).status_code == 200


def test_setup_always_needs_the_code_while_a_tunnel_runs(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "SETTINGS_FILE", tmp_path / "settings.json")
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(main, "DATA_DIR", tmp_path)
    monkeypatch.setattr(main.app.state, "tunnel_mode", "zrok", raising=False)
    try:
        with TestClient(main.app, base_url="http://localhost:7862", client=("127.0.0.1", 50000)) as c:
            assert c.get("/api/auth/status").json()["setup_code_needed"] is True
            assert c.post("/api/auth/setup", json={"password": PASSWORD}).status_code == 403
    finally:
        main.app.state.tunnel_mode = "local"


def test_localhost_needs_no_login_but_other_routes_in_do(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "SETTINGS_FILE", tmp_path / "settings.json")
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(main, "DATA_DIR", tmp_path)
    monkeypatch.setattr(main, "THUMBS_DIR", tmp_path / "thumbs")
    with TestClient(main.app, base_url="http://localhost:7862", client=("127.0.0.1", 50000)) as c:
        assert c.get("/api/auth/status").json()["authenticated"] is True
        assert c.get("/api/queue").status_code in (200, 503)  # past the guard, no cookie
        # A proxy header means it did not come straight from this PC.
        assert c.get("/api/queue", headers={"x-forwarded-for": "1.2.3.4"}).status_code == 401
    # Same-network device: loopback is not its peer address.
    with TestClient(main.app, base_url="http://localhost:7862", client=("192.168.1.20", 50000)) as c:
        assert c.get("/api/queue").status_code == 401
        assert c.get("/api/auth/status").json()["authenticated"] is False


def test_localhost_still_needs_login_while_a_tunnel_runs(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "SETTINGS_FILE", tmp_path / "settings.json")
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(main, "DATA_DIR", tmp_path)
    for mode in ("cloudflare", "zrok", "tailscale"):
        monkeypatch.setattr(main.app.state, "tunnel_mode", mode, raising=False)
        try:
            with TestClient(main.app, base_url="http://localhost:7862", client=("127.0.0.1", 50000)) as c:
                assert c.get("/api/queue").status_code == 401, mode
                assert c.get("/api/auth/status").json()["authenticated"] is False, mode
        finally:
            main.app.state.tunnel_mode = "local"


def test_password_is_stored_hashed_and_nothing_leaks(client, tmp_path):
    setup_and_login(client)
    text = (tmp_path / "settings.json").read_text(encoding="utf-8")
    assert PASSWORD not in text
    assert json.loads(text)["_auth"]["params"]["n"] >= 2**14
    sessions = (tmp_path / "sessions.json").read_text(encoding="utf-8")
    token = client.cookies.get("accio_session")
    assert token and token not in sessions  # only the digest is kept


def test_login_logout_cycle(client):
    setup_and_login(client)
    client.post("/api/auth/logout")
    assert client.get("/api/jobs").status_code == 401
    assert client.post("/api/auth/login", json={"password": "wrong password!"}).status_code == 401
    assert client.post("/api/auth/login", json={"password": PASSWORD}).status_code == 200
    assert client.get("/api/jobs").status_code == 200
    assert client.get("/api/auth/status").json()["authenticated"] is True


def test_failed_logins_are_rate_limited(client):
    setup_and_login(client)
    client.post("/api/auth/logout")
    codes = [client.post("/api/auth/login", json={"password": "wrong password!"}).status_code for _ in range(7)]
    assert codes[:5] == [401] * 5 and codes[5:] == [429, 429]
    assert client.post("/api/auth/login", json={"password": PASSWORD}).status_code == 429  # even the right one waits


def test_password_change_signs_other_sessions_out(client, tmp_path):
    setup_and_login(client)
    other = TestClient(main.app)
    assert other.post("/api/auth/login", json={"password": PASSWORD}).status_code == 200
    assert other.get("/api/jobs").status_code == 200
    r = client.post("/api/auth/password", json={"current": PASSWORD, "new": "a brand new password"})
    assert r.status_code == 200
    assert other.get("/api/jobs").status_code == 401  # old session is dead
    assert client.get("/api/jobs").status_code == 200  # this device got a fresh one
    assert client.post("/api/auth/login", json={"password": PASSWORD}).status_code == 401
    assert client.post("/api/auth/password", json={"current": "wrong password!", "new": "x" * 12}).status_code == 401


def test_expired_session_is_rejected(client):
    setup_and_login(client)
    a = client.app.state.auth
    sessions = {k: 1.0 for k in a._read_sessions()}  # expiry in 1970
    a._write_sessions(sessions)
    assert client.get("/api/jobs").status_code == 401


def test_cross_site_post_is_refused_even_with_a_session(client):
    setup_and_login(client)
    r = client.post("/api/auth/logout", headers={"Origin": "https://evil.example"})
    assert r.status_code == 403
    assert client.get("/api/jobs").status_code == 200  # still signed in
    ok = client.post("/api/auth/logout", headers={"Origin": "http://testserver"})
    assert ok.status_code == 200


def test_websocket_needs_a_session(client):
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/api/ws"):
            pass
    setup_and_login(client)
    with client.websocket_connect("/api/ws") as ws:
        assert ws.receive_json()["type"] == "snapshot"


def test_cookie_is_secure_behind_an_https_tunnel(client):
    r = client.post(
        "/api/auth/setup", json={"password": PASSWORD, "code": code_of(client)}, headers={"x-forwarded-proto": "https"}
    )
    assert "Secure" in r.headers["set-cookie"]


def test_security_headers_and_no_cors(client):
    r = client.get("/api/auth/status", headers={"Origin": "https://evil.example"})
    assert r.headers["x-content-type-options"] == "nosniff" and r.headers["x-frame-options"] == "DENY"
    assert "access-control-allow-origin" not in r.headers


def test_validation_errors_do_not_echo_internals(client):
    setup_and_login(client)
    r = client.post("/api/jobs", json={"params": {"mode": "create", "variant": "standard", "prompt": "x", "width": 13}})
    assert r.status_code == 422
    assert "Traceback" not in r.text and "site-packages" not in r.text


def test_static_app_is_public(client):
    assert client.get("/api/auth/status").status_code == 200
    assert client.get("/").status_code in (200, 404)  # 404 only when the frontend is not built; never 401


def test_reset_password_cli_removes_it(client, tmp_path, monkeypatch):
    setup_and_login(client)
    import subprocess
    import sys

    from pathlib import Path

    env_code = (
        "import sys; sys.path.insert(0, r'%s'); import config; "
        "config.SETTINGS_FILE = __import__('pathlib').Path(r'%s'); config.DATA_DIR = __import__('pathlib').Path(r'%s'); "
        "sys.argv = ['x', 'reset_password']; exec(open(r'%s').read())"
    ) % (Path(main.__file__).parent, tmp_path / "settings.json", tmp_path, Path(main.__file__).parent / "settings_cli.py")
    subprocess.run([sys.executable, "-c", env_code], check=True, capture_output=True)
    assert "_auth" not in json.loads((tmp_path / "settings.json").read_text(encoding="utf-8"))
    assert not (tmp_path / "sessions.json").exists()
