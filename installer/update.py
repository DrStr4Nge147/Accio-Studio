"""Accio Studio updater. Started by Update.bat, or by the Settings page on the PC itself.

Finds the newest release on GitHub, downloads its zip, checks the SHA-256, stops Accio, backs up the old app files, swaps in
the new ones and runs Install.bat for anything new (Python packages, node packs). Stdlib only.

It replaces only the app itself: server\\, installer\\, frontend\\dist\\, scripts\\, the .bat files, README.md, LICENSE,
requirements.txt and VERSION.txt. It never touches data\\ (history, password), settings.json, env\\, bin\\, comfyui\\ (engine and
models) or anything else. A release that also changes the ComfyUI version is refused: that needs the full zip.

Options:
  --check          only report whether an update is available (exit code 10 = yes, 0 = no, 1 = could not check)
  --yes            do not ask before updating
  --force          reinstall the newest release even if it is not newer
  --zip FILE       update from a zip you already have (needs FILE.sha256 next to it); no network
  --no-stop        do not stop a running Accio first (testing)
  --no-install     do not run Install.bat afterwards (testing)
  --api-url URL    where to look for the newest release (default: manifest.json > updates.api_url, or ACCIO_UPDATE_API)
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from core import ROOT, curl_download, fmt_size, free_space, load_manifest, sha256_of  # noqa: E402

TOP = "AccioStudio"  # the one folder inside every release zip
REPLACE_DIRS = ["server", "installer", "frontend/dist", "scripts"]
REPLACE_FILES = ["README.md", "LICENSE", "requirements.txt", "VERSION.txt"]  # plus every top-level .bat
MUST_CONTAIN = ["VERSION.txt", "Install.bat", "Update.bat", "server/main.py", "installer/update.py", "frontend/dist/index.html"]
ASSET_RE = re.compile(r"^AccioStudio-(\d+\.\d+\.\d+)\.zip$")
KEEP_BACKUPS = 3
FORBIDDEN_SUFFIXES = {".safetensors", ".gguf", ".ckpt", ".pt", ".pth", ".onnx", ".exe", ".dll", ".7z", ".env"}
FORBIDDEN_NAMES = {"settings.json", "install.json", "history.db", "sessions.json", ".zrok_share", "extra_model_paths.yaml"}


class UpdateError(Exception):
    """A problem to show the user as it is; nothing has been changed when this is raised before 'Stopping Accio'."""


def say(msg: str = "") -> None:
    print(msg, flush=True)


# --------------------------------------------------------------------------- versions

def version_key(v: str) -> tuple[int, int, int] | None:
    m = re.fullmatch(r"v?(\d+)\.(\d+)\.(\d+)", v.strip())
    return tuple(int(x) for x in m.groups()) if m else None  # type: ignore[return-value]


def is_newer(latest: str, current: str) -> bool:
    a, b = version_key(latest), version_key(current)
    return a is not None and b is not None and a > b


def installed_version(root: Path = ROOT) -> str:
    """From VERSION.txt (shipped in every release); a source checkout falls back to frontend/package.json."""
    try:
        m = re.match(r"Accio Studio (\d+\.\d+\.\d+)", (root / "VERSION.txt").read_text(encoding="utf-8"))
        if m:
            return m.group(1)
    except OSError:
        pass
    try:
        return json.loads((root / "frontend" / "package.json").read_text(encoding="utf-8"))["version"]
    except (OSError, ValueError, KeyError):
        return "0.0.0"


# --------------------------------------------------------------------------- finding the newest release

def default_api_url() -> str:
    return os.environ.get("ACCIO_UPDATE_API") or load_manifest().get("updates", {}).get("api_url", "")


def _get(url: str, timeout: int = 15) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "AccioStudio-updater", "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310 - https URL from our manifest
        return r.read()


def parse_release(data: dict) -> dict:
    """The newest release from a GitHub 'latest release' answer: version, zip url/name/size and the expected SHA-256."""
    version = str(data.get("tag_name", "")).lstrip("v")
    if not version_key(version):
        raise UpdateError(f"the newest release has an unusable version ({data.get('tag_name')!r})")
    assets = data.get("assets") or []
    zip_asset = next((a for a in assets if ASSET_RE.match(a.get("name", "")) and ASSET_RE.match(a["name"]).group(1) == version), None)
    if not zip_asset:
        raise UpdateError(f"release v{version} has no AccioStudio-{version}.zip file attached")
    sha = None
    digest = str(zip_asset.get("digest") or "")
    if digest.startswith("sha256:"):
        sha = digest.split(":", 1)[1].lower()
    sidecar = next((a for a in assets if a.get("name") == zip_asset["name"] + ".sha256"), None)
    return {
        "version": version,
        "zip_name": zip_asset["name"],
        "zip_url": zip_asset["browser_download_url"],
        "size": int(zip_asset.get("size") or 0) or None,
        "sha256": sha,
        "sha_url": sidecar["browser_download_url"] if sidecar else None,
        "notes_url": data.get("html_url"),
    }


def fetch_latest(api_url: str | None = None) -> dict:
    url = api_url or default_api_url()
    if not url:
        raise UpdateError("no update address is configured")
    try:
        answer = json.loads(_get(url))
    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise UpdateError("no release has been published yet, so there is nothing to update to") from None
        raise UpdateError(f"GitHub answered with an error ({e.code}); try again later") from None
    info = parse_release(answer)
    if not info["sha256"] and info["sha_url"]:  # "<hash> *<file>" next to the zip
        m = re.match(r"([0-9a-fA-F]{64})", _get(info["sha_url"]).decode("utf-8", "ignore").strip())
        info["sha256"] = m.group(1).lower() if m else None
    if not info["sha256"]:
        raise UpdateError(f"release v{info['version']} has no SHA-256 to check the download against, so it will not be installed")
    return info


# --------------------------------------------------------------------------- the zip

def clean_member(name: str) -> str | None:
    """The path of a zip member inside the AccioStudio folder, or None for the folder itself. Raises on anything unsafe."""
    parts = name.replace("\\", "/").split("/")
    if parts[0] != TOP:
        raise UpdateError(f"unexpected entry in the update: {name}")
    rel = parts[1:]
    if rel and rel[-1] == "":  # a folder entry ends with a slash
        rel = rel[:-1]
    if not rel:
        return None
    if any(p in ("", ".", "..") or ":" in p for p in rel):
        raise UpdateError(f"unsafe path in the update: {name}")
    return "/".join(rel)


def allowed(rel: str) -> bool:
    if rel in REPLACE_FILES:
        return True
    if "/" not in rel:
        return rel.lower().endswith(".bat")
    return any(rel == d or rel.startswith(d + "/") for d in REPLACE_DIRS)


def extract_release(zip_path: Path, dest: Path) -> list[str]:
    """Unpack a release zip into `dest` after checking every entry. Returns the relative paths written."""
    written: list[str] = []
    with zipfile.ZipFile(zip_path) as z:
        if z.testzip():
            raise UpdateError("the downloaded zip is damaged")
        plan = []
        for info in z.infolist():
            rel = clean_member(info.filename)
            if rel is None or info.is_dir():
                continue
            p = Path(rel)
            if not allowed(rel):
                raise UpdateError(f"the update contains something it may not replace: {rel}")
            if p.suffix.lower() in FORBIDDEN_SUFFIXES or p.name in FORBIDDEN_NAMES:
                raise UpdateError(f"the update contains a file that must never ship: {rel}")
            plan.append((info, rel))
        missing = [m for m in MUST_CONTAIN if m not in {r for _, r in plan}]
        if missing:
            raise UpdateError("the update is incomplete, missing: " + ", ".join(missing))
        shutil.rmtree(dest, ignore_errors=True)
        for info, rel in plan:
            target = dest / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(z.read(info))
            written.append(rel)
    return written


# --------------------------------------------------------------------------- applying

def top_level_bats(folder: Path) -> list[str]:
    return sorted(p.name for p in folder.glob("*.bat") if p.is_file())


def backup_current(root: Path, version: str) -> Path:
    stamp = time.strftime("%Y%m%d-%H%M%S")
    dest = root / "data" / "backup" / f"{version}-{stamp}"
    for d in REPLACE_DIRS:
        if (root / d).is_dir():
            shutil.copytree(root / d, dest / d, ignore=shutil.ignore_patterns("__pycache__"))
    for f in REPLACE_FILES + top_level_bats(root):
        if (root / f).is_file():
            (dest / f).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(root / f, dest / f)
    old = sorted((root / "data" / "backup").glob("*"), key=lambda p: p.stat().st_mtime, reverse=True)
    for stale in old[KEEP_BACKUPS:]:
        shutil.rmtree(stale, ignore_errors=True)
    return dest


def apply_release(root: Path, new: Path) -> None:
    """Swap the app files for the ones in `new`. Each folder is moved aside first, so a failure puts everything back."""
    moved: list[tuple[Path, Path]] = []
    try:
        for d in REPLACE_DIRS:
            src, dst = new / d, root / d
            if not src.is_dir():
                continue
            aside = dst.with_name(dst.name + ".replaced")
            shutil.rmtree(aside, ignore_errors=True)
            if dst.exists():
                dst.rename(aside)
                moved.append((dst, aside))
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(src, dst)
        for f in REPLACE_FILES:
            if (new / f).is_file():
                shutil.copy2(new / f, root / f)
        for bat in top_level_bats(new):  # last: a running batch file must not be disturbed before the rest is in place
            shutil.copy2(new / bat, root / bat)
    except Exception:
        for dst, aside in reversed(moved):
            shutil.rmtree(dst, ignore_errors=True)
            aside.rename(dst)
        raise
    for _, aside in moved:
        shutil.rmtree(aside, ignore_errors=True)


def restore_backup(root: Path, backup: Path) -> None:
    """Second line of defence after a failed swap: put back any app file or folder that is missing or was overwritten.
    (apply_release already moves the replaced folders back, so folders that are present are left alone.)"""
    for d in REPLACE_DIRS:
        if (backup / d).is_dir() and not (root / d).is_dir():
            shutil.copytree(backup / d, root / d)
    for f in REPLACE_FILES + top_level_bats(backup):
        if (backup / f).is_file():
            shutil.copy2(backup / f, root / f)


def engine_version(manifest_path: Path) -> str | None:
    try:
        return json.loads(manifest_path.read_text(encoding="utf-8"))["comfyui"]["version"]
    except (OSError, ValueError, KeyError):
        return None


STOP_SCRIPT = r"""
$root = $env:ACCIO_ROOT.TrimEnd('\') + '\'
$all = Get-CimInstance Win32_Process
$self = [int]$env:ACCIO_SELF_PID
$keep = @{ $self = 1 }
$me = $all | Where-Object { $_.ProcessId -eq $self } | Select-Object -First 1
if ($me) { $par = $all | Where-Object { $_.ProcessId -eq $me.ParentProcessId } | Select-Object -First 1
  if ($par -and $par.ExecutablePath -and $par.ExecutablePath.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { $keep[[int]$par.ProcessId] = 1 } }
$n = 0
foreach ($p in $all) {
  if ($p.ProcessId -ne $PID -and -not $keep.ContainsKey([int]$p.ProcessId) -and $p.ExecutablePath -and $p.ExecutablePath.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
    Write-Host ('  stopping ' + $p.Name + ' (PID ' + $p.ProcessId + ')'); Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue; $n++ } }
if ($n -eq 0) { Write-Host '  nothing was running.' }
Start-Sleep -Seconds 2
"""


def stop_accio(root: Path) -> None:
    """Stop every process that runs from this folder (the server, the engine, tunnels), except this updater."""
    env = dict(os.environ, ACCIO_ROOT=str(root), ACCIO_SELF_PID=str(os.getpid()))
    subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", STOP_SCRIPT], env=env, check=False)


def run_installer(root: Path) -> bool:
    """Install.bat resumes and skips what is finished: it picks up new Python packages, node packs and models the release needs."""
    # ".\Install.bat", not "Install.bat": with NoDefaultCurrentDirectoryInExePath=1 (a Windows hardening setting some PCs have)
    # cmd does not look in the current folder for a bare name.
    return subprocess.run(["cmd", "/c", ".\\Install.bat", "nopause"], cwd=root).returncode == 0


# --------------------------------------------------------------------------- the whole update

def update(root: Path, *, check: bool = False, yes: bool = False, force: bool = False, zip_file: Path | None = None,
           api_url: str | None = None, stop: bool = True, install: bool = True, ask=input) -> int:
    current = installed_version(root)
    if zip_file:
        sha_file = zip_file.with_name(zip_file.name + ".sha256")
        m = re.match(r"([0-9a-fA-F]{64})", sha_file.read_text(encoding="utf-8").strip()) if sha_file.is_file() else None
        name = ASSET_RE.match(zip_file.name)
        if not m or not name:
            raise UpdateError(f"{zip_file.name}: needs to be named AccioStudio-X.Y.Z.zip with its .sha256 file next to it")
        latest = {"version": name.group(1), "sha256": m.group(1).lower(), "size": None, "zip_name": zip_file.name}
    else:
        say("Looking for the newest release ...")
        latest = fetch_latest(api_url)
    say(f"Installed: {current}    Newest: {latest['version']}")
    newer = is_newer(latest["version"], current)
    if check:
        say("An update is available." if newer else "You are up to date.")
        return 10 if newer else 0
    if not newer and not force:
        say("Already up to date." if latest["version"] == current else f"The newest release ({latest['version']}) is older than this one; nothing to do.")
        return 0
    if free_space(root) < 500_000_000:
        raise UpdateError("not enough free disk space (about 500 MB needed)")
    if not yes and ask(f"\nUpdate {current} -> {latest['version']}? Accio will be stopped. [Y/n]: ").strip().lower() in ("n", "no"):
        say("Cancelled. Nothing was changed.")
        return 0

    work = root / "data" / "update"
    work.mkdir(parents=True, exist_ok=True)
    if zip_file:
        archive = zip_file
    else:
        archive = work / latest["zip_name"]
        archive.unlink(missing_ok=True)
        say(f"Downloading {latest['zip_name']} ...")
        try:
            curl_download(latest["zip_url"], archive, expected_size=latest["size"])
        except RuntimeError as e:
            raise UpdateError(f"the download failed: {e}") from e
    if sha256_of(archive) != latest["sha256"]:
        if not zip_file:
            archive.unlink(missing_ok=True)
        raise UpdateError("the download does not match its SHA-256, so it was NOT installed (nothing was changed)")
    say("Checksum OK.")
    staged = work / "new"
    extract_release(archive, staged)
    old_engine, new_engine = engine_version(root / "server" / "templates" / "manifest.json"), engine_version(staged / "server" / "templates" / "manifest.json")
    if old_engine and new_engine and old_engine != new_engine:
        shutil.rmtree(staged, ignore_errors=True)
        raise UpdateError(
            f"release {latest['version']} also upgrades the ComfyUI engine ({old_engine} -> {new_engine}). That cannot be done "
            "automatically yet. Download the full zip, back up comfyui\\ComfyUI\\models, and follow the README. Nothing was changed."
        )
    staged_version = installed_version(staged)
    if staged_version != latest["version"]:
        shutil.rmtree(staged, ignore_errors=True)
        raise UpdateError(f"the zip says it is version {staged_version}, not {latest['version']}. Nothing was changed.")

    if stop:
        say("Stopping Accio ...")
        stop_accio(root)
    backup = backup_current(root, current)
    say(f"Backed up the old version to {backup.relative_to(root)}")
    try:
        apply_release(root, staged)
    except Exception as e:  # noqa: BLE001
        say(f"[!] Replacing the files failed ({e}); putting the old version back.")
        restore_backup(root, backup)
        raise UpdateError("the update failed and the old version was restored") from e
    shutil.rmtree(staged, ignore_errors=True)
    if not zip_file:
        archive.unlink(missing_ok=True)
    say(f"\nUpdated to {latest['version']}.")
    if install:
        say("Checking for anything new to install ...\n")
        if not run_installer(root):
            say("\n[!] Install.bat reported a problem. The new files are in place: run Install.bat again to finish.")
            return 2
    say("\nDone. Start Accio again with Run_Accio.bat.")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--yes", action="store_true")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--zip", type=Path)
    ap.add_argument("--api-url")
    ap.add_argument("--no-stop", action="store_true", help="do not stop a running Accio (for testing)")
    ap.add_argument("--no-install", action="store_true", help="do not run Install.bat afterwards (for testing)")
    a = ap.parse_args(argv)
    try:
        return update(ROOT, check=a.check, yes=a.yes, force=a.force, zip_file=a.zip, api_url=a.api_url,
                      stop=not a.no_stop, install=not a.no_install)
    except UpdateError as e:
        say(f"\n[ERROR] {e}")
        return 1
    except (OSError, ValueError) as e:  # network down, bad JSON from the server, and the like
        say(f"\n[ERROR] Could not complete the update ({type(e).__name__}: {e}). Nothing was changed unless a message above says so.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
