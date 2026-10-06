"""Live check (skipped when ComfyUI is offline): every node class used by the templates exists, and every
plain input name is a real input of that class. This catches template drift after a ComfyUI/custom-node update.
Dotted inputs (dynamic combos like 'method.strength', 'images.image_1') and rgthree's Power Lora Loader
(free-form kwargs) are skipped because object_info doesn't list them statically."""
from __future__ import annotations

import json
import os
import urllib.request

import pytest

from config import comfy_url, load_settings, template_files
from engine import strip_output_only

URL = os.environ.get("COMFY_URL") or comfy_url(load_settings())  # bundled ComfyUI (8189) unless overridden
# Free-form / dynamic inputs: object_info cannot list them.
FREE_FORM = {"Power Lora Loader (rgthree)", "Any Switch (rgthree)"}
# Button-style frontend widgets that graphToPrompt serialises but ComfyUI ignores.
UI_ONLY = {("RBG_Smart_Seed_Variance", "presets_buttons"), ("MiniMaxH3MediaLoader", "*")}


def _object_info():
    try:
        with urllib.request.urlopen(f"{URL}/object_info", timeout=5) as r:
            return json.load(r)
    except OSError:
        return None


INFO = _object_info()
pytestmark = pytest.mark.skipif(INFO is None, reason="ComfyUI offline")


@pytest.mark.parametrize("path", template_files(), ids=lambda p: p.stem)
def test_template_matches_installed_nodes(path):
    prompt = strip_output_only(json.loads(path.read_text("utf-8")))  # what the app actually sends
    problems = []
    for nid, node in prompt.items():
        cls = node["class_type"]
        if cls not in INFO:
            problems.append(f"{nid}: unknown class {cls}")
            continue
        if cls in FREE_FORM:
            continue
        spec = INFO[cls]["input"]
        known = {k for sec in spec.values() for k in sec}
        if cls == "MiniMaxH3MediaLoader":
            known |= {"media_state"}
        for key in node["inputs"]:
            if (cls, key) in UI_ONLY or (cls, "*") in UI_ONLY:
                continue
            if "." not in key and key not in known:
                problems.append(f"{nid} ({cls}): unknown input '{key}'")
    assert not problems, "\n".join(problems)
