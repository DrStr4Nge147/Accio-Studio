"""Spec 7.5 error paths against a stubbed backend: backend offline, missing model, a validation error from /prompt,
a node execution error, cancel. Each must give a friendly message and never leak a stack trace, a path, a
provider response or the backend's address. (tests/test_live_errors.py runs the same paths on the real backend.)"""
from __future__ import annotations

import asyncio
import json

import httpx
import pytest
from fastapi.testclient import TestClient

import config
import engine
import main
from comfy import ComfyClient
from history import History
from jobs import JobManager, friendly_execution_error

LEAKS = ["Traceback", "File \"", "C:\\", "E:\\", "site-packages", "node_errors", "ConnectError", "httpx", "127.0.0.1",
         "execution.py", "KSampler", "secret"]

CREATE = {"params": {"mode": "create", "variant": "standard", "prompt": "a red fox", "seed": 1, "seed_variance_seed": 2}}


def assert_clean(text: str) -> None:
    for bad in LEAKS:
        assert bad not in text, f"{bad!r} leaked: {text[:300]}"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "SETTINGS_FILE", tmp_path / "settings.json")
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(main, "DATA_DIR", tmp_path)
    monkeypatch.setattr(main, "THUMBS_DIR", tmp_path / "thumbs")

    async def no_catalog(request, need_loras=True):  # list checks are not what these tests are about
        return engine.Catalog()

    monkeypatch.setattr(main, "make_catalog", no_catalog)
    with TestClient(main.app, raise_server_exceptions=False) as c:
        use_backend(c, ComfyClient("http://127.0.0.1:1"))  # nothing listens there: a test can never reach a real backend
        code = c.app.state.auth.setup_code
        assert c.post("/api/auth/setup", json={"password": "correct horse battery", "code": code}).status_code == 200
        yield c


def use_backend(client, comfy: ComfyClient) -> None:
    """The routes use app.state.comfy, the job manager keeps its own reference: swap both."""
    client.app.state.comfy = comfy
    client.app.state.jobs.comfy = comfy


def stub_backend(client, handler) -> None:
    """Point the app at an in-memory backend (httpx MockTransport) answering `handler(request)`."""
    comfy = ComfyClient("http://backend.invalid")
    comfy._http = httpx.AsyncClient(base_url=comfy.base_url, transport=httpx.MockTransport(handler))
    use_backend(client, comfy)


# ------------------------------------------------------------------------- 1. backend offline

def test_offline_backend_gives_a_friendly_503(client):
    use_backend(client, ComfyClient("http://127.0.0.1:1"))  # nothing listens there
    r = client.post("/api/jobs", json=CREATE)
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "offline"
    assert "isn't reachable" in r.json()["error"]["message"]
    assert_clean(r.text)
    q = client.get("/api/queue")
    assert q.status_code == 503
    assert_clean(q.text)
    h = client.get("/api/health")  # the UI banner reads this; it must not be an error
    assert h.status_code == 200 and h.json()["comfy_online"] is False


# ------------------------------------------------------------------------- 2. missing model

def test_health_lists_missing_required_models(client):
    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.path == "/system_stats":
            return httpx.Response(200, json={"system": {"comfyui_version": "0.38.0"}})
        if req.url.path.startswith("/models/"):
            return httpx.Response(200, json=[])  # nothing installed
        if req.url.path == "/object_info":
            return httpx.Response(200, json={})
        return httpx.Response(404)

    stub_backend(client, handler)
    body = client.get("/api/health").json()
    assert body["comfy_online"] and "diffusion_models/krea2_turbo_int8_convrot.safetensors" in body["missing_models"]
    assert body["missing_nodes"]  # nothing registered either: reported, not raised
    assert_clean(json.dumps(body["missing_models"]))


def test_missing_model_rejected_by_backend_is_friendly(client):
    """What the real backend answers when a model file is absent (a 400 with a value-not-in-list node error)."""
    detail = {
        "error": {"type": "prompt_outputs_failed_validation", "message": "Prompt outputs failed validation"},
        "node_errors": {"815": {"errors": [{"type": "value_not_in_list", "message": "Value not in list: unet_name: "
                                            "'C:\\secret\\krea2.safetensors' not in []"}], "class_type": "UNETLoader"}},
    }
    stub_backend(client, lambda req: httpx.Response(400, json=detail) if req.url.path == "/prompt" else httpx.Response(404))
    r = client.post("/api/jobs", json=CREATE)
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation"
    assert "missing or invalid" in r.json()["error"]["message"]
    assert_clean(r.text)


# ------------------------------------------------------------------------- 3. validation error from /prompt

def test_validation_error_from_prompt_does_not_leak_the_backend_response(client):
    detail = {"error": {"message": "Prompt has no outputs secret"}, "node_errors": {"12": {"errors": ["secret"]}}}
    stub_backend(client, lambda req: httpx.Response(400, json=detail))
    r = client.post("/api/jobs", json=CREATE)
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation"
    assert_clean(r.text)
    assert client.get("/api/jobs").json()["jobs"] == []  # nothing was recorded for a rejected job


def test_bad_requests_name_the_field_only(client):
    r = client.post("/api/jobs", json={"params": {**CREATE["params"], "width": 100000}})
    assert r.status_code == 422
    assert_clean(r.text)
    r = client.post("/api/jobs", json={"params": {**CREATE["params"], "sneaky": "../../x"}})
    assert r.status_code == 422


def test_unhandled_exception_returns_no_internals(client, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("secret C:\\Users\\someone\\x.py line 3")

    monkeypatch.setattr(History, "list", boom)
    r = client.get("/api/jobs")
    assert r.status_code == 500 and r.json()["error"]["code"] == "internal"
    assert_clean(r.text)


# ------------------------------------------------------------------------- 4. node execution error

EXEC_ERROR = {
    "type": "execution_error",
    "data": {
        "prompt_id": "p1", "node_id": "273", "node_type": "KSampler", "exception_type": "RuntimeError",
        "exception_message": "secret failure at C:\\ComfyUI\\execution.py",
        "traceback": ["Traceback (most recent call last):", "  File \"C:\\ComfyUI\\execution.py\", line 1"],
    },
}


def manager(tmp_path, comfy=None):
    hist = History(tmp_path / "e.db")
    hist.create({"id": "j1", "created_at": 1.0, "mode": "create", "label": "x", "template": "krea_t2i__var1_tenh0_sharp1",
                 "status": "running", "params": {}, "seeds": {}, "prompt_id": "p1"})
    m = JobManager(comfy, hist)  # type: ignore[arg-type]
    m._built["j1"] = engine.Built({}, "t", {}, {}, None, "create")
    return m, hist


def test_execution_error_event_becomes_a_friendly_job_error(tmp_path):
    m, hist = manager(tmp_path)
    asyncio.run(m._on_event(EXEC_ERROR))
    job = hist.get("j1")
    assert job["status"] == "error"
    assert job["error"] == "The backend hit an error while running this job."
    assert_clean(json.dumps(job))


@pytest.mark.parametrize("exc,expected", [
    ({"exception_type": "torch.OutOfMemoryError", "exception_message": "CUDA out of memory. Tried to allocate 2 GiB"}, "ran out of GPU memory"),
    ({"exception_type": "FileNotFoundError", "exception_message": "No such file: C:\\x\\y.png"}, "model file"),
    ({"exception_type": "ValueError", "exception_message": "secret"}, "hit an error"),
])
def test_execution_error_messages(exc, expected):
    msg = friendly_execution_error(exc)
    assert expected in msg
    assert_clean(msg)


def test_failed_status_in_history_is_friendly(tmp_path):
    class Comfy:
        async def history(self, pid):
            return {pid: {"status": {"status_str": "error", "messages": [["execution_error", {"traceback": ["secret"]}]]}, "outputs": {}}}

    m, hist = manager(tmp_path, Comfy())
    asyncio.run(m._complete("j1"))
    job = hist.get("j1")
    assert job["status"] == "error"
    assert_clean(json.dumps(job))


def test_job_missing_after_a_restart_is_friendly(tmp_path):
    class Comfy:
        async def history(self, pid):
            return {}

        async def queue(self):
            return {"queue_running": [], "queue_pending": []}

    m, hist = manager(tmp_path, Comfy())

    async def no_broadcast(_):
        pass

    m._broadcast_job = no_broadcast  # type: ignore[method-assign]
    m._refresh_positions = lambda: asyncio.sleep(0)  # type: ignore[method-assign]
    asyncio.run(m._reconcile())
    assert "lost" in hist.get("j1")["error"]
    assert_clean(hist.get("j1")["error"])


# ------------------------------------------------------------------------- 5. cancel

class QueueComfy:
    def __init__(self, running: bool):
        self.running, self.interrupted, self.deleted = running, 0, []

    async def queue(self):
        e = [0, "p1"]
        return {"queue_running": [e] if self.running else [], "queue_pending": [] if self.running else [e]}

    async def interrupt(self):
        self.interrupted += 1

    async def delete_queued(self, ids):
        self.deleted += ids


def test_cancel_a_queued_job_deletes_only_our_prompt(tmp_path):
    comfy = QueueComfy(running=False)
    m, hist = manager(tmp_path, comfy)

    async def no_broadcast(_):
        pass

    m._broadcast_job = no_broadcast  # type: ignore[method-assign]
    asyncio.run(m.cancel("j1"))
    assert comfy.deleted == ["p1"] and comfy.interrupted == 0
    assert hist.get("j1")["status"] == "cancelled"


def test_cancel_a_running_job_interrupts_then_reports_cancelled(tmp_path):
    comfy = QueueComfy(running=True)
    m, hist = manager(tmp_path, comfy)

    async def no_broadcast(_):
        pass

    m._broadcast_job = no_broadcast  # type: ignore[method-assign]
    asyncio.run(m.cancel("j1"))
    assert comfy.interrupted == 1 and hist.get("j1")["status"] == "running"  # waits for the backend to stop
    asyncio.run(m._on_event({"type": "execution_interrupted", "data": {"prompt_id": "p1"}}))
    job = hist.get("j1")
    assert job["status"] == "cancelled" and not job["error"]


def test_cancel_unknown_job_is_404(client):
    r = client.post("/api/jobs/" + "0" * 32 + "/cancel")
    assert r.status_code == 404
    assert_clean(r.text)
