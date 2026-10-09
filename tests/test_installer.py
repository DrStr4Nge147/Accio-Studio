"""Installer pieces that can be tested without downloading anything big: safetensors verification,
resumable download (local range-capable server), manifest sanity, existing-models lookup, and a guard
against hard-coded user paths in shipped files."""
from __future__ import annotations

import json
import re
import shutil
import struct
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "installer"))
import core  # noqa: E402
import install  # noqa: E402


def make_safetensors(path: Path, payload: int = 64, extra: int = 0, trunc: int = 0) -> Path:
    header = json.dumps({"w": {"dtype": "F32", "shape": [payload // 4], "data_offsets": [0, payload]}}).encode()
    data = struct.pack("<Q", len(header)) + header + b"\0" * (payload + extra)
    path.write_bytes(data[: len(data) - trunc] if trunc else data)
    return path


def test_verify_safetensors_accepts_complete_file(tmp_path):
    f = make_safetensors(tmp_path / "ok.safetensors")
    assert core.verify_safetensors(f, f.stat().st_size) == (True, "ok")


@pytest.mark.parametrize("kw", [dict(trunc=1), dict(trunc=40), dict(extra=8)])
def test_verify_safetensors_rejects_truncated_or_padded(tmp_path, kw):
    ok, why = core.verify_safetensors(make_safetensors(tmp_path / "bad.safetensors", **kw))
    assert not ok and "size" in why


def test_verify_safetensors_rejects_garbage_and_wrong_manifest_size(tmp_path):
    g = tmp_path / "g.safetensors"
    g.write_bytes(b"not a safetensors file at all")
    assert core.verify_safetensors(g)[0] is False
    tiny = tmp_path / "t.safetensors"
    tiny.write_bytes(b"\x01")
    assert core.verify_safetensors(tiny)[0] is False
    f = make_safetensors(tmp_path / "ok.safetensors")
    assert core.verify_safetensors(f, f.stat().st_size + 1)[0] is False


class RangeHandler(BaseHTTPRequestHandler):
    body = bytes(range(256)) * 4000  # ~1 MB
    seen: list[str | None] = []

    def do_GET(self):
        rng = self.headers.get("Range")
        RangeHandler.seen.append(rng)
        start = int(re.match(r"bytes=(\d+)-", rng).group(1)) if rng else 0
        chunk = self.body[start:]
        self.send_response(206 if rng else 200)
        if rng:
            self.send_header("Content-Range", f"bytes {start}-{len(self.body) - 1}/{len(self.body)}")
        self.send_header("Content-Length", str(len(chunk)))
        self.end_headers()
        self.wfile.write(chunk)

    def log_message(self, *a):
        pass


@pytest.mark.skipif(shutil.which("curl.exe") is None, reason="curl.exe not available")
def test_curl_download_resumes_part_file(tmp_path):
    srv = HTTPServer(("127.0.0.1", 0), RangeHandler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        dest = tmp_path / "sub" / "file.bin"
        dest.parent.mkdir()
        (dest.parent / "file.bin.part").write_bytes(RangeHandler.body[:300_000])  # interrupted earlier
        RangeHandler.seen.clear()
        core.curl_download(f"http://127.0.0.1:{srv.server_port}/f", dest, expected_size=len(RangeHandler.body))
        assert dest.read_bytes() == RangeHandler.body
        assert not (dest.parent / "file.bin.part").exists()
        assert RangeHandler.seen == ["bytes=300000-"]
    finally:
        srv.shutdown()


@pytest.mark.skipif(shutil.which("curl.exe") is None, reason="curl.exe not available")
def test_curl_download_rejects_wrong_size(tmp_path):
    srv = HTTPServer(("127.0.0.1", 0), RangeHandler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        with pytest.raises(RuntimeError):
            core.curl_download(f"http://127.0.0.1:{srv.server_port}/f", tmp_path / "x.bin", expected_size=123)
        assert not (tmp_path / "x.bin").exists()
    finally:
        srv.shutdown()


def test_manifest_pins_and_models():
    m = core.load_manifest()
    assert m["comfyui"]["version"] == "0.38.0" and m["comfyui"]["tag"] == "v0.38.0"
    names = {n["name"] for n in m["nodes"]}
    assert len(names) == 9
    for n in m["nodes"]:
        assert re.fullmatch(r"[0-9a-f]{40}", n["commit"]), n["name"]
    assert {n["name"] for n in m["nodes"] if "registry_version" in n} == {"ComfyUI-Krea2T-Enhancer", "ComfyUI-RBG-SmartSeedVariance"}
    required = [x for x in m["models"] if x["required"]]
    assert len(required) == 8 and len(m["models"]) == 15
    assert 36e9 < sum(x["size"] for x in required) < 38e9  # "~37 GB required"
    assert all(x["url"].startswith("https://huggingface.co/") for x in m["models"])


def test_every_template_model_is_in_manifest():
    """Each model file a template loads (loaders + LoRA entries) must be downloadable by the installer."""
    files = {x["file"] for x in core.load_manifest()["models"]}
    from config import template_files

    for path in template_files():
        for node in json.loads(path.read_text("utf-8")).values():
            for k, v in node["inputs"].items():
                if k in ("unet_name", "clip_name", "vae_name") and isinstance(v, str):
                    assert v in files, f"{path.stem}: {v}"
                if isinstance(v, dict) and "lora" in v:
                    assert v["lora"] in files, f"{path.stem}: {v['lora']}"


def test_models_dir_of_accepts_comfy_folder_or_models_folder(tmp_path):
    models = tmp_path / "ComfyUI" / "models"
    (models / "loras").mkdir(parents=True)
    assert install.models_dir_of(str(models)) == models.resolve()
    assert install.models_dir_of(str(tmp_path / "ComfyUI")) == models.resolve()
    assert install.models_dir_of(str(tmp_path / "nowhere")) is None


def test_existing_models_must_verify_before_they_are_reused(tmp_path):
    (tmp_path / "loras").mkdir()
    good = make_safetensors(tmp_path / "loras" / "a.safetensors")
    m = {"folder": "loras", "file": "a.safetensors", "size": good.stat().st_size}
    assert install.locate_existing(tmp_path, m) == good
    make_safetensors(good, trunc=5)  # truncated copy is not reused
    assert install.locate_existing(tmp_path, m) is None


def test_no_hard_coded_user_paths_in_shipped_files():
    needles = ["E:" + "\\AI_Softwares", "E:" + "/AI_Softwares", "Nick" + "-PC"]
    skip_dirs = {"env", "bin", "comfyui", "data", "node_modules", "dist", ".git", "__pycache__", ".pytest_cache", "comfy-templates"}
    skip_files = {"APP_SPEC.md", "PROGRESS.md", "LOCAL_PATHS.md"}  # documentation of the reference environment
    exts = {".py", ".bat", ".json", ".ts", ".tsx", ".html", ".css", ".js", ".md", ".txt"}
    hits = []
    for p in ROOT.rglob("*"):
        if not p.is_file() or p.suffix not in exts or p.name in skip_files or set(p.relative_to(ROOT).parts) & skip_dirs:
            continue
        text = p.read_text("utf-8", errors="ignore")
        hits += [f"{p.relative_to(ROOT)}: {n}" for n in needles if n in text]
    assert not hits, hits


def test_verify_gguf_checks_magic_and_manifest_size(tmp_path):
    f = tmp_path / "m.gguf"
    f.write_bytes(b"GGUF" + b"\0" * 60)
    assert core.verify_safetensors(f, 64) == (True, "ok")
    assert core.verify_safetensors(f, 65)[0] is False
    f.write_bytes(b"NOPE" + b"\0" * 60)
    assert core.verify_safetensors(f, 64)[0] is False
