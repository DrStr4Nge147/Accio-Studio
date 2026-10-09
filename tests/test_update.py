"""The updater (installer/update.py): finding the release, verifying it, swapping only the app files, rolling back on failure."""
from __future__ import annotations

import hashlib
import json
import sys
import zipfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "installer"))
import update as up  # noqa: E402

OLD, NEW = "0.1.0", "0.1.1"


def manifest(engine: str = "0.38.0") -> str:
    return json.dumps({"comfyui": {"version": engine}})


def app_files(version: str, marker: str, engine: str = "0.38.0") -> dict[str, str]:
    """The files a release carries, with `marker` in the ones the tests look at."""
    return {
        "VERSION.txt": f"Accio Studio {version}\r\nBuilt 2026-01-01 00:00 UTC from commit abc1234\r\n",
        "Install.bat": f"@echo off\r\nrem {marker}\r\n",
        "Update.bat": f"@echo off\r\nrem {marker}\r\n",
        "Run_Accio.bat": f"@echo off\r\nrem {marker}\r\n",
        "README.md": f"readme {marker}",
        "LICENSE": "MIT",
        "requirements.txt": f"# {marker}\n",
        "server/main.py": f"# server {marker}\n",
        "server/templates/manifest.json": manifest(engine),
        "installer/update.py": f"# updater {marker}\n",
        "installer/install.py": f"# installer {marker}\n",
        "frontend/dist/index.html": f"<html>{marker}</html>",
        "frontend/dist/assets/app.js": f"// {marker}",
        "scripts/export-templates.md": f"notes {marker}",
    }


def write_tree(root: Path, files: dict[str, str]) -> None:
    for rel, text in files.items():
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(text.encode("utf-8"))


def make_zip(path: Path, files: dict[str, str], *, top: str = "AccioStudio", sidecar: bool = True, wrong_sha: bool = False) -> Path:
    with zipfile.ZipFile(path, "w") as z:
        for rel, text in files.items():
            z.writestr(f"{top}/{rel}", text)
    if sidecar:
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if wrong_sha:
            digest = "0" * 64
        path.with_name(path.name + ".sha256").write_text(f"{digest} *{path.name}\n", encoding="utf-8")
    return path


def snapshot(root: Path) -> dict[str, bytes]:
    return {p.relative_to(root).as_posix(): p.read_bytes() for p in sorted(root.rglob("*")) if p.is_file()}


@pytest.fixture
def app(tmp_path):
    """An installed copy at 0.1.0 with the things an update must never touch."""
    root = tmp_path / "install"
    write_tree(root, app_files(OLD, "old"))
    write_tree(root, {
        "server/__pycache__/main.cpython-312.pyc": "stale",
        "data/history.db": "MY HISTORY", "data/install.json": "{}", "settings.json": '{"_auth": "MY PASSWORD HASH"}',
        "env/Scripts/python.exe": "venv", "bin/uv.exe": "uv", "comfyui/ComfyUI/models/loras/mine.safetensors": "MY MODEL",
        ".zrok_share": "token",
    })
    return root


KEEP = ["data/history.db", "data/install.json", "settings.json", "env/Scripts/python.exe", "bin/uv.exe",
        "comfyui/ComfyUI/models/loras/mine.safetensors", ".zrok_share"]


def new_zip(tmp_path: Path, **kw) -> Path:
    return make_zip(tmp_path / f"AccioStudio-{NEW}.zip", app_files(NEW, "new", kw.pop("engine", "0.38.0")), **kw)


def run(app: Path, zip_file: Path, **kw) -> int:
    return up.update(app, zip_file=zip_file, yes=True, stop=False, install=False, **kw)


# --------------------------------------------------------------------------- versions

@pytest.mark.parametrize("latest, current, newer", [("0.1.1", "0.1.0", True), ("0.2.0", "0.1.9", True), ("1.0.0", "0.9.9", True),
                                                    ("0.1.0", "0.1.0", False), ("0.0.9", "0.1.0", False), ("0.10.0", "0.9.0", True), ("junk", "0.1.0", False)])
def test_is_newer(latest, current, newer):
    assert up.is_newer(latest, current) is newer


def test_installed_version_comes_from_version_txt_then_package_json(tmp_path):
    assert up.installed_version(tmp_path) == "0.0.0"
    (tmp_path / "frontend").mkdir()
    (tmp_path / "frontend" / "package.json").write_text('{"version": "2.3.4"}')
    assert up.installed_version(tmp_path) == "2.3.4"
    (tmp_path / "VERSION.txt").write_text("Accio Studio 0.5.6\r\nBuilt now\r\n")
    assert up.installed_version(tmp_path) == "0.5.6"


# --------------------------------------------------------------------------- the release answer from GitHub

def release_json(version: str = NEW, *, digest: bool = True, sidecar: bool = False, zip_asset: bool = True) -> dict:
    name = f"AccioStudio-{version}.zip"
    assets = []
    if zip_asset:
        a = {"name": name, "browser_download_url": f"https://example.invalid/{name}", "size": 1234}
        if digest:
            a["digest"] = "sha256:" + "ab" * 32
        assets.append(a)
    if sidecar:
        assets.append({"name": name + ".sha256", "browser_download_url": f"https://example.invalid/{name}.sha256"})
    return {"tag_name": f"v{version}", "html_url": "https://example.invalid/release", "assets": assets}


def test_parse_release_uses_the_digest_github_computed():
    info = up.parse_release(release_json())
    assert info["version"] == NEW and info["sha256"] == "ab" * 32 and info["zip_name"] == f"AccioStudio-{NEW}.zip" and info["size"] == 1234


def test_parse_release_refuses_unusable_releases():
    with pytest.raises(up.UpdateError, match="no AccioStudio"):
        up.parse_release(release_json(zip_asset=False))
    with pytest.raises(up.UpdateError, match="unusable version"):
        up.parse_release({"tag_name": "nightly", "assets": []})
    wrong = release_json("0.1.1")
    wrong["assets"][0]["name"] = "AccioStudio-0.9.9.zip"  # a zip for some other version is not this release's zip
    with pytest.raises(up.UpdateError, match="no AccioStudio"):
        up.parse_release(wrong)


def test_fetch_latest_reads_the_checksum_from_the_sidecar_when_there_is_no_digest(monkeypatch):
    answers = {"https://api/latest": json.dumps(release_json(digest=False, sidecar=True)).encode(),
               f"https://example.invalid/AccioStudio-{NEW}.zip.sha256": (("cd" * 32) + f" *AccioStudio-{NEW}.zip\n").encode()}
    monkeypatch.setattr(up, "_get", lambda url, timeout=15: answers[url])
    assert up.fetch_latest("https://api/latest")["sha256"] == "cd" * 32


def test_a_release_without_any_checksum_is_never_installed(monkeypatch):
    monkeypatch.setattr(up, "_get", lambda url, timeout=15: json.dumps(release_json(digest=False)).encode())
    with pytest.raises(up.UpdateError, match="SHA-256"):
        up.fetch_latest("https://api/latest")


# --------------------------------------------------------------------------- the zip

@pytest.mark.parametrize("name", ["AccioStudio/../evil.txt", "AccioStudio/server/../../x", "Other/server/main.py", "AccioStudio/C:/x", "/AccioStudio/x"])
def test_unsafe_zip_paths_are_refused(name):
    with pytest.raises(up.UpdateError):
        up.clean_member(name)


@pytest.mark.parametrize("extra", ["settings.json", "data/history.db", "env/Scripts/python.exe", "comfyui/x.txt", "bin/uv.exe", "server/model.safetensors",
                                   "installer/tool.exe", "notes.txt", "server/templates/extra_model_paths.yaml"])
def test_a_zip_may_only_carry_app_files(tmp_path, extra):
    files = {**app_files(NEW, "new"), extra: "x"}
    with pytest.raises(up.UpdateError):
        up.extract_release(make_zip(tmp_path / "z.zip", files, sidecar=False), tmp_path / "out")


def test_an_incomplete_zip_is_refused(tmp_path):
    files = app_files(NEW, "new")
    del files["server/main.py"]
    with pytest.raises(up.UpdateError, match="incomplete"):
        up.extract_release(make_zip(tmp_path / "z.zip", files, sidecar=False), tmp_path / "out")


def test_a_good_zip_is_unpacked(tmp_path):
    written = up.extract_release(make_zip(tmp_path / "z.zip", app_files(NEW, "new"), sidecar=False), tmp_path / "out")
    assert "server/main.py" in written and (tmp_path / "out" / "frontend" / "dist" / "assets" / "app.js").is_file()


# --------------------------------------------------------------------------- updating

def test_update_swaps_the_app_files_and_leaves_everything_else_alone(app, tmp_path):
    before = snapshot(app)
    assert run(app, new_zip(tmp_path)) == 0
    assert up.installed_version(app) == NEW
    for rel, text in app_files(NEW, "new").items():
        assert (app / rel).read_bytes().decode("utf-8") == text, rel
    after = snapshot(app)
    for rel in KEEP:
        assert after[rel] == before[rel], f"{rel} must not change"
    assert not (app / "server" / "__pycache__").exists() and not list(app.glob("*.replaced")) and not (app / "server.replaced").exists()


def test_the_old_version_is_backed_up_first(app, tmp_path):
    run(app, new_zip(tmp_path))
    (backup,) = (app / "data" / "backup").iterdir()
    assert backup.name.startswith(OLD + "-")
    assert (backup / "server" / "main.py").read_text() == "# server old\n" and (backup / "Install.bat").is_file() and (backup / "VERSION.txt").is_file()
    assert not (backup / "settings.json").exists() and not (backup / "comfyui").exists()  # personal data and models are never copied


def test_only_the_three_newest_backups_are_kept(app, tmp_path):
    import os
    import time

    root = app / "data" / "backup"
    for i in range(5):
        (root / f"0.0.{i}-x").mkdir(parents=True)
        os.utime(root / f"0.0.{i}-x", (time.time() - 1000 + i, time.time() - 1000 + i))
    up.backup_current(app, OLD)
    assert len(list(root.iterdir())) == up.KEEP_BACKUPS


def test_already_up_to_date_changes_nothing(app, tmp_path):
    before = snapshot(app)
    same = make_zip(tmp_path / f"AccioStudio-{OLD}.zip", app_files(OLD, "same"))
    assert run(app, same) == 0 and snapshot(app) == before
    older = make_zip(tmp_path / "AccioStudio-0.0.9.zip", app_files("0.0.9", "older"))
    assert run(app, older) == 0 and snapshot(app) == before  # no silent downgrade


def test_force_reinstalls_the_same_version(app, tmp_path):
    same = make_zip(tmp_path / f"AccioStudio-{OLD}.zip", app_files(OLD, "reinstalled"))
    assert run(app, same, force=True) == 0
    assert (app / "server" / "main.py").read_text() == "# server reinstalled\n"


def test_check_only_reports_and_changes_nothing(app, tmp_path):
    before = snapshot(app)
    assert up.update(app, zip_file=new_zip(tmp_path), check=True) == 10
    assert up.update(app, zip_file=make_zip(tmp_path / f"AccioStudio-{OLD}.zip", app_files(OLD, "x")), check=True) == 0
    assert snapshot(app) == before


def test_a_wrong_checksum_stops_everything_before_any_change(app, tmp_path):
    before = snapshot(app)
    with pytest.raises(up.UpdateError, match="SHA-256"):
        run(app, new_zip(tmp_path, wrong_sha=True))
    assert snapshot(app) == before


def test_a_zip_without_its_checksum_file_is_refused(app, tmp_path):
    with pytest.raises(up.UpdateError, match="sha256"):
        run(app, new_zip(tmp_path, sidecar=False))


def test_a_release_that_upgrades_the_engine_is_refused_untouched(app, tmp_path):
    before = snapshot(app)
    with pytest.raises(up.UpdateError, match="ComfyUI engine"):
        run(app, new_zip(tmp_path, engine="0.40.0"))
    assert snapshot(app) == before


def test_a_zip_whose_version_differs_from_its_name_is_refused(app, tmp_path):
    before = snapshot(app)
    lying = make_zip(tmp_path / f"AccioStudio-{NEW}.zip", app_files("0.9.9", "lying"))
    with pytest.raises(up.UpdateError, match="not " + NEW):
        run(app, lying)
    assert snapshot(app) == before


def test_declining_the_question_changes_nothing(app, tmp_path):
    before = snapshot(app)
    assert up.update(app, zip_file=new_zip(tmp_path), stop=False, install=False, ask=lambda prompt: "n") == 0
    assert snapshot(app) == before


def test_a_failure_while_replacing_restores_the_old_version(app, tmp_path, monkeypatch):
    before = snapshot(app)
    real = up.shutil.copytree

    def flaky(src, dst, *a, **k):
        if str(dst).replace("\\", "/").endswith("frontend/dist") and "backup" not in str(dst):
            raise OSError("disk full")
        return real(src, dst, *a, **k)

    monkeypatch.setattr(up.shutil, "copytree", flaky)
    with pytest.raises(up.UpdateError, match="restored"):
        run(app, new_zip(tmp_path))
    monkeypatch.undo()
    after = {k: v for k, v in snapshot(app).items() if not k.startswith(("data/backup/", "data/update/"))}
    original = {k: v for k, v in before.items() if not k.startswith("server/__pycache__")}
    assert {k: v for k, v in after.items() if not k.startswith("server/__pycache__")} == original


def test_downloaded_updates_are_checked_and_applied(app, tmp_path, monkeypatch):
    zip_file = new_zip(tmp_path)
    digest = hashlib.sha256(zip_file.read_bytes()).hexdigest()
    monkeypatch.setattr(up, "fetch_latest", lambda api_url=None: {"version": NEW, "zip_name": zip_file.name, "zip_url": "https://example.invalid/z",
                                                                    "size": zip_file.stat().st_size, "sha256": digest, "notes_url": None})

    def fake_download(url, dest, expected_size=None):
        assert expected_size == zip_file.stat().st_size
        dest.write_bytes(zip_file.read_bytes())

    monkeypatch.setattr(up, "curl_download", fake_download)
    assert up.update(app, yes=True, stop=False, install=False) == 0
    assert up.installed_version(app) == NEW and not (app / "data" / "update" / zip_file.name).exists()  # the download is cleaned up


def test_a_corrupted_download_is_deleted_and_nothing_changes(app, tmp_path, monkeypatch):
    zip_file = new_zip(tmp_path)
    before = snapshot(app)
    monkeypatch.setattr(up, "fetch_latest", lambda api_url=None: {"version": NEW, "zip_name": zip_file.name, "zip_url": "x", "size": None,
                                                                    "sha256": "f" * 64, "notes_url": None})
    monkeypatch.setattr(up, "curl_download", lambda url, dest, expected_size=None: dest.write_bytes(zip_file.read_bytes()))
    with pytest.raises(up.UpdateError, match="SHA-256"):
        up.update(app, yes=True, stop=False, install=False)
    assert not (app / "data" / "update" / zip_file.name).exists()
    assert {k: v for k, v in snapshot(app).items() if not k.startswith("data/update/")} == {k: v for k, v in before.items() if not k.startswith("data/update/")}


def test_the_installer_runs_after_the_swap_and_its_failure_is_reported(app, tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(up, "run_installer", lambda root: calls.append(root) or False)
    assert up.update(app, zip_file=new_zip(tmp_path), yes=True, stop=False, install=True) == 2
    assert calls == [app] and up.installed_version(app) == NEW  # the new files stay in place


def test_accio_is_stopped_before_the_files_are_replaced(app, tmp_path, monkeypatch):
    order = []
    monkeypatch.setattr(up, "stop_accio", lambda root: order.append(("stop", up.installed_version(root))))
    monkeypatch.setattr(up, "backup_current", lambda root, v: order.append(("backup", v)) or (root / "data" / "backup" / "x"))
    monkeypatch.setattr(up, "apply_release", lambda root, new: order.append(("apply", None)))
    (app / "data" / "backup" / "x").mkdir(parents=True)
    up.update(app, zip_file=new_zip(tmp_path), yes=True, stop=True, install=False)
    assert [o[0] for o in order] == ["stop", "backup", "apply"] and order[0][1] == OLD


def test_the_updater_never_stops_itself_script_excludes_its_own_process():
    assert "ACCIO_SELF_PID" in up.STOP_SCRIPT and "ExecutablePath.StartsWith($root" in up.STOP_SCRIPT


def test_update_bat_ends_with_one_line_that_exits_because_the_update_replaces_it():
    lines = (ROOT / "Update.bat").read_text(encoding="utf-8").splitlines()
    last = [l for l in lines if l.strip()][-1]
    assert "installer\\update.py" in last and last.rstrip().endswith("exit /b")  # cmd must not read on from a file that changed
