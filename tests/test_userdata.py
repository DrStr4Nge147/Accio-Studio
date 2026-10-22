"""/api/userdata: prompt templates and LoRA trigger words kept on the server so every device sees the same lists."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import config
import main

client = TestClient(main.app, raise_server_exceptions=False)

DOC = {
    "templates": [{"id": "t1", "name": "Portrait", "text": "a studio portrait", "target": "create"}],
    "trigger_words": {"krea2/ghibli.safetensors": ["ghibli style", "soft pastel"]},
}


@pytest.fixture
def api(session_token, tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATA_DIR", tmp_path / "data")
    client.cookies.set("accio_session", session_token)
    yield tmp_path / "data" / "userdata.json"
    client.cookies.clear()


def test_it_needs_a_session(session_token, tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATA_DIR", tmp_path / "data")
    client.cookies.clear()
    # The test client is not "localhost", so the login applies
    assert client.get("/api/userdata").status_code == 401
    assert client.put("/api/userdata", json=DOC).status_code == 401


def test_nothing_saved_yet_reads_as_empty(api):
    r = client.get("/api/userdata")
    assert r.status_code == 200
    assert r.json() == {"data": {"templates": [], "trigger_words": {}}, "updated": None}


def test_what_is_saved_is_read_back_and_kept_on_disk(api):
    put = client.put("/api/userdata", json=DOC)
    assert put.status_code == 200 and put.json()["updated"]
    assert api.is_file() and not api.with_suffix(".tmp").exists()
    assert client.get("/api/userdata").json()["data"] == DOC


def test_a_save_replaces_the_whole_document(api):
    client.put("/api/userdata", json=DOC)
    client.put("/api/userdata", json={"templates": [], "trigger_words": {}})
    assert client.get("/api/userdata").json()["data"] == {"templates": [], "trigger_words": {}}


@pytest.mark.parametrize(
    "bad",
    [
        {"templates": [{"id": "t", "name": "x", "text": "y", "target": "gallery"}]},
        {"templates": [{"id": "t", "name": "", "text": "y", "target": "edit"}]},
        {"templates": [{"id": "t", "name": "x", "text": "y" * 8001, "target": "edit"}]},
        {"trigger_words": {"a.safetensors": [""]}},
        {"trigger_words": {"a.safetensors": "not a list"}},
        {"templates": "nope"},
    ],
)
def test_bad_documents_are_refused_and_nothing_is_written(api, bad):
    assert client.put("/api/userdata", json=bad).status_code == 422
    assert not api.exists()


def test_an_unreadable_file_reads_as_empty_instead_of_failing(api):
    api.parent.mkdir(parents=True)
    api.write_text("{ not json", encoding="utf-8")
    r = client.get("/api/userdata")
    assert r.status_code == 200 and r.json()["data"] == {"templates": [], "trigger_words": {}}
