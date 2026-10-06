"""Bundled-ComfyUI settings: default port 8189, external override, derived values used by Run_Accio.bat."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import config

ROOT = Path(__file__).resolve().parent.parent


def test_defaults_point_at_bundled_comfyui(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "SETTINGS_FILE", tmp_path / "none.json")
    s = config.load_settings()
    assert config.comfy_url(s) == "http://127.0.0.1:8189"
    assert config.comfy_dir(s) == ROOT / "comfyui" / "ComfyUI_windows_portable"
    assert "comfy_url" not in s  # old phase-2 key is gone


def test_external_comfy_url_and_port_override(monkeypatch, tmp_path):
    f = tmp_path / "settings.json"
    f.write_text(json.dumps({"external_comfy_url": "http://127.0.0.1:8188/", "comfy_port": 9000, "bogus": 1}))
    monkeypatch.setattr(config, "SETTINGS_FILE", f)
    s = config.load_settings()
    assert config.comfy_url(s) == "http://127.0.0.1:8188"
    assert "bogus" not in s
    f.write_text(json.dumps({"comfy_port": 9000}))
    assert config.comfy_url(config.load_settings()) == "http://127.0.0.1:9000"


def test_broken_settings_file_falls_back_to_defaults(monkeypatch, tmp_path):
    f = tmp_path / "settings.json"
    f.write_text("{not json")
    monkeypatch.setattr(config, "SETTINGS_FILE", f)
    assert config.comfy_url(config.load_settings()) == "http://127.0.0.1:8189"


def test_settings_cli_keys():
    def run(key):
        return subprocess.run([sys.executable, str(ROOT / "server" / "settings_cli.py"), key], capture_output=True, text=True, cwd=ROOT / "server").stdout.strip()

    assert run("comfy_port") == "8189"
    assert run("comfy_url").startswith("http://127.0.0.1:")
    assert run("external") in ("0", "1")
    assert run("comfy_dir").endswith("ComfyUI_windows_portable")


def test_manifest_comfy_version_matches_template_exports():
    assert config.load_manifest()["comfyui"]["version"] == "0.38.0"
