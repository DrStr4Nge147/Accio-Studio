"""/api/input serves back our own uploads; names and kinds are validated before anything reaches the backend."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from main import INPUT_NAME, app

client = TestClient(app, raise_server_exceptions=False)


@pytest.fixture(autouse=True)
def signed_in(session_token):
    client.cookies.set("accio_session", session_token)
    yield
    client.cookies.clear()  # no lifespan: bad requests must be refused before any upstream call


@pytest.mark.parametrize("name", ["a1b2.png", "0123456789abcdef0123456789abcdef.jpg", "x_y-z.webp"])
def test_server_generated_names_pass(name):
    assert INPUT_NAME.fullmatch(name)


@pytest.mark.parametrize("name", ["..", ".png", "a/b.png", "a\b.png", "a b.png", "", "x" * 200 + ".png", "%2e%2e"])
def test_other_names_are_rejected(name):
    assert not INPUT_NAME.fullmatch(name)


@pytest.mark.parametrize("path", ["/api/input/media/..%2fsecret.png", "/api/input/mask/a.png", "/api/input/other/a.png", "/api/input/image/a%20b.png"])
def test_bad_requests_are_404(path):
    r = client.get(path)
    assert r.status_code == 404  # either our own refusal or no route at all; never a proxied file


def test_our_own_copy_is_served_without_the_backend(tmp_path, monkeypatch):
    import main

    monkeypatch.setattr(main, "UPLOADS_DIR", tmp_path)
    main.save_upload_copy("accio", "abc123.png", b"PNG-test")
    assert (tmp_path / "accio" / "abc123.png").read_bytes() == b"PNG-test"
    r = client.get("/api/input/image/abc123.png")  # no lifespan, so any call to the backend would fail
    assert r.status_code == 200 and r.content == b"PNG-test"
    assert "immutable" in r.headers["cache-control"]
    assert client.get("/api/input/media/abc123.png").status_code != 200  # a different subfolder: not this file


def test_a_copy_is_never_written_outside_the_uploads_folder(tmp_path, monkeypatch):
    import main

    monkeypatch.setattr(main, "UPLOADS_DIR", tmp_path / "u")
    main.save_upload_copy("accio", "../escape.png", b"x")
    main.save_upload_copy("accio", "a/b.png", b"x")
    assert not (tmp_path / "escape.png").exists() and not (tmp_path / "u").exists()
