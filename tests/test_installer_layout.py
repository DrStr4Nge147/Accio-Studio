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
    seen = {"downloads": 0, "extracts": 0, "fail_extract": False, "mirror_has_it": True, "payload": b"12345", "urls": [], "pkg_version": "0.38.0"}
    monkeypatch.setattr(install, "remote_size", lambda url: 5 if ("mirror" not in url or seen["mirror_has_it"]) else None)
    monkeypatch.setattr(install, "free_space", lambda p: 10**12)

    def fake_download(url, dest, expected_size=None):
        seen["downloads"] += 1
        seen["urls"].append(url)
        dest.write_bytes(seen["payload"])

    def fake_run(cmd, **kw):
        seen["extracts"] += 1
        make_package(Path(next(a for a in cmd if str(a).startswith("-o"))[2:]), version=seen["pkg_version"])
        return type("R", (), {"returncode": 1 if seen["fail_extract"] else 0, "stdout": "", "stderr": "boom"})()

    monkeypatch.setattr(install, "curl_download", fake_download)
    monkeypatch.setattr(install.subprocess, "run", fake_run)
    sha = "5994471abb01112afcc18159f6cc74b4f511b99806da59b3caf5a9c173cacfc5"  # sha256 of b"12345"
    manifest = {"comfyui": {
        "version": "0.38.0", "tag": "v0.38.0",
        "mirror_url": "http://mirror/{tag}/{build}.7z", "release_url": "http://github/{tag}/{build}.7z",
        "archives": {"nvidia": {"size": 5, "sha256": sha}},
    }}
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


def put_install(base: Path, version: str) -> None:
    """An installed ComfyUI (ComfyUI + python_embeded) of `version` inside `base`, with the folders a user fills."""
    pkg = make_package(base / "_tmp", version=version)
    for name in ("ComfyUI", "python_embeded"):
        shutil.move(str(pkg / name), str(base / name))
    shutil.rmtree(base / "_tmp")
    (base / "python_embeded" / "old_python.txt").write_text("old")
    comfy = base / "ComfyUI"
    for rel, data in (
        ("models/diffusion_models/mine.safetensors", "m"), ("models/loras/krea2/x.safetensors", "l"), ("input/a.png", "i"),
        ("output/AccioStudio/o.png", "o"), ("user/default/comfy.settings.json", "{}"), ("extra_model_paths.yaml", "y: 1"),
        ("custom_nodes/PackA/f.py", "a"), ("custom_nodes/PackA/.accio_pin", "abc"), ("custom_nodes/PackA/.accio_reqs_ok", "ok"),
        ("custom_nodes/UserPack/g.py", "u"),
    ):
        (comfy / rel).parent.mkdir(parents=True, exist_ok=True)
        (comfy / rel).write_text(data)


def want_new(manifest: dict, seen: dict) -> None:
    manifest["comfyui"].update(version="0.42.1", tag="v0.42.1")
    seen["pkg_version"] = "0.42.1"


def assert_user_files_kept(comfy: Path) -> None:
    for rel, data in (
        ("models/diffusion_models/mine.safetensors", "m"), ("models/loras/krea2/x.safetensors", "l"), ("input/a.png", "i"),
        ("output/AccioStudio/o.png", "o"), ("user/default/comfy.settings.json", "{}"), ("extra_model_paths.yaml", "y: 1"),
        ("custom_nodes/PackA/f.py", "a"), ("custom_nodes/PackA/.accio_pin", "abc"), ("custom_nodes/UserPack/g.py", "u"),
    ):
        assert (comfy / rel).read_text() == data, rel
    assert not (comfy / "custom_nodes" / "PackA" / ".accio_reqs_ok").exists()  # pip runs again in the new Python


def test_upgrade_keeps_the_users_folders_and_replaces_the_rest(fake_comfy):
    home, manifest, seen = fake_comfy
    put_install(home, "0.38.0")
    want_new(manifest, seen)
    assert install.install_comfyui(manifest, "nvidia", Path("7zr.exe")) == ""
    assert install.installed_comfy_version() == "0.42.1" and seen["downloads"] == 1
    assert sorted(p.name for p in home.iterdir()) == ["ComfyUI", "python_embeded"]  # _old, _extract and the archive are gone
    assert not (home / "python_embeded" / "old_python.txt").exists()  # the old Python is replaced, not reused
    assert_user_files_kept(home / "ComfyUI")
    assert install.install_comfyui(manifest, "nvidia", Path("7zr.exe")) == "" and seen["downloads"] == 1  # a rerun does nothing


def test_upgrade_from_the_nested_layout_ends_in_the_flat_one(fake_comfy):
    home, manifest, seen = fake_comfy
    legacy = home / "ComfyUI_windows_portable"
    legacy.mkdir()
    put_install(legacy, "0.38.0")
    (legacy / "run_nvidia_gpu.bat").write_text("x")
    want_new(manifest, seen)
    install.install_comfyui(manifest, "nvidia", Path("7zr.exe"))
    assert sorted(p.name for p in home.iterdir()) == ["ComfyUI", "python_embeded"] and install.comfy_base() == home
    assert_user_files_kept(home / "ComfyUI")


def test_upgrading_a_nested_install_leaves_unrelated_folders_beside_it_alone(fake_comfy):
    home, manifest, seen = fake_comfy
    legacy = home / "ComfyUI_windows_portable"
    legacy.mkdir()
    put_install(legacy, "0.38.0")
    (home / "ComfyUI" / "models").mkdir(parents=True)  # a folder that is not the install, sitting where the new one goes
    (home / "ComfyUI" / "models" / "theirs.safetensors").write_text("t")
    want_new(manifest, seen)
    install.install_comfyui(manifest, "nvidia", Path("7zr.exe"))
    assert_user_files_kept(home / "ComfyUI")  # the nested install's files, not the stray folder's, were carried over
    assert (home / "ComfyUI_unused_before_upgrade" / "models" / "theirs.safetensors").read_text() == "t"
    assert not (home / "ComfyUI_windows_portable").exists() and not (home / "_old").exists()


def test_a_failed_extraction_leaves_the_old_install_untouched(fake_comfy):
    home, manifest, seen = fake_comfy
    put_install(home, "0.38.0")
    want_new(manifest, seen)
    seen["fail_extract"] = True
    with pytest.raises(RuntimeError, match="extraction failed"):
        install.install_comfyui(manifest, "nvidia", Path("7zr.exe"))
    assert install.installed_comfy_version() == "0.38.0" and not (home / "_old").exists()
    assert (home / "ComfyUI" / "models" / "diffusion_models" / "mine.safetensors").is_file()
    seen["fail_extract"] = False
    install.install_comfyui(manifest, "nvidia", Path("7zr.exe"))  # the kept download is reused
    assert seen["downloads"] == 1 and install.installed_comfy_version() == "0.42.1"
    assert_user_files_kept(home / "ComfyUI")


def test_an_upgrade_stopped_after_parking_the_old_install_resumes_without_losing_files(fake_comfy):
    home, manifest, seen = fake_comfy
    put_install(home, "0.38.0")
    want_new(manifest, seen)
    (home / "_old").mkdir()
    for name in ("ComfyUI", "python_embeded"):
        shutil.move(str(home / name), str(home / "_old" / name))
    (home / "python_embeded").mkdir()  # half of the new install was already in place
    install.install_comfyui(manifest, "nvidia", Path("7zr.exe"))
    assert install.installed_comfy_version() == "0.42.1" and not (home / "_old").exists()
    assert_user_files_kept(home / "ComfyUI")


def test_an_upgrade_stopped_before_the_files_were_carried_over_resumes(fake_comfy):
    home, manifest, seen = fake_comfy
    put_install(home, "0.38.0")
    want_new(manifest, seen)
    (home / "_old").mkdir()
    for name in ("ComfyUI", "python_embeded"):
        shutil.move(str(home / name), str(home / "_old" / name))
    pkg = make_package(home / "_tmp", version="0.42.1")  # the new install is complete, the carry-over has not happened
    for name in ("python_embeded", "ComfyUI"):
        shutil.move(str(pkg / name), str(home / name))
    shutil.rmtree(home / "_tmp")
    install.install_comfyui(manifest, "nvidia", Path("7zr.exe"))
    assert seen["downloads"] == 0 and not (home / "_old").exists()
    assert_user_files_kept(home / "ComfyUI")


def test_a_newer_installed_comfyui_is_never_replaced(fake_comfy):
    home, manifest, seen = fake_comfy
    put_install(home, "0.50.0")
    want_new(manifest, seen)
    with pytest.raises(RuntimeError, match="newer"):
        install.install_comfyui(manifest, "nvidia", Path("7zr.exe"))
    assert seen["downloads"] == 0 and (home / "ComfyUI" / "models" / "diffusion_models" / "mine.safetensors").is_file()


def test_an_existing_nested_install_keeps_working(fake_comfy):
    home, manifest, seen = fake_comfy
    legacy = home / "ComfyUI_windows_portable"
    pkg = make_package(home / "_tmp")
    shutil.move(str(pkg), str(legacy))
    shutil.rmtree(home / "_tmp")
    assert install.comfy_base() == legacy and install.installed_comfy_version() == "0.38.0"
    assert install.install_comfyui(manifest, "nvidia", Path("7zr.exe")) == ""
    assert seen["downloads"] == 0 and (legacy / "ComfyUI").is_dir()


def test_comfyui_comes_from_our_mirror_first(fake_comfy):
    home, manifest, seen = fake_comfy
    install.install_comfyui(manifest, "nvidia", Path("7zr.exe"))
    assert seen["urls"] == ["http://mirror/v0.38.0/nvidia.7z"]


def test_comfyui_falls_back_to_the_upstream_release_when_the_mirror_lacks_it(fake_comfy):
    home, manifest, seen = fake_comfy
    seen["mirror_has_it"] = False
    install.install_comfyui(manifest, "nvidia", Path("7zr.exe"))
    assert seen["urls"] == ["http://github/v0.38.0/nvidia.7z"]
    assert (home / "ComfyUI").is_dir()


def test_a_download_with_the_wrong_checksum_is_never_unpacked(fake_comfy):
    home, manifest, seen = fake_comfy
    seen["payload"] = b"12346"  # same size, different content
    with pytest.raises(RuntimeError, match="any source"):
        install.install_comfyui(manifest, "nvidia", Path("7zr.exe"))
    assert seen["urls"] == ["http://mirror/v0.38.0/nvidia.7z", "http://github/v0.38.0/nvidia.7z"]  # both sources were tried
    assert seen["extracts"] == 0 and not (home / "ComfyUI").exists()
    assert not (home / "ComfyUI_windows_portable_nvidia.7z").exists()


def test_a_build_without_a_listed_package_is_a_clear_error(fake_comfy):
    home, manifest, seen = fake_comfy
    with pytest.raises(RuntimeError, match="no ComfyUI package"):
        install.install_comfyui(manifest, "amd", Path("7zr.exe"))


def test_manifest_lists_every_build_the_installer_can_choose():
    archives = core.load_manifest()["comfyui"]["archives"]
    assert set(archives) == {"nvidia", "nvidia_cu126", "amd", "intel"}
    for spec in archives.values():
        assert spec["size"] > 1e9 and len(spec["sha256"]) == 64
    c = core.load_manifest()["comfyui"]
    assert c["mirror_url"].startswith("https://huggingface.co/NicRaf/AccioStudio/") and "{tag}" in c["mirror_url"] and "{build}" in c["mirror_url"]


# --------------------------------------------------------------------------- Nvidia driver vs engine build


def nv(compute: str, driver: str) -> dict:
    return {"vendor": "nvidia", "name": "GPU", "compute": compute, "vram_mb": 12000, "driver": driver}


def test_a_recent_driver_keeps_the_default_build():
    assert install.build_for_driver("nvidia", nv("8.6", "581.15")) == "nvidia"
    assert install.build_for_driver("nvidia", nv("12.0", "580.0")) == "nvidia"
    assert install.build_for_driver("nvidia_cu126", nv("6.1", "525.60")) == "nvidia_cu126"


def test_an_older_driver_gets_the_cuda_126_build(capsys):
    assert install.build_for_driver("nvidia", nv("8.6", "551.23")) == "nvidia_cu126"  # an RTX 3060 on a 2024 driver
    assert "CUDA 12.6" in capsys.readouterr().out


def test_a_driver_too_old_for_any_build_is_a_clear_error():
    with pytest.raises(RuntimeError, match="525"):
        install.build_for_driver("nvidia", nv("8.6", "470.99"))
    with pytest.raises(RuntimeError, match="525"):
        install.build_for_driver("nvidia_cu126", nv("6.1", "470.99"))


def test_rtx_50_series_needs_the_new_driver_there_is_no_fallback():
    with pytest.raises(RuntimeError, match="580"):
        install.build_for_driver("nvidia", nv("12.0", "560.94"))


def test_unknown_driver_or_build_is_left_alone():
    assert install.build_for_driver("nvidia", {"vendor": "nvidia", "name": "x"}) == "nvidia"
    assert install.build_for_driver("amd", nv("8.6", "100.0")) == "amd"
    assert install.build_for_driver("nvidia", nv("8.6", "garbage")) == "nvidia"


def test_choose_build_applies_the_driver_check(capsys):
    build, flags = install.choose_build(nv("8.6", "551.23"), interactive=False)
    assert build == "nvidia_cu126"


# --------------------------------------------------------------------------- nothing outside the install folder, nothing personal shipped


def test_python_is_installed_without_a_shim_or_a_registry_entry():
    bat = (ROOT / "Install.bat").read_text(encoding="utf-8")
    line = next(l for l in bat.splitlines() if l.strip().startswith("uv python install"))
    assert "--no-bin" in line and "--no-registry" in line  # else uv writes %USERPROFILE%\.local\bin and HKCU\Software\Python


def test_every_cache_the_installer_uses_lives_inside_the_folder():
    bat = (ROOT / "Install.bat").read_text(encoding="utf-8")
    assert 'UV_CACHE_DIR=%~dp0bin' in bat and 'UV_PYTHON_INSTALL_DIR=%~dp0bin' in bat and "only-managed" in bat
    src = (ROOT / "installer" / "install.py").read_text(encoding="utf-8")
    assert 'os.environ["PIP_CACHE_DIR"] = str(DATA / "cache" / "pip")' in src  # pip would use %LOCALAPPDATA%\pip


def test_no_personal_strings_in_shipped_files():
    banned = ["accionick", "z-fusion", "zfusion", "desktop-2oh5jfo", "gmail.com", "nicrafbords"]
    shipped = [p for pat in ("*.bat", "README.md", "requirements.txt", "installer/*.py", "server/*.py", "scripts/export-templates.*")
               for p in ROOT.glob(pat)]
    assert shipped
    hits = [f"{p.name}: {b}" for p in shipped for b in banned if b in p.read_text(encoding="utf-8", errors="ignore").lower()]
    assert not hits, hits


# --------------------------------------------------------------------------- slow connections are dropped and re-made, progress kept

def scripted_curl(monkeypatch, steps):
    """Replace curl: each step is (exit code, bytes to append to the .part file). Returns the list of calls."""
    calls = []
    todo = iter(steps)

    def fake_run(cmd, **kw):
        calls.append(cmd)
        rc, grow = next(todo)
        part = Path(cmd[cmd.index("-o") + 1])
        if grow:
            with part.open("ab") as f:
                f.write(b"x" * grow)
        return type("R", (), {"returncode": rc})()

    monkeypatch.setattr(core.subprocess, "run", fake_run)
    monkeypatch.setattr(core.time, "sleep", lambda seconds: None)  # the pause after a real failure; not needed to test the logic
    return calls


MB = 1024 * 1024


def test_a_slow_connection_that_made_progress_is_reconnected_without_using_up_the_retries(tmp_path, monkeypatch, capsys):
    calls = scripted_curl(monkeypatch, [(28, 3 * MB)] * 12 + [(0, MB)])  # twelve slow connections, then a good one
    core.curl_download("http://x/f", tmp_path / "f.bin", retries=5)
    assert len(calls) == 13 and (tmp_path / "f.bin").stat().st_size == 37 * MB
    out = capsys.readouterr().out
    assert out.count("reconnecting") == 12 and "failed" not in out  # none of it counted as a failure


def test_attempts_that_get_nowhere_still_run_out(tmp_path, monkeypatch):
    calls = scripted_curl(monkeypatch, [(28, 0)] * 10)
    with pytest.raises(RuntimeError, match="download failed"):
        core.curl_download("http://x/f", tmp_path / "f.bin", retries=5)
    assert len(calls) == 5


def test_progress_and_failures_mix(tmp_path, monkeypatch):
    calls = scripted_curl(monkeypatch, [(28, 0), (28, 0), (28, 2 * MB), (6, 0), (28, 0), (0, 0)])
    core.curl_download("http://x/f", tmp_path / "f.bin", retries=5)  # 4 real failures; the slow-but-moving connection did not count
    assert len(calls) == 6


def test_a_connection_that_is_slow_forever_still_ends(tmp_path, monkeypatch):
    monkeypatch.setattr(core, "MAX_RECONNECTS", 6)
    calls = scripted_curl(monkeypatch, [(28, MB)] * 50)
    with pytest.raises(RuntimeError, match="too slow"):
        core.curl_download("http://x/f", tmp_path / "f.bin")
    assert len(calls) == 6


def test_the_slow_limits_are_sensible():
    assert 50_000 <= core.SLOW_BELOW_BYTES_PER_SECOND <= 500_000 and 10 <= core.SLOW_FOR_SECONDS <= 60
    guard = " ".join(core.CURL_STALL_GUARD)
    assert f"--speed-limit {core.SLOW_BELOW_BYTES_PER_SECOND}" in guard and f"--speed-time {core.SLOW_FOR_SECONDS}" in guard
