"""Spec 7.5 error paths against the real bundled backend (skipped when it is offline).

Always run when the backend is up (nothing executes): a model missing on disk is rejected by the backend's validation.
Set ACCIO_LIVE_JOBS=1 to also run two tiny real jobs on the GPU: a node execution error and a cancel mid-run.
Everything runs in a scratch data folder; the real history, settings and password are never touched.
"""
from __future__ import annotations

import json
import os
import time
import urllib.request

import pytest
from fastapi.testclient import TestClient

import config
import engine
import main
from config import comfy_url, load_settings

URL = os.environ.get("COMFY_URL") or comfy_url(load_settings())


def _online() -> bool:
    try:
        with urllib.request.urlopen(f"{URL}/system_stats", timeout=3):
            return True
    except OSError:
        return False


pytestmark = pytest.mark.skipif(not _online(), reason="backend offline")
jobs_only = pytest.mark.skipif(os.environ.get("ACCIO_LIVE_JOBS") != "1", reason="set ACCIO_LIVE_JOBS=1 to run real GPU jobs")

LEAKS = ["Traceback", "File \"", "C:\\", "E:\\", "site-packages", "node_errors", "execution.py", "torch."]
CREATE = {"params": {"mode": "create", "variant": "standard", "prompt": "a red fox", "width": 256, "height": 256, "seed": 1, "seed_variance_seed": 2}}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "SETTINGS_FILE", tmp_path / "settings.json")
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(main, "DATA_DIR", tmp_path)
    monkeypatch.setattr(main, "THUMBS_DIR", tmp_path / "thumbs")
    monkeypatch.setattr(main, "UPLOADS_DIR", tmp_path / "uploads")
    with TestClient(main.app, raise_server_exceptions=False) as c:
        code = c.app.state.auth.setup_code
        assert c.post("/api/auth/setup", json={"password": "correct horse battery", "code": code}).status_code == 200
        yield c


def clean(text: str) -> None:
    for bad in LEAKS:
        assert bad not in text, f"{bad!r} leaked: {text[:300]}"


def wait_for(client, job_id: str, states: tuple[str, ...], timeout: float) -> dict:
    t0 = time.time()
    while time.time() - t0 < timeout:
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] in states:
            return job
        time.sleep(1)
    raise TimeoutError(f"job {job_id} did not reach {states}: last {job['status']}")


def test_missing_model_is_rejected_with_a_friendly_message(client, monkeypatch):
    real_build = engine.build

    def build_with_missing_model(*a, **k):
        built = real_build(*a, **k)
        loaders = [n for n in built.prompt.values() if n["class_type"] == "UNETLoader"]
        assert loaders, "template has no UNETLoader to tamper with"
        loaders[0]["inputs"]["unet_name"] = "this_model_is_not_installed.safetensors"
        return built

    monkeypatch.setattr(main.engine, "build", build_with_missing_model)
    r = client.post("/api/jobs", json=CREATE)
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation"
    assert "missing or invalid" in r.json()["error"]["message"]
    clean(r.text)
    assert "this_model_is_not_installed" not in r.text
    assert client.get("/api/jobs").json()["jobs"] == []  # a rejected job leaves no history entry


@jobs_only
def test_execution_error_is_friendly(client):
    """A picture the backend cannot find: it passes validation, then fails while running."""
    params = {"mode": "multiedit", "prompt": "Make it night.", "prompt_enhancer": False, "seed": 3,
              "images": [{"file": "does-not-exist-0123.png", "name": "ghost.png"}]}
    r = client.post("/api/jobs", json={"params": params})
    assert r.status_code == 201, r.text
    job = wait_for(client, r.json()["id"], ("error", "done", "cancelled"), 600)
    assert job["status"] == "error"
    assert job["error"] and len(job["error"]) < 120
    clean(json.dumps(job))


@jobs_only
def test_cancel_mid_run(client):
    r = client.post("/api/jobs", json=CREATE)
    assert r.status_code == 201, r.text
    jid = r.json()["id"]
    wait_for(client, jid, ("running",), 120)
    time.sleep(2)  # let sampling start
    assert client.post(f"/api/jobs/{jid}/cancel").status_code == 200
    job = wait_for(client, jid, ("cancelled", "done", "error"), 180)
    assert job["status"] == "cancelled", job
    assert not job.get("error")
    clean(json.dumps(job))
