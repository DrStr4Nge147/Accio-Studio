"""Settings > Models: the download manager and /api/models."""
from __future__ import annotations

import json
import struct
import sys
import threading
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import config
import main
import modeldownloads
from modeldownloads import ModelDownloads

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "installer"))
import modelfiles  # noqa: E402
from core import DownloadCancelled  # noqa: E402

client = TestClient(main.app, raise_server_exceptions=False)


def safetensors_bytes() -> bytes:
    header = json.dumps({"w": {"dtype": "F32", "shape": [4], "data_offsets": [0, 16]}}).encode()
    return struct.pack("<Q", len(header)) + header + b"\0" * 16


DATA = safetensors_bytes()


def entry(name: str, **kw) -> dict:
    return {"file": name, "folder": "loras", "size": len(DATA), "required": True, "url": f"http://x/{name}", "used_by": "Create", **kw}


MANIFEST = {"models": [entry("a.safetensors"), entry("b.safetensors"), entry("c.safetensors", required=False, group="klein")]}


class Fetcher:
    """Stands in for curl: writes a good file, or fails / blocks until cancelled on request."""

    def __init__(self):
        self.calls: list[str] = []
        self.fail: set[str] = set()
        self.block: set[str] = set()
        self.started = threading.Event()

    def __call__(self, url, dest, expected_size=None, cancel=None, quiet=False):
        name = url.rsplit("/", 1)[1]
        self.calls.append(name)
        dest.parent.mkdir(parents=True, exist_ok=True)
        if name in self.block:
            dest.with_name(dest.name + ".part").write_bytes(DATA[:10])
            self.started.set()
            while not cancel.is_set():
                time.sleep(0.01)
            raise DownloadCancelled("download cancelled")
        if name in self.fail:
            raise RuntimeError("download failed")
        dest.write_bytes(DATA)


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setattr(modelfiles.core, "ROOT", tmp_path)  # no settings.json: nothing counts as "found elsewhere"
    monkeypatch.setattr(modeldownloads, "free_space", lambda p: 10**12)
    monkeypatch.setattr(modelfiles, "free_space", lambda p: 10**12)
    fetcher = Fetcher()
    monkeypatch.setattr(modelfiles, "curl_download", fetcher)
    finished = []
    mgr = ModelDownloads(MANIFEST, on_finish=lambda: finished.append(1))
    return mgr, tmp_path / "models", fetcher, finished


def states(mgr, models_dir):
    return {m["id"]: m["state"] for m in mgr.listing(models_dir)["models"]}


def test_listing_tells_installed_from_missing_and_partial(env):
    mgr, models, _, _ = env
    (models / "loras").mkdir(parents=True)
    (models / "loras" / "a.safetensors").write_bytes(DATA)
    (models / "loras" / "b.safetensors.part").write_bytes(DATA[:7])
    (models / "loras" / "c.safetensors").write_bytes(DATA[:5])  # truncated
    rows = {m["id"]: m for m in mgr.listing(models)["models"]}
    assert (rows["a.safetensors"]["state"], rows["b.safetensors"]["state"], rows["c.safetensors"]["state"]) == ("installed", "partial", "damaged")
    assert rows["b.safetensors"]["bytes"] == 7
    assert rows["c.safetensors"]["group"] == "klein" and rows["a.safetensors"]["required"] is True


def test_a_job_downloads_verifies_and_reports_done(env):
    mgr, models, fetcher, finished = env
    mgr.start(["a.safetensors", "b.safetensors"], models)
    mgr.wait(5)
    job = mgr.job()
    assert job["state"] == "done" and job["done"] == ["a.safetensors", "b.safetensors"] and job["failed"] == []
    assert fetcher.calls == ["a.safetensors", "b.safetensors"] and finished == [1]
    assert states(mgr, models)["a.safetensors"] == "installed"


def test_installed_models_are_skipped_and_all_installed_is_refused(env):
    mgr, models, fetcher, _ = env
    mgr.start(["a.safetensors"], models)
    mgr.wait(5)
    with pytest.raises(modeldownloads.DownloadError, match="already installed"):
        mgr.start(["a.safetensors"], models)
    mgr.start(["a.safetensors", "b.safetensors"], models)
    mgr.wait(5)
    assert fetcher.calls == ["a.safetensors", "b.safetensors"]  # a was not fetched twice


def test_a_failed_download_is_reported_and_the_rest_continue(env):
    mgr, models, fetcher, _ = env
    fetcher.fail.add("a.safetensors")
    mgr.start(["a.safetensors", "b.safetensors"], models)
    mgr.wait(5)
    job = mgr.job()
    assert job["state"] == "failed" and job["failed"] == ["a.safetensors"] and job["done"] == ["b.safetensors"]
    assert "try again" in job["message"]


def test_cancel_stops_the_job_and_keeps_the_partial_file(env):
    mgr, models, fetcher, finished = env
    fetcher.block.add("a.safetensors")
    mgr.start(["a.safetensors", "b.safetensors"], models)
    assert fetcher.started.wait(5)
    assert states(mgr, models) == {"a.safetensors": "downloading", "b.safetensors": "queued", "c.safetensors": "missing"}
    mgr.cancel()
    mgr.wait(5)
    assert mgr.job()["state"] == "cancelled" and fetcher.calls == ["a.safetensors"] and finished == [1]
    assert states(mgr, models)["a.safetensors"] == "partial"  # resumes next time
    assert (models / "loras" / "a.safetensors.part").is_file()


def test_only_one_job_runs_at_a_time(env):
    mgr, models, fetcher, _ = env
    fetcher.block.add("a.safetensors")
    mgr.start(["a.safetensors"], models)
    assert fetcher.started.wait(5)
    with pytest.raises(modeldownloads.DownloadError) as e:
        mgr.start(["b.safetensors"], models)
    assert e.value.status == 409
    mgr.cancel()
    mgr.wait(5)


def test_unknown_ids_and_low_disk_space_are_refused(env, monkeypatch):
    mgr, models, fetcher, _ = env
    for bad in ([], ["nope.safetensors"], ["a.safetensors", "../x"]):
        with pytest.raises(modeldownloads.DownloadError, match="Unknown model"):
            mgr.start(bad, models)
    monkeypatch.setattr(modeldownloads, "free_space", lambda p: 1)
    with pytest.raises(modeldownloads.DownloadError, match="disk space"):
        mgr.start(["a.safetensors"], models)
    assert fetcher.calls == [] and mgr.job()["state"] == "idle"


# --------------------------------------------------------------------------- API

@pytest.fixture
def api(session_token, tmp_path, monkeypatch, env):
    mgr, _, fetcher, _ = env
    base = tmp_path / "comfy"
    (base / "ComfyUI" / "models").mkdir(parents=True)
    monkeypatch.setattr(config, "SETTINGS_FILE", tmp_path / "settings.json")
    monkeypatch.setattr(config, "comfy_dir", lambda s: base)
    monkeypatch.setattr(main.app.state, "settings", config.load_settings(), raising=False)
    monkeypatch.setattr(main.app.state, "downloads", mgr, raising=False)
    client.cookies.set("accio_session", session_token)
    yield base / "ComfyUI" / "models", mgr, fetcher
    client.cookies.clear()


def test_api_lists_downloads_and_serves_the_job(api):
    models, mgr, fetcher = api
    body = client.get("/api/models").json()
    assert body["available"] is True and len(body["models"]) == 3 and body["job"]["state"] == "idle"
    r = client.post("/api/models/download", json={"ids": ["a.safetensors"]})
    assert r.status_code == 202
    mgr.wait(5)
    assert (models / "loras" / "a.safetensors").is_file()
    assert {m["id"]: m["state"] for m in client.get("/api/models").json()["models"]}["a.safetensors"] == "installed"


def test_api_refuses_unknown_models_and_a_second_job(api):
    models, mgr, fetcher = api
    r = client.post("/api/models/download", json={"ids": ["https://evil.example/x.safetensors"]})
    assert r.status_code == 400 and r.json()["error"]["message"] == "Unknown model."
    fetcher.block.add("a.safetensors")
    assert client.post("/api/models/download", json={"ids": ["a.safetensors"]}).status_code == 202
    assert fetcher.started.wait(5)
    assert client.post("/api/models/download", json={"ids": ["b.safetensors"]}).status_code == 409
    assert client.post("/api/models/cancel").status_code == 200
    mgr.wait(5)
    assert client.get("/api/models").json()["job"]["state"] == "cancelled"


def test_api_needs_a_login(api):
    client.cookies.clear()
    assert client.get("/api/models").status_code == 401
    assert client.post("/api/models/download", json={"ids": ["a.safetensors"]}).status_code == 401
    assert client.post("/api/models/cancel").status_code == 401


def test_api_is_off_for_an_external_backend(api, monkeypatch):
    models, mgr, fetcher = api
    monkeypatch.setitem(main.app.state.settings, "external_comfy_url", "http://example.invalid:1")
    assert client.get("/api/models").json()["available"] is False
    r = client.post("/api/models/download", json={"ids": ["a.safetensors"]})
    assert r.status_code == 400 and "external backend" in r.json()["error"]["message"]
    assert fetcher.calls == []
