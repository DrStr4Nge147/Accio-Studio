"""The confirmation before the big model download."""
from __future__ import annotations

import json
import struct
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "installer"))
import install  # noqa: E402


def safetensors_bytes() -> bytes:
    header = json.dumps({"w": {"dtype": "F32", "shape": [4], "data_offsets": [0, 16]}}).encode()
    return struct.pack("<Q", len(header)) + header + b"\0" * 16


@pytest.fixture
def one_model(tmp_path, monkeypatch):
    data = safetensors_bytes()
    monkeypatch.setattr(install, "COMFY_HOME", tmp_path / "comfyui")
    monkeypatch.setattr(install, "LEGACY_HOME", tmp_path / "comfyui" / "legacy")
    monkeypatch.setattr(install, "free_space", lambda p: 10**12)
    calls = []

    def fake_download(url, dest, expected_size=None):
        calls.append(url)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)

    monkeypatch.setattr(install, "curl_download", fake_download)
    manifest = {"models": [{"file": "m.safetensors", "folder": "loras", "size": len(data), "required": True, "url": "http://x/m"}]}
    return manifest, calls


@pytest.mark.parametrize("answer, proceeds", [("", True), ("y", True), ("Y", True), ("anything", True), ("n", False), ("N", False), ("no", False)])
def test_confirm_download_only_no_declines(monkeypatch, answer, proceeds):
    monkeypatch.setattr(install, "ask", lambda prompt, default="", **kw: answer or default)
    assert install.confirm_download(37_000_000_000, 8, interactive=True) is proceeds


def test_confirm_download_never_asks_when_not_interactive(monkeypatch):
    def boom(*a, **k):
        raise AssertionError("must not prompt")

    monkeypatch.setattr(install, "ask", boom)
    assert install.confirm_download(1, 1, interactive=False) is True


def test_declining_the_confirmation_downloads_nothing_and_says_how_to_continue(one_model, monkeypatch):
    manifest, calls = one_model
    monkeypatch.setattr(install, "ask", lambda prompt, default="", **kw: "n")
    with pytest.raises(RuntimeError, match="Run Install.bat again"):
        install.install_models(manifest, None, False, interactive=True)
    assert calls == []


def test_accepting_the_confirmation_downloads_and_verifies(one_model, monkeypatch):
    manifest, calls = one_model
    monkeypatch.setattr(install, "ask", lambda prompt, default="", **kw: default)
    assert install.install_models(manifest, None, False, interactive=True) == []
    assert calls == ["http://x/m"]


def test_unattended_install_downloads_without_asking(one_model, monkeypatch):
    manifest, calls = one_model

    def boom(*a, **k):
        raise AssertionError("must not prompt")

    monkeypatch.setattr(install, "ask", boom)
    assert install.install_models(manifest, None, False, interactive=False) == []
    assert calls == ["http://x/m"]


# --------------------------------------------------------------------------- answers are remembered, so a re-run or an update does not ask again

Q = "Also install X? [y/N]: "


def asked(monkeypatch, answer: str):
    calls = []
    monkeypatch.setattr(install, "ask", lambda prompt, default="", **kw: calls.append(prompt) or (answer or default))
    return calls


@pytest.mark.parametrize("flag, expected", [("yes", True), ("no", False)])
def test_an_explicit_flag_wins_and_is_remembered(monkeypatch, flag, expected):
    calls = asked(monkeypatch, "y")
    assert install.decide(flag, saved=not expected, question=Q, interactive=True) == (expected, True)
    assert calls == []


def test_an_earlier_answer_is_used_without_asking(monkeypatch):
    calls = asked(monkeypatch, "n")
    assert install.decide("ask", saved=True, question=Q, interactive=True) == (True, False)
    assert install.decide("ask", saved=False, question=Q, interactive=True) == (False, False)
    assert calls == []


def test_the_first_time_the_user_is_asked_and_the_answer_is_worth_remembering(monkeypatch):
    calls = asked(monkeypatch, "y")
    assert install.decide("ask", saved=None, question=Q, interactive=True) == (True, True)
    assert calls == [Q]
    asked(monkeypatch, "")
    assert install.decide("ask", saved=None, question=Q, interactive=True) == (False, True)  # Enter = the default, no


def test_an_unattended_run_does_not_ask_and_does_not_overwrite_a_remembered_yes(monkeypatch):
    calls = asked(monkeypatch, "y")
    assert install.decide("ask", saved=None, question=Q, interactive=False) == (False, False)
    assert install.decide("ask", saved=True, question=Q, interactive=False) == (True, False)
    assert calls == []
