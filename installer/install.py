"""Accio Studio installer (APP_SPEC section 11.2). Idempotent: re-running resumes and skips finished steps.

Called by Install.bat after it has bootstrapped uv and the project venv. Stdlib only. Installs the bundled,
portable ComfyUI into <app>\\comfyui\\ and never touches any other ComfyUI install. It does not download models: the
app does (Settings > Models; the logic is in installer/modelfiles.py).

Options:
  --yes                   never prompt; GPU warnings are accepted, other questions take their defaults
  --portable-node         force the portable Node download even if npm exists (testing)
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
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from core import ROOT, curl_download, extract_zip, fmt_size, free_space, install_path_problem, load_manifest, sha256_of  # noqa: E402
from modelfiles import make_lora_folders  # noqa: E402

BIN = ROOT / "bin"
DATA = ROOT / "data"
COMFY_HOME = ROOT / "comfyui"  # flat layout: comfyui\ComfyUI and comfyui\python_embeded
LEGACY_HOME = COMFY_HOME / "ComfyUI_windows_portable"  # nested layout of the first builds; still used when that is what is installed
STATE_FILE = DATA / "install.json"
OK, FAIL = [], []  # summary


def comfy_base() -> Path:
    """The folder holding the ComfyUI and python_embeded folders: comfyui, or the old nested one when only that exists."""
    if not (COMFY_HOME / "python_embeded" / "python.exe").is_file() and (LEGACY_HOME / "python_embeded" / "python.exe").is_file():
        return LEGACY_HOME
    return COMFY_HOME


def comfy_dir() -> Path:
    return comfy_base() / "ComfyUI"


def py() -> Path:
    return comfy_base() / "python_embeded" / "python.exe"


def say(msg: str = "") -> None:
    print(msg, flush=True)


def step(title: str) -> None:
    say(f"\n-------- {title} --------")


def ask(prompt: str, default: str = "", *, interactive: bool = True) -> str:
    if not interactive:
        return default
    try:
        return input(prompt).strip() or default
    except EOFError:
        return default


def load_state() -> dict:
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save_state(state: dict) -> None:
    DATA.mkdir(exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")


def remote_size(url: str) -> int | None:
    """Size of the file at `url`, or None when it cannot be reached (any final HTTP status but 200, e.g. a mirror without the file)."""
    out = subprocess.run(
        ["curl.exe", "-sIL", "--ssl-no-revoke", "-m", "60", "-w", "\nFINAL_HTTP_STATUS:%{http_code}\n", url], capture_output=True, text=True
    ).stdout
    if "FINAL_HTTP_STATUS:200" not in out:
        return None
    sizes = [int(m.group(1)) for m in re.finditer(r"(?im)^content-length:\s*(\d+)", out)]
    return sizes[-1] if sizes and sizes[-1] > 0 else None


# --------------------------------------------------------------------------- 1. tools

def ensure_7zr(manifest: dict) -> Path:
    exe = BIN / "7zr.exe"
    spec = manifest["tools"]["7zr"]
    if exe.is_file() and exe.stat().st_size >= spec["min_size"]:
        return exe
    BIN.mkdir(exist_ok=True)
    for url in spec["urls"]:
        try:
            say(f"  downloading 7zr.exe from {url.split('/')[2]} ...")
            curl_download(url, exe)
            if exe.stat().st_size >= spec["min_size"]:
                return exe
        except (RuntimeError, OSError) as e:
            say(f"  [!] {e}")
    raise RuntimeError("could not download 7zr.exe")


# --------------------------------------------------------------------------- 2. GPU

def detect_gpu() -> dict:
    gpu: dict = {}
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,compute_cap,memory.total,driver_version", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=30,
        ).stdout.strip().splitlines()
        if out:
            name, cc, vram, driver = [x.strip() for x in out[0].split(",")]
            gpu = {"vendor": "nvidia", "name": name, "compute": cc, "vram_mb": int(float(vram)), "driver": driver}
    except (OSError, ValueError, subprocess.SubprocessError):
        pass
    if not gpu:
        try:
            names = subprocess.run(
                ["powershell", "-NoProfile", "-Command", "(Get-CimInstance Win32_VideoController).Name -join '; '"],
                capture_output=True, text=True, timeout=60,
            ).stdout.strip()
        except (OSError, subprocess.SubprocessError):
            names = ""
        low = names.lower()
        vendor = "nvidia" if "nvidia" in low else "amd" if ("radeon" in low or "amd" in low) else "intel" if "intel" in low else "unknown"
        gpu = {"vendor": vendor, "name": names or "unknown"}
    return gpu


# Oldest Nvidia driver each portable build works with (NVIDIA's CUDA toolkit release notes, "minor version compatibility"):
# the default build ships CUDA 13 (driver 580 or newer), the _cu126 build CUDA 12.x (driver 525 or newer).
MIN_DRIVER = {"nvidia": 580, "nvidia_cu126": 525}
DRIVER_HELP = "Update the Nvidia driver (nvidia.com/drivers, or GeForce Experience), then run Install.bat again."


def driver_major(gpu: dict) -> int | None:
    try:
        return int(str(gpu.get("driver", "")).split(".")[0])
    except ValueError:
        return None


def build_for_driver(build: str, gpu: dict) -> str:
    """Make sure the Nvidia build can run on the installed driver. A driver too old for the CUDA 13 build but fine for the
    CUDA 12.6 build gets that one; RTX 50 series cards (compute 12.0) need CUDA 12.8 or newer, so for them only an update helps."""
    drv, need = driver_major(gpu), MIN_DRIVER.get(build)
    if drv is None or need is None or drv >= need:
        return build
    compute = float(gpu.get("compute") or 0)
    if build == "nvidia" and compute < 12.0 and drv >= MIN_DRIVER["nvidia_cu126"]:
        say(f"  [!] Your Nvidia driver ({gpu['driver']}) is older than the {need} the newest engine needs, so the CUDA 12.6 engine is installed\n"
            "      instead. It works with this driver. Update the driver and reinstall later if you want the newest engine.")
        return "nvidia_cu126"
    floor = MIN_DRIVER["nvidia_cu126"] if build == "nvidia" and compute < 12.0 else need
    raise RuntimeError(f"Your Nvidia driver ({gpu['driver']}) is too old for this graphics card: it needs {floor} or newer. {DRIVER_HELP}")


def warn_if_driver_too_old(build: str, gpu: dict) -> None:
    drv, need = driver_major(gpu), MIN_DRIVER.get(build)
    if drv is not None and need is not None and drv < need:
        say(f"  [!] The installed engine needs Nvidia driver {need} or newer, but this PC has {gpu['driver']}. {DRIVER_HELP}")


def choose_build(gpu: dict, interactive: bool) -> tuple[str, str]:
    """Returns (comfy build name, launch flags)."""
    flags = ""
    if gpu["vendor"] == "nvidia" and "compute" in gpu:
        say(f"  Nvidia: {gpu['name']} / compute {gpu['compute']} / {gpu['vram_mb']} MB VRAM / driver {gpu['driver']}")
        major, minor = (int(x) for x in gpu["compute"].split("."))
        build = build_for_driver("nvidia" if major * 10 + minor >= 75 else "nvidia_cu126", gpu)
        if gpu["vram_mb"] <= 8300:
            flags = "--disable-cuda-malloc --reserve-vram 1"
        if gpu["vram_mb"] < 6000:
            say("\n  [NOTE] Accio Studio is built for graphics cards with 6 GB of VRAM or more. With less it may run very slowly\n"
                "         or run out of memory. Installing continues anyway.\n")
    else:
        say(f"  Detected: {gpu['name']}")
        build = {"nvidia": "nvidia", "amd": "amd", "intel": "intel"}.get(gpu["vendor"], "")
        if not build:
            if not interactive:
                raise RuntimeError("could not detect the graphics card; run Install.bat interactively to choose")
            say("  Could not detect your graphics card.\n    1 = Nvidia RTX 20 series or newer\n    2 = Nvidia GTX 10 series or older\n    3 = AMD\n    4 = Intel")
            build = {"1": "nvidia", "2": "nvidia_cu126", "3": "amd", "4": "intel"}.get(ask("  Choose [1-4]: ", "", interactive=True), "")
            if not build:
                raise RuntimeError("no graphics card chosen")
    say(f"  ComfyUI build: {build}" + (f"   launch flags: {flags}" if flags else ""))
    if build != "nvidia":
        say("\n  [NOTE] The Krea 2 and Qwen 2.1 int8 models and these workflows were only tested on an Nvidia RTX 20 series\n"
            "         or newer. On this graphics card they may run slowly or not run at all.")
        if ask("  Continue installing? [y/N]: ", "n" if interactive else "y", interactive=interactive).lower() != "y":
            raise RuntimeError("stopped by user")
    return build, flags


def read_build_flags(build: str, package: Path) -> str:
    """AMD/Intel builds ship their own launcher in the extracted package; reuse its flags."""
    for name in ("run_amd_gpu.bat", "run_intel_gpu.bat"):
        if (build == "intel") == ("intel" in name):
            bat = package / name
            if bat.is_file():
                m = re.search(r"main\.py\s+(.*)", bat.read_text(encoding="utf-8", errors="replace"))
                if m:
                    return re.sub(r"--windows-standalone-build\s*", "", m.group(1)).replace("%*", "").strip()
    return ""


# --------------------------------------------------------------------------- 3. ComfyUI

def installed_comfy_version() -> str | None:
    f = comfy_dir() / "comfyui_version.py"
    if not f.is_file():
        return None
    m = re.search(r'__version__\s*=\s*"([^"]+)"', f.read_text(encoding="utf-8"))
    return m.group(1) if m else None


def flatten_portable(extracted: Path, home: Path, build: str) -> str:
    """Move the ComfyUI and python_embeded folders out of the extracted portable package into `home`, drop everything else in it
    (update scripts, run_*.bat, README, the advanced folder) and the extraction folder. Returns the launch flags the AMD/Intel
    package carries in its run_*.bat ("" otherwise): they are read here, before that file is deleted."""
    tops = [p for p in extracted.iterdir() if p.is_dir() and (p / "python_embeded").is_dir() and (p / "ComfyUI").is_dir()]
    if len(tops) != 1:
        raise RuntimeError("unexpected ComfyUI archive layout")
    package = tops[0]
    flags = read_build_flags(build, package)
    for name in ("python_embeded", "ComfyUI"):  # ComfyUI last: its version file is what marks the install as finished
        if (home / name).exists():
            raise RuntimeError(f"{home / name} already exists")
        shutil.move(str(package / name), str(home / name))
    shutil.rmtree(extracted, ignore_errors=True)
    return flags


def archive_ok(path: Path, spec: dict) -> bool:
    return path.is_file() and path.stat().st_size == spec["size"] and sha256_of(path) == spec["sha256"]


def download_comfyui(c: dict, build: str, spec: dict, archive: Path) -> None:
    """Download the portable package, from our own mirror first and the upstream release second. Every source is checked
    against the size and sha256 recorded in the manifest, so a wrong or truncated file is never unpacked."""
    if free_space(COMFY_HOME) < spec["size"] * 4:  # archive + unpacked
        raise RuntimeError(f"not enough free disk space (need about {fmt_size(spec['size'] * 4)})")
    for key in ("mirror_url", "release_url"):
        if not c.get(key):
            continue
        url = c[key].format(tag=c["tag"], build=build)
        host = url.split("/")[2]
        if remote_size(url) != spec["size"]:
            say(f"  {host} does not have the expected file; trying the next source.")
            continue
        say(f"  downloading ComfyUI {c['version']} ({build}, {fmt_size(spec['size'])}) from {host} ...")
        try:
            curl_download(url, archive, expected_size=spec["size"])
        except RuntimeError as e:
            say(f"  [!] {e}")
            continue
        if sha256_of(archive) == spec["sha256"]:
            return
        say("  [!] the downloaded file failed its checksum; discarding it.")
        archive.unlink(missing_ok=True)
    raise RuntimeError("could not download ComfyUI from any source (see the messages above); check the connection and run Install.bat again")


UPGRADE_DIR = "_old"  # where an upgrade parks the previous install until the user's files are carried over
CARRY = ("models", "input", "output", "user", "custom_nodes", "extra_model_paths.yaml")  # what lives in ComfyUI\ and is the user's


def version_key(v: str) -> tuple[int, ...]:
    return tuple(int(x) for x in re.findall(r"\d+", v))


def replace_path(src: Path, dest: Path) -> None:
    """Rename `src` over `dest` (same volume), removing what is at `dest` first."""
    if dest.is_dir() and not dest.is_symlink():
        shutil.rmtree(dest)
    elif dest.exists() or dest.is_symlink():
        dest.unlink()
    os.replace(src, dest)


def finish_upgrade(old: Path) -> None:
    """Carry the user's folders from the parked old ComfyUI into the new one, then drop the old install. Every move is a
    rename on one volume (instant, junctions keep working) and is skipped when already done, so an interrupted run resumes."""
    src, dst = old / "ComfyUI", COMFY_HOME / "ComfyUI"
    for name in CARRY:
        s = src / name
        if not s.exists():
            continue
        if name == "custom_nodes" and (dst / name).is_dir():  # the new package ships a few files of its own: keep both
            for child in s.iterdir():
                replace_path(child, dst / name / child.name)
            s.rmdir()
        else:
            replace_path(s, dst / name)
    # The new portable Python has none of the packs' pip dependencies yet: have install_nodes run pip again.
    for marker in (dst / "custom_nodes").glob("*/.accio_reqs_ok"):
        marker.unlink()
    shutil.rmtree(old, ignore_errors=True)
    if LEGACY_HOME.is_dir() and not (LEGACY_HOME / "ComfyUI").exists():
        shutil.rmtree(LEGACY_HOME, ignore_errors=True)  # the emptied nested layout of the first builds


def upgrade_comfyui(manifest: dict, build: str, sevenzip: Path, have: str | None) -> str:
    """Replace an installed ComfyUI of another version with the manifest's, keeping models, outputs, inputs, user settings,
    custom nodes and extra_model_paths.yaml. The new package is downloaded and unpacked before the old install is touched, and
    the old one stays parked in comfyui\\_old (with the user's folders) until they are carried over. Returns the launch flags."""
    c = manifest["comfyui"]
    want = c["version"]
    old = COMFY_HOME / UPGRADE_DIR
    if have and not old.exists() and version_key(have) > version_key(want):
        raise RuntimeError(f"{COMFY_HOME} holds ComfyUI {have}, which is newer than the {want} this Accio needs. It is not replaced: update Accio instead.")
    flags = ""
    if not (old.exists() and have == want and py().is_file()):  # not finished by an earlier run
        spec = c.get("archives", {}).get(build)
        if not spec:
            raise RuntimeError(f"no ComfyUI package is listed for the '{build}' build")
        archive = COMFY_HOME / f"ComfyUI_windows_portable_{build}.7z"
        if not archive_ok(archive, spec):
            archive.unlink(missing_ok=True)
            download_comfyui(c, build, spec, archive)
        say(f"  upgrading ComfyUI {have or 'unknown'} -> {want}: extracting (a few minutes) ...")
        extracted = COMFY_HOME / "_extract"
        shutil.rmtree(extracted, ignore_errors=True)
        r = subprocess.run([str(sevenzip), "x", "-aoa", f"-o{extracted}", str(archive)], capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError(f"extraction failed: {(r.stdout + r.stderr)[-300:]}")
        # Only now park the old install. ComfyUI goes first: once old\ComfyUI exists the user's files are safe there.
        first = not (old / "ComfyUI").exists()
        src = comfy_base()  # where the install being replaced sits, decided before anything moves
        old.mkdir(exist_ok=True)
        if first and src != COMFY_HOME:  # folders at the top beside a nested install are not part of it and not ours to delete
            for name in ("ComfyUI", "python_embeded"):
                if (COMFY_HOME / name).exists():
                    os.replace(COMFY_HOME / name, COMFY_HOME / f"{name}_unused_before_upgrade")
        for name in ("ComfyUI", "python_embeded"):
            if (src / name).exists() and not (old / name).exists():
                os.replace(src / name, old / name)
        if not (old / "ComfyUI").is_dir():
            raise RuntimeError("could not find the old ComfyUI folder to carry over; nothing was replaced")
        for name in ("python_embeded", "ComfyUI"):  # what is left at the top is a half-finished new install from an earlier run
            if (COMFY_HOME / name).exists():
                shutil.rmtree(COMFY_HOME / name)
        flags = flatten_portable(extracted, COMFY_HOME, build)
        archive.unlink(missing_ok=True)
        got = installed_comfy_version()
        if got != want or not py().is_file():
            raise RuntimeError(f"installed ComfyUI reports version {got}, expected {want}")
    finish_upgrade(old)
    say(f"  ComfyUI {want} installed; models, outputs and custom nodes were kept.")
    return flags


def install_comfyui(manifest: dict, build: str, sevenzip: Path) -> str:
    """Installs the bundled ComfyUI. Returns the AMD/Intel launch flags ("" when there are none or nothing was installed)."""
    want = manifest["comfyui"]["version"]
    have = installed_comfy_version()
    extracted = COMFY_HOME / "_extract"
    if (COMFY_HOME / UPGRADE_DIR).exists() or (have and have != want):
        return upgrade_comfyui(manifest, build, sevenzip, have)
    if have == want and py().is_file():
        say(f"  ComfyUI {have} already installed.")
        shutil.rmtree(extracted, ignore_errors=True)  # left behind if an earlier run stopped right at the end
        return ""
    existing = [p for p in (COMFY_HOME / "ComfyUI", COMFY_HOME / "python_embeded", LEGACY_HOME) if p.exists()]
    if existing and extracted.exists():
        # An earlier run stopped while unpacking or moving. Nothing of value is in there yet (models come later): start clean.
        for p in existing:
            shutil.rmtree(p, ignore_errors=True)
    elif existing:
        raise RuntimeError(
            f"{COMFY_HOME} holds ComfyUI {have or 'unknown/incomplete'}, not {want}. "
            "Delete the 'comfyui' folder to reinstall (models stored there would be removed)."
        )
    spec = manifest["comfyui"].get("archives", {}).get(build)
    if not spec:
        raise RuntimeError(f"no ComfyUI package is listed for the '{build}' build")
    archive = COMFY_HOME / f"ComfyUI_windows_portable_{build}.7z"
    if not archive_ok(archive, spec):  # a finished download is only kept when its size and checksum match
        archive.unlink(missing_ok=True)
        download_comfyui(manifest["comfyui"], build, spec, archive)
    say("  extracting (a few minutes) ...")
    shutil.rmtree(extracted, ignore_errors=True)
    r = subprocess.run([str(sevenzip), "x", "-aoa", f"-o{extracted}", str(archive)], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"extraction failed: {(r.stdout + r.stderr)[-300:]}")
    flags = flatten_portable(extracted, COMFY_HOME, build)
    archive.unlink(missing_ok=True)
    got = installed_comfy_version()
    if got != want or not py().is_file():
        raise RuntimeError(f"installed ComfyUI reports version {got}, expected {want}")
    say(f"  ComfyUI {got} installed.")
    return flags


# --------------------------------------------------------------------------- 4. custom nodes

def write_pip_constraints() -> Path:
    """Keep the portable build's torch stack fixed while node requirements install."""
    out = subprocess.run([str(py()), "-m", "pip", "list", "--format=freeze"], capture_output=True, text=True).stdout
    keep = [l for l in out.splitlines() if re.match(r"(?i)(torch|torchvision|torchaudio)==", l)]
    path = DATA / "pip-constraints.txt"
    DATA.mkdir(exist_ok=True)
    path.write_text("\n".join(keep) + "\n", encoding="utf-8")
    return path


def fetch_node(manifest: dict, n: dict, zip_path: Path) -> None:
    """Download one pinned node pack: from our mirror first (checked against the size and sha256 in the manifest), then from
    the author's GitHub at the pinned commit. GitHub's archives are not byte-stable, so only the mirror copy has a checksum."""
    sources = []
    if manifest.get("nodes_mirror_url") and n.get("sha256"):
        sources.append((manifest["nodes_mirror_url"].format(name=n["name"], commit=n["commit"]), n))
    sources.append((f"https://github.com/{n['repo']}/archive/{n['commit']}.zip", None))
    for url, checked in sources:
        host = url.split("/")[2]
        if checked and remote_size(url) != checked["size"]:
            say(f"    {host} does not have {n['name']}; trying the next source.")
            continue
        try:
            curl_download(url, zip_path, expected_size=checked["size"] if checked else None)
        except RuntimeError as e:
            say(f"    [!] {host}: {e}")
            continue
        if checked and sha256_of(zip_path) != checked["sha256"]:
            say(f"    [!] {n['name']} from {host} failed its checksum; discarding it.")
            zip_path.unlink(missing_ok=True)
            continue
        return
    raise RuntimeError(f"could not download {n['name']} from any source")


def install_nodes(manifest: dict) -> None:
    nodes_dir = comfy_dir() / "custom_nodes"
    constraints = write_pip_constraints()
    cache = DATA / "cache"
    for n in manifest["nodes"]:
        dest, marker = nodes_dir / n["name"], nodes_dir / n["name"] / ".accio_pin"
        if not (marker.is_file() and marker.read_text().strip() == n["commit"]):
            say(f"  {n['name']} @ {n['commit'][:10]}")
            if dest.exists():
                shutil.rmtree(dest)  # unpinned leftovers inside the bundled install only
            zip_path = cache / f"{n['name']}-{n['commit']}.zip"
            fetch_node(manifest, n, zip_path)
            tmp = cache / f"x-{n['name']}"
            shutil.rmtree(tmp, ignore_errors=True)
            extract_zip(zip_path, tmp)
            inner = [p for p in tmp.iterdir() if p.is_dir()]
            if len(inner) != 1:
                raise RuntimeError(f"unexpected archive layout for {n['name']}")
            shutil.move(str(inner[0]), str(dest))
            shutil.rmtree(tmp, ignore_errors=True)
            marker.write_text(n["commit"] + "\n", encoding="utf-8")
            zip_path.unlink(missing_ok=True)
        else:
            say(f"  {n['name']} already pinned.")
        req, req_ok = dest / "requirements.txt", dest / ".accio_reqs_ok"
        if req.is_file() and not req_ok.is_file():
            say(f"    installing requirements for {n['name']} ...")
            r = subprocess.run([str(py()), "-m", "pip", "install", "--no-input", "--no-warn-script-location", "-c", str(constraints), "-r", str(req)])
            if r.returncode != 0:
                raise RuntimeError(f"pip install failed for {n['name']}")
            req_ok.write_text("ok\n", encoding="utf-8")


# --------------------------------------------------------------------------- 7. frontend

def ensure_frontend(force_portable_node: bool) -> None:
    fe = ROOT / "frontend"
    if (fe / "dist" / "index.html").is_file() and not force_portable_node:
        say("  frontend\\dist present (prebuilt).")
        return
    if not (fe / "package.json").is_file():
        raise RuntimeError("frontend\\dist is missing and there is no frontend source to build")
    env = dict(os.environ)
    npm = None if force_portable_node else shutil.which("npm")
    if not npm:
        node_dir = BIN / "node"
        if not (node_dir / "npm.cmd").is_file():
            say("  no Node.js found; downloading portable Node LTS into bin\\node ...")
            idx = subprocess.run(["curl.exe", "-sL", "--ssl-no-revoke", "-m", "60", "https://nodejs.org/dist/index.json"], capture_output=True, text=True).stdout
            ver = next(x["version"] for x in json.loads(idx) if x["lts"])
            zip_path = DATA / "cache" / f"node-{ver}.zip"
            curl_download(f"https://nodejs.org/dist/{ver}/node-{ver}-win-x64.zip", zip_path)
            tmp = DATA / "cache" / "x-node"
            shutil.rmtree(tmp, ignore_errors=True)
            extract_zip(zip_path, tmp)
            shutil.rmtree(node_dir, ignore_errors=True)
            shutil.move(str(next(tmp.iterdir())), str(node_dir))
            shutil.rmtree(tmp, ignore_errors=True)
            zip_path.unlink(missing_ok=True)
        env["PATH"] = str(node_dir) + os.pathsep + env["PATH"]
        npm = str(node_dir / "npm.cmd")
    for args in (["install", "--no-audit", "--no-fund"], ["run", "build"]):
        if subprocess.run([npm, *args], cwd=fe, env=env).returncode != 0:
            raise RuntimeError(f"npm {' '.join(args)} failed")


# --------------------------------------------------------------------------- main

def run_step(name: str, fn) -> bool:
    try:
        fn()
        OK.append(name)
        return True
    except Exception as e:  # noqa: BLE001 - report and continue with what can still be installed
        say(f"\n  [ERROR] {name}: {e}")
        FAIL.append(f"{name}: {e}")
        return False


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--yes", action="store_true")
    ap.add_argument("--portable-node", action="store_true")
    args = ap.parse_args()
    interactive = not args.yes and sys.stdin is not None and sys.stdin.isatty()
    manifest = load_manifest()
    state = load_state()
    ctx: dict = {}

    # pip (used for the custom-node requirements) would otherwise cache wheels in %LOCALAPPDATA%\pip, outside this folder
    os.environ["PIP_CACHE_DIR"] = str(DATA / "cache" / "pip")
    problem = install_path_problem(ROOT)
    if problem:
        say(f"\n[ERROR] {problem}")
        return 1

    step("Portable tools")
    if not run_step("7zr", lambda: ctx.update(sz=ensure_7zr(manifest))):
        return finish(state)

    step("Detecting graphics card")
    def gpu_step():
        gpu = detect_gpu()
        build, flags = choose_build(gpu, interactive)
        if installed_comfy_version() and state.get("build"):
            build = state["build"]  # keep the build that is actually installed
            warn_if_driver_too_old(build, gpu)
            if build in ("amd", "intel") and state.get("launch_flags"):
                flags = state["launch_flags"]  # read from the package when it was installed; the file is gone now
        state.update(gpu=gpu, build=build, launch_flags=flags)
        ctx["build"] = build
    if not run_step("GPU detection", gpu_step):
        return finish(state)

    step(f"ComfyUI {manifest['comfyui']['version']} (bundled, portable)")
    if not run_step("ComfyUI", lambda: ctx.update(package_flags=install_comfyui(manifest, ctx["build"], ctx["sz"]))):
        return finish(state)
    if ctx["package_flags"] and state["build"] in ("amd", "intel"):
        state["launch_flags"] = ctx["package_flags"]
    state["comfyui_version"] = installed_comfy_version()
    save_state(state)

    step("Custom nodes (pinned)")
    run_step("Custom nodes", lambda: install_nodes(manifest))
    state["nodes"] = {n["name"]: n["commit"] for n in manifest["nodes"]}
    save_state(state)

    step("Models")
    run_step("Model folders", lambda: make_lora_folders(comfy_dir() / "models"))
    say("  The installer does not download models. Start Accio, then open Settings > Models to download them.")

    step("Accio server")
    say("  Python environment and requirements: done by Install.bat (env\\).")
    step("Frontend")
    run_step("Frontend", lambda: ensure_frontend(args.portable_node))
    return finish(state)


def finish(state: dict) -> int:
    state["finished_at"] = time.strftime("%Y-%m-%d %H:%M:%S")
    if FAIL:
        state["last_failures"] = FAIL
    else:
        state.pop("last_failures", None)
    save_state(state)
    say("\n==========================================")
    say("Summary")
    for o in OK:
        say(f"  OK     {o}")
    for f in FAIL:
        say(f"  FAILED {f}")
    say("==========================================")
    say("Done. Start with Run_Accio.bat." if not FAIL else "Some steps failed. Fix the cause (network, disk space) and run Install.bat again: finished steps are skipped.")
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
