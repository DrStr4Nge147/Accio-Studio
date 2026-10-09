"""Install location checks, stall-proof downloads and the flat ComfyUI layout (comfyui\\ComfyUI + comfyui\\python_embeded).

No network and no 7-Zip: the download and the unpacking are replaced by fakes that produce a small portable package."""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "installer"))
import core  # noqa: E402
import install  # noqa: E402


def test_install_path_problem_limits(monkeypatch):
    monkeypatch.delenv("ACCIO_SKIP_PATH_CHECK", raising=False)
    assert core.install_path_problem(Path("C:/AccioStudio")) is None
    assert core.install_path_problem(Path("C:/" + "a" * (core.MAX_ROOT_PATH_LEN - 3))) is None  # exactly at the limit
    too_long = core.install_path_problem(Path("C:/" + "a" * core.MAX_ROOT_PATH_LEN))
    assert too_long and "too long" in too_long and "C:\\AccioStudio" in too_long
    assert "'!'" in core.install_path_problem(Path("C:/Accio!Studio"))
    monkeypatch.setenv("ACCIO_SKIP_PATH_CHECK", "1")
    assert core.install_path_problem(Path("C:/" + "a" * 300)) is None


def test_install_bat_uses_the_same_limit_and_checks_before_delayed_expansion():
    bat = (ROOT / "Install.bat").read_text(encoding="utf-8")
    assert f"-gt {core.MAX_ROOT_PATH_LEN})" in bat and f"more than {core.MAX_ROOT_PATH_LEN} characters" in bat
    assert bat.index("exit 12") < bat.index("setlocal enabledelayedexpansion")  # a "!" in the path must not reach delayed expansion


def test_curl_download_guards_against_stalled_connections(tmp_path, monkeypatch):
    calls = []

    def fake_run(cmd, **kw):
        calls.append(cmd)
        Path(cmd[cmd.index("-o") + 1]).write_bytes(b"x")
        return type("R", (), {"returncode": 0})()

    monkeypatch.setattr(core.subprocess, "run", fake_run)
    core.curl_download("http://example.invalid/f", tmp_path / "f.bin")
    for flag in ("--connect-timeout", "--speed-time", "--speed-limit"):
        assert flag in calls[0]
    assert (tmp_path / "f.bin").read_bytes() == b"x"


def make_package(parent: Path, *, amd_bat: str | None = None, version: str = "0.38.0") -> Path:
    """What the portable 7z unpacks to: a top folder with ComfyUI, python_embeded and launchers/updaters we do not want."""
    pkg = parent / "ComfyUI_windows_portable"
    (pkg / "ComfyUI" / "models").mkdir(parents=True)
    (pkg / "ComfyUI" / "comfyui_version.py").write_text(f'__version__ = "{version}"\n')
    (pkg / "python_embeded").mkdir()
    (pkg / "python_embeded" / "python.exe").write_bytes(b"MZ")
    (pkg / "update").mkdir()
    (pkg / "update" / "update_comfyui.bat").write_text("x")
    (pkg / "advanced").mkdir()
    (pkg / "run_nvidia_gpu.bat").write_text("x")
    (pkg / "README_VERY_IMPORTANT.txt").write_text("x")
    if amd_bat:
        (pkg / "run_amd_gpu.bat").write_text(amd_bat)
    return pkg


def test_flatten_portable_keeps_only_comfyui_and_python(tmp_path):
    home = tmp_path / "comfyui"
    home.mkdir()
    make_package(home / "_extract")
    assert install.flatten_portable(home / "_extract", home, "nvidia") == ""
    assert sorted(p.name for p in home.iterdir()) == ["ComfyUI", "python_embeded"]
    assert (home / "ComfyUI" / "comfyui_version.py").is_file() and (home / "python_embeded" / "python.exe").is_file()


def test_flatten_portable_reads_amd_flags_before_deleting_the_launcher(tmp_path):
    home = tmp_path / "comfyui"
    home.mkdir()
    bat = ".\\python_embeded\\python.exe -s ComfyUI\\main.py --windows-standalone-build --use-pytorch-cross-attention %*\npause\n"
    make_package(home / "_extract", amd_bat=bat)
    assert install.flatten_portable(home / "_extract", home, "amd") == "--use-pytorch-cross-attention"
    assert not (home / "run_amd_gpu.bat").exists()


def test_flatten_portable_rejects_unexpected_layouts(tmp_path):
    home = tmp_path / "comfyui"
    (home / "_extract" / "other").mkdir(parents=True)
    with pytest.raises(RuntimeError, match="layout"):
        install.flatten_portable(home / "_extract", home, "nvidia")
    shutil.rmtree(home)
    make_package(home / "_extract")
    (home / "ComfyUI").mkdir()
    with pytest.raises(RuntimeError, match="already exists"):
        install.flatten_portable(home / "_extract", home, "nvidia")


@pytest.fixture
def fake_comfy(tmp_path, monkeypatch):
    """install_comfyui with the download and the 7z call replaced by fakes that unpack a small package."""
    home = tmp_path / "comfyui"
    home.mkdir()
    monkeypatch.setattr(install, "COMFY_HOME", home)
    monkeypatch.setattr(install, "LEGACY_HOME", home / "ComfyUI_windows_portable")
    monkeypatch.setattr(install, "remote_size", lambda url: 5)
    monkeypatch.setattr(install, "free_space", lambda p: 10**12)
    seen = {"downloads": 0, "extracts": 0, "fail_extract": False}

    def fake_download(url, dest, expected_size=None):
        seen["downloads"] += 1
        dest.write_bytes(b"12345")

    def fake_run(cmd, **kw):
        seen["extracts"] += 1
        make_package(Path(next(a for a in cmd if str(a).startswith("-o"))[2:]))
        return type("R", (), {"returncode": 1 if seen["fail_extract"] else 0, "stdout": "", "stderr": "boom"})()

    monkeypatch.setattr(install, "curl_download", fake_download)
    monkeypatch.setattr(install.subprocess, "run", fake_run)
    manifest = {"comfyui": {"version": "0.38.0", "tag": "v0.38.0", "release_url": "http://x/{tag}/{build}.7z"}}
    return home, manifest, seen


def test_install_comfyui_produces_the_flat_layout_and_a_rerun_is_a_no_op(fake_comfy):
    home, manifest, seen = fake_comfy
    assert install.install_comfyui(manifest, "nvidia", Path("7zr.exe")) == ""
    assert sorted(p.name for p in home.iterdir()) == ["ComfyUI", "python_embeded"]  # archive, _extract and extras are gone
    assert install.comfy_dir() == home / "ComfyUI" and install.py() == home / "python_embeded" / "python.exe"
    (home / "_extract").mkdir()  # an earlier run that stopped right at the end
    assert install.install_comfyui(manifest, "nvidia", Path("7zr.exe")) == ""
    assert seen["downloads"] == 1 and seen["extracts"] == 1
    assert not (home / "_extract").exists()


def test_install_comfyui_recovers_from_an_interrupted_run(fake_comfy):
    home, manifest, seen = fake_comfy
    (home / "_extract").mkdir()
    (home / "python_embeded").mkdir()  # moved before the stop; ComfyUI was not
    install.install_comfyui(manifest, "nvidia", Path("7zr.exe"))
    assert (home / "ComfyUI" / "comfyui_version.py").is_file() and (home / "python_embeded" / "python.exe").is_file()
    assert not (home / "_extract").exists()


def test_install_comfyui_reuses_a_finished_download_after_a_failed_extraction(fake_comfy):
    home, manifest, seen = fake_comfy
    seen["fail_extract"] = True
    with pytest.raises(RuntimeError, match="extraction failed"):
        install.install_comfyui(manifest, "nvidia", Path("7zr.exe"))
    seen["fail_extract"] = False
    install.install_comfyui(manifest, "nvidia", Path("7zr.exe"))
    assert seen["downloads"] == 1  # the verified archive was kept


def test_install_comfyui_refuses_to_replace_another_version_that_may_hold_models(fake_comfy):
    home, manifest, seen = fake_comfy
    pkg = make_package(home / "_tmp", version="0.1.0")
    for name in ("ComfyUI", "python_embeded"):
        shutil.move(str(pkg / name), str(home / name))
    shutil.rmtree(home / "_tmp")
    (home / "ComfyUI" / "models" / "mine.safetensors").write_bytes(b"x")
    with pytest.raises(RuntimeError, match="Delete the 'comfyui' folder"):
        install.install_comfyui(manifest, "nvidia", Path("7zr.exe"))
    assert (home / "ComfyUI" / "models" / "mine.safetensors").is_file() and seen["downloads"] == 0


def test_an_existing_nested_install_keeps_working(fake_comfy):
    home, manifest, seen = fake_comfy
    legacy = home / "ComfyUI_windows_portable"
    pkg = make_package(home / "_tmp")
    shutil.move(str(pkg), str(legacy))
    shutil.rmtree(home / "_tmp")
    assert install.comfy_base() == legacy and install.installed_comfy_version() == "0.38.0"
    assert install.install_comfyui(manifest, "nvidia", Path("7zr.exe")) == ""
    assert seen["downloads"] == 0 and (legacy / "ComfyUI").is_dir()
