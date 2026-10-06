"""Settings loader. Values come from ROOT/settings.json (git-ignored) over built-in defaults.

The ComfyUI backend is the bundled portable install (comfyui/ComfyUI_windows_portable) on 127.0.0.1:8189.
`external_comfy_url` (advanced) points Accio at some other ComfyUI instead; then the bundled one is not started.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
SETTINGS_FILE = ROOT / "settings.json"
TEMPLATES_DIR = Path(__file__).resolve().parent / "templates"
MANIFEST_FILE = TEMPLATES_DIR / "manifest.json"
DATA_DIR = ROOT / "data"
INSTALL_STATE_FILE = DATA_DIR / "install.json"
FRONTEND_DIST = ROOT / "frontend" / "dist"
BUNDLED_COMFY_DIR = ROOT / "comfyui" / "ComfyUI_windows_portable"

DEFAULTS: dict[str, Any] = {
    "comfy_port": 8189,
    "external_comfy_url": "",  # advanced: use this ComfyUI instead of the bundled one
    "comfy_dir": "",  # advanced: override the bundled ComfyUI folder ("" = comfyui\ComfyUI_windows_portable)
    "port": 7862,
    # Loopback until login exists (phase 7). Set true to listen on the LAN.
    "lan_access": False,
    "output_prefix": "AccioStudio",
    "max_upload_mb": 40,
}


def load_settings() -> dict[str, Any]:
    settings = dict(DEFAULTS)
    if SETTINGS_FILE.is_file():
        try:
            data = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                settings.update({k: v for k, v in data.items() if k in DEFAULTS or k.startswith("_")})
        except (OSError, ValueError):
            pass  # fall back to defaults; a broken file must not stop startup
    return settings


def comfy_url(settings: dict[str, Any]) -> str:
    ext = str(settings["external_comfy_url"]).strip().rstrip("/")
    return ext or f"http://127.0.0.1:{int(settings['comfy_port'])}"


def comfy_dir(settings: dict[str, Any]) -> Path:
    return Path(settings["comfy_dir"]) if settings["comfy_dir"] else BUNDLED_COMFY_DIR


def install_state() -> dict[str, Any]:
    """What Install.bat recorded (GPU, launch flags, pins). Empty if it has not run."""
    try:
        return json.loads(INSTALL_STATE_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def load_manifest() -> dict[str, Any]:
    return json.loads(MANIFEST_FILE.read_text(encoding="utf-8"))


def template_files() -> list[Path]:
    """The 20 API templates (manifest.json lives in the same folder)."""
    return sorted(p for p in TEMPLATES_DIR.glob("*.json") if p.name != "manifest.json")
