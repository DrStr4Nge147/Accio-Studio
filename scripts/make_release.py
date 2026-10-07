"""Build AccioStudio-<version>.zip (APP_SPEC 11.5).

The zip holds only what a user needs: the launcher .bat files, the server and installer code, the templates and
manifest, the built frontend (frontend\\dist), requirements.txt, README.md and LICENSE. It never holds env\\, bin\\,
comfyui\\, node_modules\\, data\\, settings.json, .zrok_share, models or executables. The file list is an allow-list,
and the finished archive is scanned once more for anything that must not ship.

    env\\Scripts\\python.exe scripts\\make_release.py [--version 1.2.3] [--out release] [--build]

--build runs `npm run build` first (otherwise frontend\\dist must already exist and be newer than the sources).
"""
from __future__ import annotations

import argparse
import gzip
import json
import re
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Allow-list, relative to the project root. "dir/**/*" = every file below, minus the excluded bits.
INCLUDE_FILES = ["requirements.txt", "README.md", "LICENSE", "LICENSE.txt", "LICENSE.md"]
INCLUDE_GLOBS = ["*.bat", "server/**/*", "installer/**/*", "frontend/dist/**/*", "scripts/export-templates.md", "scripts/export-templates.js"]
SKIP_PARTS = {"__pycache__", ".pytest_cache", "node_modules", ".git"}
SKIP_SUFFIXES = {".pyc", ".pyo", ".log", ".part", ".tmp"}

# Nothing matching these may be in the archive, whatever the allow-list says.
FORBIDDEN_SUFFIXES = {".safetensors", ".ckpt", ".pt", ".pth", ".gguf", ".bin", ".onnx", ".exe", ".dll", ".7z", ".env"}
FORBIDDEN_NAMES = {"settings.json", ".zrok_share", ".env", "history.db", "sessions.json", "install.json", "extra_model_paths.yaml"}
FORBIDDEN_TOP = {"env", "bin", "comfyui", "data", "node_modules", "tests", "design", "comfy-templates"}


def package_version(root: Path) -> str:
    return json.loads((root / "frontend" / "package.json").read_text(encoding="utf-8"))["version"]


def collect(root: Path) -> list[Path]:
    """Files to ship, as paths relative to `root`, sorted."""
    found: set[Path] = set()
    for name in INCLUDE_FILES:
        if (root / name).is_file():
            found.add(Path(name))
    for pattern in INCLUDE_GLOBS:
        for p in root.glob(pattern):
            if p.is_file():
                found.add(p.relative_to(root))
    keep = [
        p for p in found
        if not (SKIP_PARTS & set(p.parts)) and p.suffix.lower() not in SKIP_SUFFIXES
    ]
    return sorted(keep)


def check_names(names: list[str]) -> None:
    """Raise if any archive member is something that must never ship (models, secrets, runtime data, binaries)."""
    bad = []
    for n in names:
        p = Path(n)
        parts = p.parts[1:] if len(p.parts) > 1 else p.parts  # drop the top folder
        if (
            p.suffix.lower() in FORBIDDEN_SUFFIXES
            or p.name in FORBIDDEN_NAMES
            or (parts and parts[0] in FORBIDDEN_TOP)
        ):
            bad.append(n)
    if bad:
        raise SystemExit("refusing to build, these must not ship:\n  " + "\n  ".join(bad))


def check_frontend(root: Path, files: list[Path]) -> None:
    dist = root / "frontend" / "dist" / "index.html"
    if not dist.is_file():
        raise SystemExit("frontend\\dist is missing. Run with --build (or `npm run build` in frontend\\).")
    newest_src = max((p.stat().st_mtime for p in (root / "frontend" / "src").rglob("*") if p.is_file()), default=0)
    if dist.stat().st_mtime < newest_src:
        raise SystemExit("frontend\\dist is older than the sources in frontend\\src. Run with --build.")


INITIAL_JS_BUDGET_KB = 200  # gzipped, spec 6.1a


def initial_js_kb(root: Path) -> float:
    """Gzipped size of the scripts index.html loads up front (entry + preloaded chunks); lazy chunks are not counted."""
    dist = root / "frontend" / "dist"
    html = (dist / "index.html").read_text(encoding="utf-8")
    total = 0
    for ref in set(re.findall(r'(?:src|href)="(/[^"]+\.js)"', html)):
        f = dist / ref.lstrip("/")
        if f.is_file() and "/assets/" in ref:
            total += len(gzip.compress(f.read_bytes(), 9))
    return total / 1024


def check_bundle_budget(root: Path) -> None:
    kb = initial_js_kb(root)
    if kb > INITIAL_JS_BUDGET_KB:
        raise SystemExit(f"initial JavaScript is {kb:.0f} KB gzipped; the budget is {INITIAL_JS_BUDGET_KB} KB (spec 6.1a)")


def check_batch_files(root: Path, files: list[Path]) -> None:
    """Batch files must be CRLF (cmd.exe mis-parses LF labels)."""
    for p in files:
        if p.suffix == ".bat":
            data = (root / p).read_bytes()
            if b"\n" in data.replace(b"\r\n", b""):
                raise SystemExit(f"{p} has LF-only line endings; batch files must be CRLF")


def build_release(root: Path, out_dir: Path, version: str, *, check_dist: bool = True) -> Path:
    files = collect(root)
    if check_dist:
        check_frontend(root, files)
        check_bundle_budget(root)
    if not any(p.name.startswith("README") for p in files):
        raise SystemExit("README.md is missing")
    if not any(p.name.startswith("LICENSE") for p in files):
        print("WARNING: no LICENSE file in the project; the release has none. Add one before publishing.", file=sys.stderr)
    check_batch_files(root, files)
    top = f"AccioStudio-{version}"
    check_names([f"{top}/{p.as_posix()}" for p in files])
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / f"{top}.zip"
    tmp = target.with_suffix(".zip.part")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for p in files:
            z.write(root / p, f"{top}/{p.as_posix()}")
    with zipfile.ZipFile(tmp) as z:  # re-read what was written
        if z.testzip():
            raise SystemExit("the archive failed its integrity check")
        check_names(z.namelist())
    tmp.replace(target)
    return target


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--version", help="default: the version in frontend\\package.json")
    ap.add_argument("--out", default="release", type=Path, help="output folder (default: release\\)")
    ap.add_argument("--build", action="store_true", help="run `npm run build` in frontend\\ first")
    a = ap.parse_args()
    if a.build:
        subprocess.run("npm run build", cwd=ROOT / "frontend", shell=True, check=True)
    target = build_release(ROOT, a.out if a.out.is_absolute() else ROOT / a.out, a.version or package_version(ROOT))
    with zipfile.ZipFile(target) as z:
        n = len(z.namelist())
    print(f"{target}  ({target.stat().st_size / 1e6:.1f} MB, {n} files)")


if __name__ == "__main__":
    main()
