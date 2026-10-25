"""installer/modelfiles.py: which models are wanted, what is skipped, and the download-verify loop."""
from __future__ import annotations

import json
import struct
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "installer"))
import modelfiles  # noqa: E402


def safetensors_bytes() -> bytes:
    header = json.dumps({"w": {"dtype": "F32", "shape": [4], "data_offsets": [0, 16]}}).encode()
    return struct.pack("<Q", len(header)) + header + b"\0" * 16


@pytest.fixture
def downloads(tmp_path, monkeypatch):
    data = safetensors_bytes()
    monkeypatch.setattr(modelfiles.core, "ROOT", tmp_path)  # no settings.json: nothing is "found" elsewhere
    monkeypatch.setattr(modelfiles, "free_space", lambda p: 10**12)
    calls = []

    def fake_download(url, dest, expected_size=None, **kw):
        calls.append(url)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)

    monkeypatch.setattr(modelfiles, "curl_download", fake_download)
    return data, calls


def entry(name: str, size: int, **kw) -> dict:
    return {"file": name, "folder": "loras", "size": size, "required": True, "url": f"http://x/{name}", **kw}


def test_wanted_is_required_plus_asked_for_optionals():
    manifest = {"models": [
        entry("req", 1), entry("lora", 1, required=False), entry("k1", 1, required=False, group="klein"),
    ]}
    names = lambda **kw: [m["file"] for m in modelfiles.wanted(manifest, **kw)]  # noqa: E731
    assert names() == ["req"]
    assert names(optional=True) == ["req", "lora"]  # a grouped model never follows "optional"
    assert names(groups=frozenset({"klein"})) == ["req", "k1"]


def test_missing_models_are_downloaded_and_verified(tmp_path, downloads):
    data, calls = downloads
    manifest = {"models": [entry("m.safetensors", len(data))]}
    assert modelfiles.install_models(manifest, tmp_path / "models", say=lambda _: None) == []
    assert calls == ["http://x/m.safetensors"]
    assert (tmp_path / "models" / "loras" / "m.safetensors").read_bytes() == data


def test_installed_models_are_not_downloaded_again(tmp_path, downloads):
    data, calls = downloads
    (tmp_path / "models" / "loras" / "krea2").mkdir(parents=True)
    (tmp_path / "models" / "loras" / "krea2" / "m.safetensors").write_bytes(data)  # filed in a subfolder
    manifest = {"models": [entry("m.safetensors", len(data))]}
    assert modelfiles.install_models(manifest, tmp_path / "models", say=lambda _: None) == []
    assert calls == []


def test_a_damaged_download_is_retried_then_reported(tmp_path, downloads, monkeypatch):
    data, calls = downloads
    monkeypatch.setattr(modelfiles, "curl_download", lambda url, dest, expected_size=None, **kw: (calls.append(url), dest.parent.mkdir(parents=True, exist_ok=True), dest.write_bytes(b"junk")))
    manifest = {"models": [entry("m.safetensors", len(data))]}
    assert modelfiles.install_models(manifest, tmp_path / "models", say=lambda _: None) == ["m.safetensors"]
    assert len(calls) == 2
    assert not (tmp_path / "models" / "loras" / "m.safetensors").exists()


def test_not_enough_disk_space_stops_before_downloading(tmp_path, downloads, monkeypatch):
    data, calls = downloads
    monkeypatch.setattr(modelfiles, "free_space", lambda p: 1)
    with pytest.raises(RuntimeError, match="free disk space"):
        modelfiles.install_models({"models": [entry("m.safetensors", len(data))]}, tmp_path / "models", say=lambda _: None)
    assert calls == []
