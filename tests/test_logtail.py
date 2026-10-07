"""The ComfyUI console log is read by byte offset; a restarted (truncated) log must reset the reader."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import logtail
from logtail import read_log
from main import app

client = TestClient(app, raise_server_exceptions=False)


@pytest.fixture(autouse=True)
def signed_in(session_token):
    client.cookies.set("accio_session", session_token)
    yield
    client.cookies.clear()


def test_missing_log_is_unavailable(tmp_path):
    assert read_log(tmp_path / "none.log", None)["available"] is False


def test_first_read_is_the_tail_then_only_new_bytes(tmp_path, monkeypatch):
    monkeypatch.setattr(logtail, "FIRST_TAIL", 10)
    log = tmp_path / "c.log"
    log.write_bytes(b"0123456789abcdef\n")
    first = read_log(log, None)
    assert first["text"] == "789abcdef\n"[-10:] and first["reset"] is True
    with log.open("ab") as f:
        f.write(b"next\n")
    second = read_log(log, first["offset"])
    assert second["text"] == "next\n" and second["reset"] is False
    assert read_log(log, second["offset"])["text"] == ""


def test_a_truncated_log_resets(tmp_path):
    log = tmp_path / "c.log"
    log.write_bytes(b"old old old old\n")
    seen = read_log(log, None)["offset"]
    log.write_bytes(b"new\n")
    r = read_log(log, seen)
    assert r["reset"] is True and r["text"] == "new\n"


def test_a_multibyte_character_is_never_split(tmp_path):
    log = tmp_path / "c.log"
    data = "ab€".encode()  # € is 3 bytes
    log.write_bytes(data[:-1])  # the writer is mid-character
    a = read_log(log, 0)
    assert a["text"] == "ab"
    log.write_bytes(data)
    b = read_log(log, a["offset"])
    assert b["text"] == "€"


def test_route_reports_external_backend(monkeypatch):
    import main

    monkeypatch.setattr(main.app.state, "settings", {"external_comfy_url": "http://x:1"}, raising=False)
    r = client.get("/api/logs/comfy")
    assert r.status_code == 200 and r.json()["available"] is False and r.json()["external"] is True
