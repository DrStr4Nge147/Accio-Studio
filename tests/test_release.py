"""Release packaging (spec 11.5): the zip holds only the allow-listed files and refuses models, secrets and runtime data."""
from __future__ import annotations

import json
import sys
import zipfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import make_release  # noqa: E402


def touch(root: Path, rel: str, data: bytes = b"x") -> None:
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)


@pytest.fixture
def tree(tmp_path):
    for rel in [
        "Install.bat", "Run_Accio.bat", "README.md", "LICENSE", "requirements.txt",
        "server/main.py", "server/templates/manifest.json", "server/__pycache__/main.cpython-312.pyc",
        "installer/install.py", "frontend/dist/index.html", "frontend/dist/assets/app.js",
        "scripts/export-templates.md", "scripts/make_release.py", "scripts/parity_gpu.py",
        # things that must never ship
        "settings.json", ".zrok_share", ".env", "zrok.exe", "cloudflared.exe",
        "env/Scripts/python.exe", "bin/uv.exe", "comfyui/ComfyUI/models/loras/x.safetensors",
        "data/history.db", "frontend/node_modules/x/index.js", "frontend/src/main.tsx", "tests/test_x.py",
        "design/proposal.html", "comfy-templates/krea.json", "APP_SPEC.md", "PROGRESS.md",
    ]:
        touch(tmp_path, rel)
    for bat in ("Install.bat", "Run_Accio.bat"):
        (tmp_path / bat).write_bytes(b"@echo off\r\necho hi\r\n")
    (tmp_path / "frontend" / "package.json").write_text(json.dumps({"version": "2.3.4"}), encoding="utf-8")
    return tmp_path


def names(zip_path: Path) -> set[str]:
    with zipfile.ZipFile(zip_path) as z:
        return set(z.namelist())


def test_zip_has_only_the_allow_listed_files(tree, tmp_path):
    out = make_release.build_release(tree, tmp_path / "out", "2.3.4", check_dist=False)
    assert out.name == "AccioStudio-2.3.4.zip"
    got = {n.split("/", 1)[1] for n in names(out)}
    assert got == {
        "Install.bat", "Run_Accio.bat", "README.md", "LICENSE", "requirements.txt",
        "server/main.py", "server/templates/manifest.json", "installer/install.py",
        "frontend/dist/index.html", "frontend/dist/assets/app.js", "scripts/export-templates.md",
    }
    assert all(n.startswith("AccioStudio/") for n in names(out))  # no version in the folder name


def test_version_comes_from_package_json(tree):
    assert make_release.package_version(tree) == "2.3.4"


@pytest.mark.parametrize("bad", [
    "AccioStudio-1/models/a.safetensors", "AccioStudio-1/settings.json", "AccioStudio-1/.zrok_share",
    "AccioStudio-1/zrok.exe", "AccioStudio-1/data/x.txt", "AccioStudio-1/env/a.py", "AccioStudio-1/server/.env",
    "AccioStudio-1/comfyui/a.txt", "AccioStudio-1/tests/test_a.py",
])
def test_forbidden_members_are_refused(bad):
    with pytest.raises(SystemExit):
        make_release.check_names(["AccioStudio-1/README.md", bad])


def test_lf_only_batch_file_is_refused(tree, tmp_path):
    (tree / "Run_Accio.bat").write_bytes(b"@echo off\necho hi\n")
    with pytest.raises(SystemExit, match="CRLF"):
        make_release.build_release(tree, tmp_path / "out", "1", check_dist=False)


def test_stale_or_missing_frontend_build_is_refused(tree, tmp_path):
    import os
    import time

    touch(tree, "frontend/src/main.tsx")
    index = tree / "frontend" / "dist" / "index.html"
    os.utime(index, (time.time() - 100, time.time() - 100))
    with pytest.raises(SystemExit, match="older"):
        make_release.build_release(tree, tmp_path / "out", "1")
    index.unlink()
    with pytest.raises(SystemExit, match="missing"):
        make_release.build_release(tree, tmp_path / "out", "1")


def test_missing_readme_is_refused(tree, tmp_path):
    (tree / "README.md").unlink()
    with pytest.raises(SystemExit, match="README"):
        make_release.build_release(tree, tmp_path / "out", "1", check_dist=False)


def test_initial_js_budget(tree):
    import os

    dist = tree / "frontend" / "dist"
    (dist / "index.html").write_text('<script type="module" src="/assets/index-a.js"></script><link rel="modulepreload" href="/assets/store-b.js">', encoding="utf-8")
    (dist / "assets").mkdir(exist_ok=True)
    (dist / "assets" / "index-a.js").write_bytes(os.urandom(150 * 1024))  # incompressible: about 150 KB gzipped
    (dist / "assets" / "store-b.js").write_bytes(b"x" * 100)
    (dist / "assets" / "Lazy-c.js").write_bytes(os.urandom(500 * 1024))  # lazy chunk: not counted
    assert 149 < make_release.initial_js_kb(tree) < 152
    make_release.check_bundle_budget(tree)
    (dist / "assets" / "store-b.js").write_bytes(os.urandom(60 * 1024))
    with pytest.raises(SystemExit, match="budget"):
        make_release.check_bundle_budget(tree)


# --------------------------------------------------------------------------- version bump and the release flow

import hashlib  # noqa: E402
import os  # noqa: E402
import subprocess  # noqa: E402
import time  # noqa: E402


@pytest.mark.parametrize("current, kind, expected", [
    ("0.1.0", "patch", "0.1.1"), ("0.1.9", "patch", "0.1.10"), ("0.1.5", "minor", "0.2.0"), ("1.4.7", "major", "2.0.0"),
])
def test_bump_version(current, kind, expected):
    assert make_release.bump_version(current, kind) == expected


@pytest.mark.parametrize("bad", ["1.0", "v1.0.0", "1.0.0-beta", ""])
def test_bump_refuses_versions_that_are_not_plain_semver(bad):
    with pytest.raises(SystemExit, match="MAJOR.MINOR.PATCH"):
        make_release.bump_version(bad, "patch")


def test_write_version_changes_only_the_project_versions(tmp_path):
    fe = tmp_path / "frontend"
    fe.mkdir()
    (fe / "package.json").write_text('{\n  "name": "x",\n  "version": "0.1.0",\n  "dependencies": {"react": "^19.0.0"}\n}\n', encoding="utf-8")
    (fe / "package-lock.json").write_text(
        '{\n  "name": "x",\n  "version": "0.1.0",\n  "packages": {\n    "": {\n      "name": "x",\n      "version": "0.1.0"\n    },\n'
        '    "node_modules/react": {\n      "version": "19.0.0"\n    }\n  }\n}\n', encoding="utf-8")
    assert make_release.write_version(tmp_path, "0.2.0") == ["package.json", "package-lock.json"]
    assert json.loads((fe / "package.json").read_text())["version"] == "0.2.0"
    lock = json.loads((fe / "package-lock.json").read_text())
    assert lock["version"] == "0.2.0" and lock["packages"][""]["version"] == "0.2.0"
    assert lock["packages"]["node_modules/react"]["version"] == "19.0.0"  # dependency untouched


def sh(cwd: Path, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True).stdout


@pytest.fixture
def repo(tree):
    """The release tree as a git repository with one commit and a fresh frontend build."""
    sh(tree, "init", "-q")
    sh(tree, "config", "user.name", "Test")
    sh(tree, "config", "user.email", "test@example.invalid")
    sh(tree, "config", "core.autocrlf", "false")
    sh(tree, "add", "-A")
    sh(tree, "commit", "-q", "-m", "initial")
    index = tree / "frontend" / "dist" / "index.html"
    os.utime(index, (time.time() + 60, time.time() + 60))  # newer than every source file
    return tree


def outside(tmp_path: Path, name: str = "out") -> Path:
    """An output folder next to the repository, never inside it (it would show up as untracked)."""
    return tmp_path.with_name(f"{tmp_path.name}-{name}")


def run_release(repo: Path, tmp_path: Path, *extra: str) -> Path:
    out = outside(tmp_path)
    make_release.main(["--skip-tests", "--no-build", "--out", str(out), *extra], root=repo)
    return out


def test_release_without_a_bump_rebuilds_the_current_version_and_makes_no_commit(repo, tmp_path):
    before = sh(repo, "rev-parse", "HEAD")
    out = run_release(repo, tmp_path)
    zip_path = out / "AccioStudio-2.3.4.zip"
    assert zip_path.is_file()
    assert sh(repo, "rev-parse", "HEAD") == before and sh(repo, "tag", "--list") == ""
    with zipfile.ZipFile(zip_path) as z:
        info = z.read("AccioStudio/VERSION.txt").decode()
    assert info.startswith("Accio Studio 2.3.4") and sh(repo, "rev-parse", "--short", "HEAD").strip() in info
    digest = (out / "AccioStudio-2.3.4.zip.sha256").read_text().split()[0]
    assert digest == hashlib.sha256(zip_path.read_bytes()).hexdigest()


def test_bump_releases_commits_and_tags_the_new_version(repo, tmp_path):
    out = run_release(repo, tmp_path, "--bump", "patch")
    assert (out / "AccioStudio-2.3.5.zip").is_file() and not (out / "AccioStudio-2.3.4.zip").exists()
    assert make_release.package_version(repo) == "2.3.5"
    assert sh(repo, "log", "-1", "--format=%s").strip() == "Release v2.3.5"
    assert sh(repo, "tag", "--list").split() == ["v2.3.5"]
    assert sh(repo, "status", "--porcelain").strip() == ""  # nothing left uncommitted
    with zipfile.ZipFile(out / "AccioStudio-2.3.5.zip") as z:
        assert z.read("AccioStudio/VERSION.txt").decode().startswith("Accio Studio 2.3.5")


def test_an_existing_tag_blocks_a_release_of_that_version(repo, tmp_path):
    sh(repo, "tag", "v2.3.5")  # left over from an earlier release
    with pytest.raises(SystemExit, match="v2.3.5 already exists"):
        run_release(repo, tmp_path, "--bump", "patch")
    assert make_release.package_version(repo) == "2.3.4"  # nothing was changed


def test_uncommitted_changes_are_refused_unless_allowed(repo, tmp_path):
    (repo / "README.md").write_text("changed after the last commit")
    with pytest.raises(SystemExit, match="uncommitted"):
        run_release(repo, tmp_path)
    assert not outside(tmp_path).exists()
    out = run_release(repo, tmp_path, "--allow-dirty")
    with zipfile.ZipFile(out / "AccioStudio-2.3.4.zip") as z:
        assert "uncommitted" in z.read("AccioStudio/VERSION.txt").decode()


def test_failing_tests_stop_the_release(repo, tmp_path, monkeypatch):
    monkeypatch.setattr(make_release.subprocess, "run", lambda *a, **k: type("R", (), {"returncode": 1})())
    with pytest.raises(SystemExit, match="tests failed"):
        make_release.main(["--no-build", "--out", str(outside(tmp_path))], root=repo)
    assert not outside(tmp_path).exists()


def test_version_and_bump_together_are_refused(repo, tmp_path):
    with pytest.raises(SystemExit, match="either"):
        run_release(repo, tmp_path, "--version", "9.9.9", "--bump", "minor")


def test_a_folder_that_is_not_a_git_repository_still_releases(tree, tmp_path, capsys):
    os.utime(tree / "frontend" / "dist" / "index.html", (time.time() + 60, time.time() + 60))
    out = run_release(tree, tmp_path, "--bump", "minor")
    assert (out / "AccioStudio-2.4.0.zip").is_file() and make_release.package_version(tree) == "2.4.0"
    assert "not a git repository" in capsys.readouterr().err


# --------------------------------------------------------------------------- the menu

def answers(*given: str):
    """A fake input() that returns the given answers in order and fails if asked more."""
    it = iter(given)

    def ask(prompt: str = "") -> str:
        try:
            return next(it)
        except StopIteration:
            raise AssertionError(f"asked again: {prompt!r}")

    return ask


@pytest.mark.parametrize("pick, expected", [("1", ["--bump", "patch"]), ("2", ["--bump", "minor"]), ("3", ["--bump", "major"]), ("4", [])])
def test_menu_choices_map_to_arguments(repo, pick, expected):
    assert make_release.ask_release_options(repo, ask=answers(pick, "")) == expected  # "" = accept the confirmation


def test_menu_cancel_and_declined_confirmation_do_nothing(repo):
    assert make_release.ask_release_options(repo, ask=answers("5")) is None
    assert make_release.ask_release_options(repo, ask=answers("1", "n")) is None


def test_menu_retries_bad_input_a_few_times_then_cancels(repo):
    assert make_release.ask_release_options(repo, ask=answers("x", "9", "")) is None  # three tries, no endless loop
    assert make_release.ask_release_options(repo, ask=answers("x", "2", "y")) == ["--bump", "minor"]


def test_menu_shows_what_each_choice_would_produce(repo, capsys):
    make_release.ask_release_options(repo, ask=answers("5"))
    out = capsys.readouterr().out
    assert "version 2.3.4" in out and "-> 2.3.5" in out and "-> 2.4.0" in out and "-> 3.0.0" in out


def test_menu_handles_uncommitted_changes_first(repo):
    (repo / "README.md").write_text("changed")
    assert make_release.ask_release_options(repo, ask=answers("n")) is None
    assert make_release.ask_release_options(repo, ask=answers("y", "4", "")) == ["--allow-dirty"]


def test_menu_is_only_used_for_an_interactive_run_without_arguments(repo, tmp_path, monkeypatch):
    def boom(*a, **k):
        raise AssertionError("menu must not appear")

    monkeypatch.setattr(make_release, "ask_release_options", boom)
    monkeypatch.setattr(make_release.sys, "argv", ["make_release.py"])
    monkeypatch.setattr(make_release.sys.stdin, "isatty", lambda: False, raising=False)  # piped or scheduled: no menu
    run_release(repo, tmp_path)  # explicit argv anyway
    monkeypatch.setattr(make_release.sys, "argv", ["make_release.py", "--no-build"])
    make_release.main(["--skip-tests", "--no-build", "--out", str(outside(tmp_path, "o3"))], root=repo)
