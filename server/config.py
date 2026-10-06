"""Settings loader. Values come from ROOT/settings.json (git-ignored) over built-in defaults."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
SETTINGS_FILE = ROOT / "settings.json"
TEMPLATES_DIR = Path(__file__).resolve().parent / "templates"
DATA_DIR = ROOT / "data"
FRONTEND_DIST = ROOT / "frontend" / "dist"

DEFAULTS: dict[str, Any] = {
    "comfy_url": "http://127.0.0.1:8188",
    "comfy_dir": r"E:\AI_Softwares\ImageGenerator\Merged\ComfyUI_windows_portable",
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
    settings["comfy_url"] = str(settings["comfy_url"]).rstrip("/")
    return settings
