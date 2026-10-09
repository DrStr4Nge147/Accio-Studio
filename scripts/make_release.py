"""Build AccioStudio-<version>.zip (APP_SPEC 11.5). The zip holds one folder, AccioStudio (no version in the folder name: the
version lives in the zip name and in VERSION.txt inside it).

The zip holds only what a user needs: the launcher .bat files, the server and installer code, the templates and
manifest, the built frontend (frontend\\dist), requirements.txt, README.md, LICENSE and a generated VERSION.txt. It never
holds env\\, bin\\, comfyui\\, node_modules\\, data\\, settings.json, .zrok_share, models or executables. The file list is
an allow-list, and the finished archive is scanned once more for anything that must not ship.

    env\\Scripts\\python.exe scripts\\make_release.py [--bump patch|minor|major | --version 1.2.3] [--out release]
                                                  [--no-build] [--skip-tests] [--allow-dirty]

What a run does, in order:
  1. refuses to continue when there are uncommitted changes (so the zip always matches a commit; --allow-dirty overrides),
  2. runs the test suite (--skip-tests skips it),
  3. rebuilds frontend\\dist with `npm run build` (--no-build skips it; then dist must be newer than the sources),
  4. packages the zip and writes <zip>.sha256 next to it,
  5. with --bump or --version: sets the new version in frontend\\package.json and package-lock.json, commits it as
     "Release vX.Y.Z" and tags it vX.Y.Z. Nothing is pushed: run `git push --follow-tags` yourself.
Without --bump/--version the current version is rebuilt as it is.
"""
from __future__ import annotations

import argparse
import datetime
import gzip
import hashlib
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


def build_release(root: Path, out_dir: Path, version: str, *, check_dist: bool = True, extra_files: dict[str, bytes] | None = None) -> Path:
    files = collect(root)
    if check_dist:
        check_frontend(root, files)
        check_bundle_budget(root)
    if not any(p.name.startswith("README") for p in files):
        raise SystemExit("README.md is missing")
    if not any(p.name.startswith("LICENSE") for p in files):
        print("WARNING: no LICENSE file in the project; the release has none. Add one before publishing.", file=sys.stderr)
    check_batch_files(root, files)
    top = "AccioStudio"  # the folder the user ends up with; the version is only in the zip name
    extra_files = extra_files or {}
    check_names([f"{top}/{p.as_posix()}" for p in files] + [f"{top}/{n}" for n in extra_files])
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / f"{top}-{version}.zip"
    tmp = target.with_suffix(".zip.part")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for p in files:
            z.write(root / p, f"{top}/{p.as_posix()}")
        for name, data in extra_files.items():
            z.writestr(f"{top}/{name}", data)
    with zipfile.ZipFile(tmp) as z:  # re-read what was written
        if z.testzip():
            raise SystemExit("the archive failed its integrity check")
        check_names(z.namelist())
    tmp.replace(target)
    return target


# --------------------------------------------------------------------------- versioning and the release flow

def bump_version(version: str, kind: str) -> str:
    m = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)", version)
    if not m:
        raise SystemExit(f"cannot bump version {version!r}: expected MAJOR.MINOR.PATCH")
    major, minor, patch = (int(x) for x in m.groups())
    if kind == "major":
        return f"{major + 1}.0.0"
    if kind == "minor":
        return f"{major}.{minor + 1}.0"
    if kind == "patch":
        return f"{major}.{minor}.{patch + 1}"
    raise SystemExit(f"unknown bump kind {kind!r}")


def write_version(root: Path, new: str) -> list[str]:
    """Set the version in frontend/package.json and in the two root entries of package-lock.json (dependencies keep theirs).
    Returns the file names changed."""
    changed = []
    for name, count in (("package.json", 1), ("package-lock.json", 2)):
        f = root / "frontend" / name
        if not f.is_file():
            continue
        text = f.read_bytes().decode("utf-8")
        updated, n = re.subn(r'("version":\s*")[^"]+(")', lambda m: f"{m.group(1)}{new}{m.group(2)}", text, count=count)
        if n != count:
            raise SystemExit(f"frontend/{name}: expected {count} version field(s) to update, found {n}")
        f.write_bytes(updated.encode("utf-8"))
        changed.append(name)
    return changed


def git(root: Path, *args: str, check: bool = False) -> str | None:
    """Output of a git command; None when git is missing or `root` is not a repository (unless `check`, which raises)."""
    try:
        r = subprocess.run(["git", "-C", str(root), *args], capture_output=True, text=True)
    except FileNotFoundError:
        if check:
            raise SystemExit("git is not installed")
        return None
    if r.returncode != 0:
        if check:
            raise SystemExit(f"git {' '.join(args)} failed: {r.stderr.strip()}")
        return None
    return r.stdout


def check_clean_tree(root: Path, allow_dirty: bool) -> None:
    out = git(root, "status", "--porcelain")
    if out is None:
        print("WARNING: git is not available here, so the working tree was not checked.", file=sys.stderr)
    elif out.strip() and not allow_dirty:
        raise SystemExit(
            "there are uncommitted changes, so the zip would not match any commit:\n" + out
            + "Commit them first, or pass --allow-dirty."
        )


def version_text(root: Path, version: str) -> str:
    commit = (git(root, "rev-parse", "--short", "HEAD") or "").strip() or "unknown"
    dirty = bool((git(root, "status", "--porcelain") or "").strip())
    when = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    return f"Accio Studio {version}\r\nBuilt {when} from commit {commit}{' (with uncommitted changes)' if dirty else ''}\r\n"


def write_checksum(zip_path: Path) -> str:
    digest = hashlib.sha256(zip_path.read_bytes()).hexdigest()
    zip_path.with_name(zip_path.name + ".sha256").write_text(f"{digest} *{zip_path.name}\n", encoding="utf-8")
    return digest


def commit_and_tag(root: Path, version: str) -> bool:
    """Write the new version, commit it and tag it. False when `root` is not a git repository (files are still updated)."""
    changed = write_version(root, version)
    if git(root, "rev-parse", "--git-dir") is None:
        print("WARNING: not a git repository, so the version was written but not committed or tagged.", file=sys.stderr)
        return False
    git(root, "add", *[f"frontend/{n}" for n in changed], check=True)
    git(root, "commit", "-m", f"Release v{version}", check=True)
    git(root, "tag", "-a", f"v{version}", "-m", f"Accio Studio {version}", check=True)
    return True


def main(argv: list[str] | None = None, root: Path = ROOT) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--version", help="release exactly this version (default: the version in frontend\\package.json)")
    ap.add_argument("--bump", choices=["patch", "minor", "major"], help="raise the current version and release that")
    ap.add_argument("--out", default="release", type=Path, help="output folder (default: release\\)")
    ap.add_argument("--build", action="store_true", help="kept for old command lines: building the frontend is the default")
    ap.add_argument("--no-build", action="store_true", help="do not run `npm run build` (frontend\\dist must be newer than the sources)")
    ap.add_argument("--skip-tests", action="store_true", help="do not run the test suite first")
    ap.add_argument("--allow-dirty", action="store_true", help="package even with uncommitted changes")
    a = ap.parse_args(argv)
    if a.version and a.bump:
        raise SystemExit("use either --version or --bump, not both")
    current = package_version(root)
    version = a.version or (bump_version(current, a.bump) if a.bump else current)
    new_release = version != current
    if new_release and (git(root, "tag", "--list", f"v{version}") or "").strip():
        raise SystemExit(f"the tag v{version} already exists; pick another version")
    check_clean_tree(root, a.allow_dirty)
    if not a.skip_tests:
        print("Running the tests ...", flush=True)
        if subprocess.run([sys.executable, "-m", "pytest", "tests", "-q", "-p", "no:cacheprovider"], cwd=root).returncode != 0:
            raise SystemExit("the tests failed, so no release was built")
    if not a.no_build:
        print("Building the frontend ...", flush=True)
        subprocess.run("npm run build", cwd=root / "frontend", shell=True, check=True)
    out_dir = a.out if a.out.is_absolute() else root / a.out
    target = build_release(root, out_dir, version, extra_files={"VERSION.txt": version_text(root, version).encode("utf-8")})
    digest = write_checksum(target)
    tagged = commit_and_tag(root, version) if new_release else False
    with zipfile.ZipFile(target) as z:
        n = len(z.namelist())
    print(f"\n{target}  ({target.stat().st_size / 1e6:.1f} MB, {n} files)")
    print(f"version {version}   sha256 {digest}")
    if tagged:
        print(f"Committed and tagged v{version}. Push it with:  git push --follow-tags")


if __name__ == "__main__":
    main()
