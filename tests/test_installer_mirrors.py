"""Mirror-first downloads for the custom-node packs, and the pinned uv. No network: downloads are faked."""
from __future__ import annotations

import hashlib
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "installer"))
import core  # noqa: E402
import install  # noqa: E402

UNLICENSED = {"ComfyUI-PixelDriftFix"}  # declares no license, so it is not mirrored


def test_every_licensed_node_has_a_mirror_checksum_and_the_unlicensed_one_does_not():
    m = core.load_manifest()
    assert "{name}" in m["nodes_mirror_url"] and "{commit}" in m["nodes_mirror_url"]
    assert m["nodes_mirror_url"].startswith("https://huggingface.co/NicRaf/AccioStudio/")
    for n in m["nodes"]:
        if n["name"] in UNLICENSED:
            assert "sha256" not in n and "size" not in n, n["name"]
        else:
            assert re.fullmatch(r"[0-9a-f]{64}", n["sha256"]) and n["size"] > 1000, n["name"]


def test_uv_is_pinned_with_a_checksum_not_latest():
    bat = (ROOT / "Install.bat").read_text(encoding="utf-8")
    assert "releases/latest" not in bat
    assert re.search(r'set "UV_VERSION=\d+\.\d+\.\d+"', bat)
    assert re.search(r'set "UV_SHA256=[0-9a-f]{64}"', bat)
    assert "%UV_VERSION%" in bat and "UV_SHA256" in bat.split("Get-FileHash")[1]


PAYLOAD = b"node-archive"
NODE = {"name": "Pack", "repo": "owner/Pack", "commit": "a" * 40, "size": len(PAYLOAD), "sha256": hashlib.sha256(PAYLOAD).hexdigest()}
MANIFEST = {"nodes_mirror_url": "http://mirror/{name}-{commit}.zip"}


@pytest.fixture
def fake_net(monkeypatch):
    seen = {"urls": [], "mirror_has_it": True, "mirror_payload": PAYLOAD, "github_payload": PAYLOAD}
    monkeypatch.setattr(install, "remote_size", lambda url: len(seen["mirror_payload"]) if seen["mirror_has_it"] else None)

    def fake_download(url, dest, expected_size=None):
        seen["urls"].append(url)
        data = seen["mirror_payload"] if "mirror" in url else seen["github_payload"]
        if expected_size is not None and len(data) != expected_size:
            raise RuntimeError("size mismatch")
        dest.write_bytes(data)

    monkeypatch.setattr(install, "curl_download", fake_download)
    return seen


def test_node_comes_from_the_mirror_first(tmp_path, fake_net):
    install.fetch_node(MANIFEST, NODE, tmp_path / "p.zip")
    assert fake_net["urls"] == [f"http://mirror/Pack-{'a' * 40}.zip"]


def test_node_falls_back_to_github_when_the_mirror_lacks_it(tmp_path, fake_net):
    fake_net["mirror_has_it"] = False
    install.fetch_node(MANIFEST, NODE, tmp_path / "p.zip")
    assert fake_net["urls"] == [f"https://github.com/owner/Pack/archive/{'a' * 40}.zip"]


def test_a_mirror_file_with_the_wrong_checksum_is_discarded_and_github_is_used(tmp_path, fake_net):
    fake_net["mirror_payload"] = b"node-archivX"  # same size, other bytes
    install.fetch_node(MANIFEST, NODE, tmp_path / "p.zip")
    assert len(fake_net["urls"]) == 2 and fake_net["urls"][1].startswith("https://github.com/")
    assert (tmp_path / "p.zip").read_bytes() == PAYLOAD


def test_an_unmirrored_node_goes_straight_to_github(tmp_path, fake_net):
    plain = {k: v for k, v in NODE.items() if k not in ("size", "sha256")}
    install.fetch_node(MANIFEST, plain, tmp_path / "p.zip")
    assert fake_net["urls"] == [f"https://github.com/owner/Pack/archive/{'a' * 40}.zip"]


def test_every_source_failing_is_a_clear_error(tmp_path, monkeypatch):
    monkeypatch.setattr(install, "remote_size", lambda url: None)

    def fail(url, dest, expected_size=None):
        raise RuntimeError("download failed")

    monkeypatch.setattr(install, "curl_download", fail)
    with pytest.raises(RuntimeError, match="any source"):
        install.fetch_node(MANIFEST, NODE, tmp_path / "p.zip")
