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
    assert all(n.startswith("AccioStudio-2.3.4/") for n in names(out))


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
