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


# --------------------------------------------------------------------------- temperatures

def test_pick_cpu_temp_prefers_package_sensor():
    assert sysinfo.pick_cpu_temp("Core #1|60\nCPU Package|72.4\nCore #2|65") == 72
    assert sysinfo.pick_cpu_temp("Core (Tctl/Tdie)|55\nCore #1|70") == 55


def test_pick_cpu_temp_falls_back_to_hottest_and_drops_junk():
    assert sysinfo.pick_cpu_temp("Core #1|60\nCore #2|66.6") == 67
    assert sysinfo.pick_cpu_temp("ACPI|-273.15\nbad|x") is None
    assert sysinfo.pick_cpu_temp("") is None


def test_temps_endpoint(authed, monkeypatch):
    monkeypatch.setattr(sysinfo, "temperatures", lambda: {"gpus": [70], "cpu": None})
    assert client.get("/api/system/temps").json() == {"gpus": [70], "cpu": None}


# --------------------------------------------------------------------------- live load

def test_parse_gpu_live():
    cards = sysinfo.parse_gpu_live("65, 40, 5120, 8192" + chr(10) + "70, [N/A], 100, 24576" + chr(10) + "broken line")
    assert cards == [
        {"temp": 65, "util": 40, "vram_used_mb": 5120, "vram_total_mb": 8192},
        {"temp": 70, "util": None, "vram_used_mb": 100, "vram_total_mb": 24576},
    ]
    assert sysinfo.parse_gpu_live("") == []


def test_cpu_busy_percent():
    # idle 25 of 100 total (kernel includes idle) -> 75 % busy
    assert sysinfo.cpu_busy_percent((0, 0, 0), (25, 60, 40)) == 75
    assert sysinfo.cpu_busy_percent((10, 20, 30), (10, 20, 30)) is None
    assert sysinfo.cpu_busy_percent((0, 0, 0), (200, 100, 0)) == 0


def test_live_shape_on_this_pc():
    live = sysinfo.live()
    assert set(live) == {"gpus", "cpu", "ram"}
    assert set(live["cpu"]) == {"percent"}
    assert live["cpu"]["percent"] is None or 0 <= live["cpu"]["percent"] <= 100
    assert live["ram"] is None or (0 <= live["ram"]["percent"] <= 100 and live["ram"]["used_mb"] <= live["ram"]["total_mb"])


def test_live_endpoint(authed, monkeypatch):
    payload = {"gpus": [{"temp": 60, "util": 10, "vram_used_mb": 1, "vram_total_mb": 2}], "cpu": {"percent": 5}, "ram": None}
    monkeypatch.setattr(sysinfo, "live", lambda: payload)
    assert client.get("/api/system/live").json() == payload
