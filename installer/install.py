"""Accio Studio installer (APP_SPEC section 11.2). Idempotent: re-running resumes and skips finished steps.

Called by Install.bat after it has bootstrapped uv and the project venv. Stdlib only. Installs the bundled,
portable ComfyUI into <app>\\comfyui\\ and never touches any other ComfyUI install; the only read of another
install is the optional models folder (extra_model_paths.yaml, read-only use).

Options:
  --models-from PATH      reuse models from an existing ComfyUI (its folder or its models folder)
  --optional-loras yes|no|ask   preset LoRAs (Head/Body swap, Remove/Move object); default ask (no when non-interactive)
  --yes                   never prompt; GPU warnings are accepted, other questions take their defaults
  --skip-models           install ComfyUI + nodes only
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
from core import ROOT, curl_download, extract_zip, fmt_size, free_space, load_manifest, verify_safetensors  # noqa: E402

BIN = ROOT / "bin"
DATA = ROOT / "data"
COMFY_HOME = ROOT / "comfyui"
PORTABLE = COMFY_HOME / "ComfyUI_windows_portable"
COMFY = PORTABLE / "ComfyUI"
PY = PORTABLE / "python_embeded" / "python.exe"
STATE_FILE = DATA / "install.json"
OK, FAIL = [], []  # summary


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
    out = subprocess.run(["curl.exe", "-sIL", "--ssl-no-revoke", "-m", "60", url], capture_output=True, text=True).stdout
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


def choose_build(gpu: dict, interactive: bool) -> tuple[str, str]:
    """Returns (comfy build name, launch flags)."""
    flags = ""
    if gpu["vendor"] == "nvidia" and "compute" in gpu:
        say(f"  Nvidia: {gpu['name']} / compute {gpu['compute']} / {gpu['vram_mb']} MB VRAM / driver {gpu['driver']}")
        major, minor = (int(x) for x in gpu["compute"].split("."))
        build = "nvidia" if major * 10 + minor >= 75 else "nvidia_cu126"
        if gpu["vram_mb"] <= 8300:
            flags = "--disable-cuda-malloc --reserve-vram 1"
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


def read_build_flags(build: str) -> str:
    """AMD/Intel builds ship their own launcher; reuse its flags."""
    for name in ("run_amd_gpu.bat", "run_intel_gpu.bat"):
        if (build == "intel") == ("intel" in name):
            bat = PORTABLE / name
            if bat.is_file():
                m = re.search(r"main\.py\s+(.*)", bat.read_text(encoding="utf-8", errors="replace"))
                if m:
                    return re.sub(r"--windows-standalone-build\s*", "", m.group(1)).replace("%*", "").strip()
    return ""


# --------------------------------------------------------------------------- 3. ComfyUI

def installed_comfy_version() -> str | None:
    f = COMFY / "comfyui_version.py"
    if not f.is_file():
        return None
    m = re.search(r'__version__\s*=\s*"([^"]+)"', f.read_text(encoding="utf-8"))
    return m.group(1) if m else None


def install_comfyui(manifest: dict, build: str, sevenzip: Path) -> None:
    want = manifest["comfyui"]["version"]
    have = installed_comfy_version()
    if have == want and PY.is_file():
        say(f"  ComfyUI {have} already installed.")
        return
    if PORTABLE.exists():
        raise RuntimeError(
            f"{PORTABLE} exists but is ComfyUI {have or 'unknown/incomplete'}, not {want}. "
            "Delete the 'comfyui' folder to reinstall (models stored there would be removed)."
        )
    url = manifest["comfyui"]["release_url"].format(tag=manifest["comfyui"]["tag"], build=build)
    archive = COMFY_HOME / f"ComfyUI_windows_portable_{build}.7z"
    size = remote_size(url)
    need = (size or 2_000_000_000) * 4  # archive + extracted
    if free_space(COMFY_HOME) < need:
        raise RuntimeError(f"not enough free disk space (need about {fmt_size(need)})")
    say(f"  downloading ComfyUI {want} ({build}, {fmt_size(size) if size else 'size unknown'}) ...")
    curl_download(url, archive, expected_size=size)
    say("  extracting (a few minutes) ...")
    r = subprocess.run([str(sevenzip), "x", "-aoa", f"-o{COMFY_HOME}", str(archive)], capture_output=True, text=True)
    if r.returncode != 0 or not PY.is_file():
        raise RuntimeError(f"extraction failed: {(r.stdout + r.stderr)[-300:]}")
    archive.unlink()
    got = installed_comfy_version()
    if got != want:
        raise RuntimeError(f"installed ComfyUI reports version {got}, expected {want}")
    say(f"  ComfyUI {got} installed.")


# --------------------------------------------------------------------------- 4. custom nodes

def write_pip_constraints() -> Path:
    """Keep the portable build's torch stack fixed while node requirements install."""
    out = subprocess.run([str(PY), "-m", "pip", "list", "--format=freeze"], capture_output=True, text=True).stdout
    keep = [l for l in out.splitlines() if re.match(r"(?i)(torch|torchvision|torchaudio)==", l)]
    path = DATA / "pip-constraints.txt"
    DATA.mkdir(exist_ok=True)
    path.write_text("\n".join(keep) + "\n", encoding="utf-8")
    return path


def install_nodes(manifest: dict) -> None:
    nodes_dir = COMFY / "custom_nodes"
    constraints = write_pip_constraints()
    cache = DATA / "cache"
    for n in manifest["nodes"]:
        dest, marker = nodes_dir / n["name"], nodes_dir / n["name"] / ".accio_pin"
        if not (marker.is_file() and marker.read_text().strip() == n["commit"]):
            say(f"  {n['name']} @ {n['commit'][:10]}")
            if dest.exists():
                shutil.rmtree(dest)  # unpinned leftovers inside the bundled install only
            zip_path = cache / f"{n['name']}-{n['commit']}.zip"
            curl_download(f"https://github.com/{n['repo']}/archive/{n['commit']}.zip", zip_path)
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
            r = subprocess.run([str(PY), "-m", "pip", "install", "--no-input", "--no-warn-script-location", "-c", str(constraints), "-r", str(req)])
            if r.returncode != 0:
                raise RuntimeError(f"pip install failed for {n['name']}")
            req_ok.write_text("ok\n", encoding="utf-8")


# --------------------------------------------------------------------------- 5. models

def models_dir_of(path: str) -> Path | None:
    p = Path(path.strip().strip('"'))
    for cand in (p, p / "models", p / "ComfyUI" / "models", p / "ComfyUI_windows_portable" / "ComfyUI" / "models"):
        if (cand / "diffusion_models").is_dir() or (cand / "loras").is_dir():
            return cand.resolve()
    return None


def locate_existing(models_from: Path | None, m: dict) -> Path | None:
    if not models_from:
        return None
    folders = [m["folder"]] + {"diffusion_models": ["unet"], "text_encoders": ["clip"]}.get(m["folder"], [])
    for f in folders:
        p = models_from / f / m["file"]
        if p.is_file():
            ok, why = verify_safetensors(p, m["size"])
            if ok:
                return p
            say(f"  [!] {m['file']} in the existing folder failed verification ({why}); will download a fresh copy")
    return None


def install_models(manifest: dict, models_from: Path | None, optional: bool, interactive: bool) -> list[str]:
    dest_root = COMFY / "models"
    todo, rows = [], []
    for m in manifest["models"]:
        if not m["required"] and not optional:
            continue
        dest = dest_root / m["folder"] / m["file"]
        ext = locate_existing(models_from, m)
        if ext:
            rows.append((m["file"], m["size"], "found in existing models folder"))
            continue
        if dest.is_file():
            ok, why = verify_safetensors(dest, m["size"])
            if ok:
                rows.append((m["file"], m["size"], "already installed"))
                continue
            say(f"  [!] {m['file']} is incomplete or damaged ({why}); removing and re-downloading")
            dest.unlink()
        part = dest.with_name(dest.name + ".part")
        have = part.stat().st_size if part.is_file() else 0
        rows.append((m["file"], m["size"], f"download{f' (resume from {fmt_size(have)})' if have else ''}"))
        todo.append((m, dest, m["size"] - have))
    say("  Model                                                                 Size       Status")
    for name, size, status in rows:
        say(f"  {name[:66].ljust(66)} {fmt_size(size).rjust(9)}  {status}")
    need = sum(t[2] for t in todo)
    say(f"\n  To download: {fmt_size(need)} in {len(todo)} file(s). Free space: {fmt_size(free_space(dest_root))}.")
    if not todo:
        return []
    if free_space(dest_root) < need * 1.02 + 2_000_000_000:
        raise RuntimeError("not enough free disk space for the model downloads")
    failed = []
    for m, dest, _ in todo:
        say(f"\n  downloading {m['file']} ({fmt_size(m['size'])})")
        for attempt in (1, 2):
            try:
                curl_download(m["url"], dest, expected_size=m["size"])
                ok, why = verify_safetensors(dest, m["size"])
                if ok:
                    say("    verified.")
                    break
                say(f"    verification failed: {why}")
                dest.unlink(missing_ok=True)
            except RuntimeError as e:
                say(f"    {e}")
        else:
            failed.append(m["file"])
    return failed


def write_extra_model_paths(models_from: Path) -> None:
    lines = ["# Written by Accio's installer. Read-only use of an existing ComfyUI models folder (APP_SPEC 11.4).", "accio_existing:"]
    for folder in ("diffusion_models", "text_encoders", "vae", "loras"):
        if (models_from / folder).is_dir():
            lines.append(f"    {folder}: {(models_from / folder).as_posix()}/")
    (COMFY / "extra_model_paths.yaml").write_text("\n".join(lines) + "\n", encoding="utf-8")


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
            idx = subprocess.run(["curl.exe", "-sL", "--ssl-no-revoke", "https://nodejs.org/dist/index.json"], capture_output=True, text=True).stdout
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
    ap.add_argument("--models-from")
    ap.add_argument("--optional-loras", choices=["yes", "no", "ask"], default="ask")
    ap.add_argument("--yes", action="store_true")
    ap.add_argument("--skip-models", action="store_true")
    ap.add_argument("--portable-node", action="store_true")
    args = ap.parse_args()
    interactive = not args.yes and sys.stdin is not None and sys.stdin.isatty()
    manifest = load_manifest()
    state = load_state()
    ctx: dict = {}

    step("Portable tools")
    if not run_step("7zr", lambda: ctx.update(sz=ensure_7zr(manifest))):
        return finish(state)

    step("Detecting graphics card")
    def gpu_step():
        gpu = detect_gpu()
        build, flags = choose_build(gpu, interactive)
        if installed_comfy_version() and state.get("build"):
            build = state["build"]  # keep the build that is actually installed
        state.update(gpu=gpu, build=build, launch_flags=flags)
        ctx["build"] = build
    if not run_step("GPU detection", gpu_step):
        return finish(state)

    step(f"ComfyUI {manifest['comfyui']['version']} (bundled, portable)")
    if not run_step("ComfyUI", lambda: install_comfyui(manifest, ctx["build"], ctx["sz"])):
        return finish(state)
    if state["build"] in ("amd", "intel") and not state.get("launch_flags"):
        state["launch_flags"] = read_build_flags(state["build"])
    state["comfyui_version"] = installed_comfy_version()
    save_state(state)

    step("Custom nodes (pinned)")
    run_step("Custom nodes", lambda: install_nodes(manifest))
    state["nodes"] = {n["name"]: n["commit"] for n in manifest["nodes"]}
    save_state(state)

    step("Models")
    if args.skip_models:
        say("  skipped (--skip-models)")
    else:
        mf_raw = args.models_from or state.get("models_from") or ""
        if not mf_raw and interactive:
            mf_raw = ask("  Use models from an existing ComfyUI folder? (path or Enter to skip): ", "")
        models_from = None
        if mf_raw:
            models_from = models_dir_of(mf_raw)
            if not models_from:
                say(f"  [!] No models folder found at {mf_raw}; models will be downloaded instead.")
            elif models_from.resolve() == (COMFY / "models").resolve():
                models_from = None
            else:
                say(f"  Using models from {models_from} (read-only).")
        state["models_from"] = str(models_from) if models_from else ""
        optional = args.optional_loras == "yes" or (
            args.optional_loras == "ask" and interactive and ask("  Also install the 4 optional preset LoRAs (Head/Body swap, Remove/Move object, ~0.6 GB)? [y/N]: ", "n").lower() == "y"
        )
        def models_step():
            if models_from:
                write_extra_model_paths(models_from)
            failed = install_models(manifest, models_from, optional, interactive)
            if failed:
                raise RuntimeError("these models failed to download or verify: " + ", ".join(failed))
        run_step("Models", models_step)
        save_state(state)

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
