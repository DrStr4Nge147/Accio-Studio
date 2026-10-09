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
    assert config.comfy_dir(s) in (ROOT / "comfyui", ROOT / "comfyui" / "ComfyUI_windows_portable")
    assert "comfy_url" not in s  # old phase-2 key is gone


def test_bundled_comfy_dir_is_flat_but_an_old_nested_install_still_works(monkeypatch, tmp_path):
    home = tmp_path / "comfyui"
    monkeypatch.setattr(config, "BUNDLED_COMFY_DIR", home)
    monkeypatch.setattr(config, "LEGACY_COMFY_DIR", home / "ComfyUI_windows_portable")
    assert config.bundled_comfy_dir() == home  # nothing installed yet
    (home / "ComfyUI_windows_portable" / "python_embeded").mkdir(parents=True)
    (home / "ComfyUI_windows_portable" / "python_embeded" / "python.exe").write_bytes(b"MZ")
    assert config.bundled_comfy_dir() == home / "ComfyUI_windows_portable"  # only the old layout exists
    (home / "python_embeded").mkdir()
    (home / "python_embeded" / "python.exe").write_bytes(b"MZ")
    assert config.bundled_comfy_dir() == home  # the flat layout wins
    s = dict(config.DEFAULTS, comfy_dir=str(tmp_path / "other"))
    assert config.comfy_dir(s) == tmp_path / "other"  # an explicit setting always wins


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
    assert Path(run("comfy_dir")) in (ROOT / "comfyui", ROOT / "comfyui" / "ComfyUI_windows_portable")


def test_manifest_comfy_version_matches_template_exports():
    assert config.load_manifest()["comfyui"]["version"] == "0.38.0"
