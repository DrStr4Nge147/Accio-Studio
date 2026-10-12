import sysinfo


def test_torch_cuda_from_version():
    assert sysinfo.torch_cuda("2.9.0+cu130") == "13.0"
    assert sysinfo.torch_cuda("2.6.0+cu126") == "12.6"
    assert sysinfo.torch_cuda("2.6.0+cpu") is None
    assert sysinfo.torch_cuda(None) is None


def test_hardware_shape():
    sysinfo.hardware.cache_clear()
    hw = sysinfo.hardware()
    assert set(hw) == {"gpus", "driver_cuda", "ram_mb"}
    assert hw["ram_mb"] is None or hw["ram_mb"] > 0


# --------------------------------------------------------------------------- /api/system

import pytest
from fastapi.testclient import TestClient

import config
import main
from comfy import ComfyError

client = TestClient(main.app, raise_server_exceptions=False)
HW = {"gpus": [{"name": "Test GPU", "vram_mb": 8192, "driver": "1.0"}], "driver_cuda": "13.0", "ram_mb": 16384}


class FakeComfy:
    def __init__(self, stats=None):
        self.stats = stats

    async def system_stats(self):
        if self.stats is None:
            raise ComfyError("offline")
        return self.stats


@pytest.fixture
def authed(session_token, monkeypatch):
    client.cookies.set("accio_session", session_token)
    monkeypatch.setattr(main.app.state, "settings", config.load_settings(), raising=False)
    monkeypatch.setattr(sysinfo, "hardware", lambda: HW)
    yield
    client.cookies.clear()


def test_system_reports_engine_cuda(authed, monkeypatch):
    monkeypatch.setattr(main.app.state, "comfy", FakeComfy({"system": {"pytorch_version": "2.9.0+cu130"}}), raising=False)
    body = client.get("/api/system").json()
    assert body["gpus"] == HW["gpus"] and body["driver_cuda"] == "13.0" and body["ram_mb"] == 16384
    assert body["engine_cuda"] == "13.0" and body["pytorch"] == "2.9.0+cu130"


def test_system_survives_an_offline_backend(authed, monkeypatch):
    monkeypatch.setattr(main.app.state, "comfy", FakeComfy(None), raising=False)
    body = client.get("/api/system").json()
    assert body["engine_cuda"] is None and body["gpus"] == HW["gpus"]


def test_system_needs_login(session_token):
    client.cookies.clear()
    assert client.get("/api/system").status_code in (401, 403)
