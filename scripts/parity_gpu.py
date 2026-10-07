"""GPU pixel-parity harness (APP_SPEC 7.2 / 11.6): reference ComfyUI vs Accio + its bundled ComfyUI.

For every case the prompt is built once by Accio's own engine (POST /api/build on a scratch Accio server that uses a
scratch data folder, so the real history, settings and password are untouched). The very same prompt is then
  * queued on the reference ComfyUI (the user's install, port 8188; only its input/ output/ temp are written), and
  * run as a real job through Accio's API on the bundled ComfyUI (port 8189).
Both outputs are compared pixel by pixel. Seeds, inputs and prompts are identical, so any difference comes from the
backends (version, node pins, launch flags, GPU nondeterminism). Graph structure itself is covered by
tests/test_structural_parity.py (spec 7.1).

Run from the project root with the project's venv:

    env\\Scripts\\python.exe scripts\\parity_gpu.py all --work <folder> --reference-dir <ComfyUI_windows_portable> --launch-reference

Phases (each resumable, results are cached in <work>): prepare, reference, app, compare. See the README of this file's
output (<work>\\results.md) for the table. Needs the bundled backend running on 8189 (Run_Accio.bat starts it).
GPU time: roughly 40 minutes per side on an RTX 2060.
"""
from __future__ import annotations

import argparse
import asyncio
import copy
import json
import subprocess
import sys
import threading
import time
from pathlib import Path

import httpx
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "server"))

APP_PORT = 7899
BUNDLED = "http://127.0.0.1:8189"
PASSWORD = "parity-test-password-1"
PROMPT_CREATE = "a lighthouse on a rocky cliff at golden hour, dramatic clouds, calm sea, photograph"
ENHANCE_BASE = "Replace the sky in <image1> with a deep starry night sky. Keep everything else unchanged and match the lighting."


# --------------------------------------------------------------------------- inputs

def scene(w: int, h: int, seed: int, accent: tuple[int, int, int]) -> Image.Image:
    """A deterministic synthetic 'photo' (gradients, shapes, mild texture). No personal images are used."""
    rng = np.random.default_rng(seed)
    y = np.linspace(0, 1, h)[:, None, None]
    sky = (np.array([90, 140, 220]) * (1 - y) + np.array([235, 210, 180]) * y) * np.ones((h, w, 3))
    img = Image.fromarray(sky.astype("uint8"))
    d = ImageDraw.Draw(img)
    d.ellipse([w * 0.68, h * 0.12, w * 0.68 + h * 0.16, h * 0.12 + h * 0.16], fill=(255, 236, 150))
    d.polygon([(0, h * 0.7), (w * 0.3, h * 0.45), (w * 0.55, h * 0.68), (w * 0.8, h * 0.5), (w, h * 0.72), (w, h), (0, h)], fill=(70, 110, 80))
    d.rectangle([w * 0.2, h * 0.62, w * 0.38, h * 0.82], fill=accent)
    d.polygon([(w * 0.18, h * 0.62), (w * 0.29, h * 0.5), (w * 0.4, h * 0.62)], fill=(120, 50, 40))
    d.ellipse([w * 0.5, h * 0.6, w * 0.62, h * 0.8], fill=(40, 90, 50))
    img = img.filter(ImageFilter.GaussianBlur(1.2))
    arr = np.asarray(img).astype("int16") + rng.integers(-4, 5, (h, w, 3))
    return Image.fromarray(np.clip(arr, 0, 255).astype("uint8"))


def png_bytes(img: Image.Image) -> bytes:
    import io

    b = io.BytesIO()
    img.save(b, "PNG")
    return b.getvalue()


# --------------------------------------------------------------------------- scratch Accio server

def start_scratch_server(work: Path) -> threading.Thread:
    import uvicorn

    import config

    data = work / "accio_data"
    data.mkdir(parents=True, exist_ok=True)
    config.SETTINGS_FILE = work / "accio_settings.json"
    config.SETTINGS_FILE.write_text(json.dumps({"output_prefix": "ParityApp"}), encoding="utf-8")
    import main

    main.DATA_DIR = data
    main.THUMBS_DIR = data / "thumbs"
    main.UPLOADS_DIR = data / "uploads"
    server = uvicorn.Server(uvicorn.Config(main.app, host="127.0.0.1", port=APP_PORT, log_level="error"))
    t = threading.Thread(target=server.run, daemon=True)
    t.start()
    for _ in range(100):
        try:
            if httpx.get(f"http://127.0.0.1:{APP_PORT}/api/auth/status", timeout=1).status_code == 200:
                return t
        except httpx.HTTPError:
            time.sleep(0.2)
    raise SystemExit("scratch Accio server did not start")


def app_client() -> httpx.Client:
    c = httpx.Client(base_url=f"http://127.0.0.1:{APP_PORT}", timeout=60)
    st = c.get("/api/auth/status").json()
    if not st["configured"]:
        r = c.post("/api/auth/setup", json={"password": PASSWORD})
    else:
        r = c.post("/api/auth/login", json={"password": PASSWORD})
    r.raise_for_status()
    return c


# --------------------------------------------------------------------------- phases

def case_list(files: dict[str, str]) -> list[dict]:
    """Case name -> request params. `files` maps logical input names to the uploaded (server-side) names."""
    s = {"seed": 1111, "seed_variance_seed": 2222}
    d = {**s, "seed_pass2": 3333}
    return [
        {"name": "create_std_default", "params": {"mode": "create", "variant": "standard", "prompt": PROMPT_CREATE, **s}},
        {"name": "create_std_tenh", "params": {"mode": "create", "variant": "standard", "prompt": PROMPT_CREATE, "t_enhancer": True, **s}},
        {"name": "create_std_novar", "params": {"mode": "create", "variant": "standard", "prompt": PROMPT_CREATE, "seed_variance": False, **s}},
        {"name": "create_std_nosharp", "params": {"mode": "create", "variant": "standard", "prompt": PROMPT_CREATE, "sharpen": False, **s}},
        {"name": "create_det_default", "params": {"mode": "create", "variant": "detailed", "prompt": PROMPT_CREATE, **d}},
        {"name": "create_det_tenh", "params": {"mode": "create", "variant": "detailed", "prompt": PROMPT_CREATE, "t_enhancer": True, **d}},
        {"name": "create_det_novar_nosharp", "params": {"mode": "create", "variant": "detailed", "prompt": PROMPT_CREATE, "seed_variance": False, "sharpen": False, **d}},
        {"name": "multiedit_default", "params": {"mode": "multiedit", "prompt": ENHANCE_BASE + " Add the vase from <image2> on the grass.", "seed": 4444,
                                                 "images": [{"file": files["scene_a"], "name": "scene_a.png"}, {"file": files["scene_b"], "name": "scene_b.png"}]}},
        {"name": "multiedit_keepres_noenh", "params": {"mode": "multiedit", "prompt": ENHANCE_BASE, "seed": 4445, "prompt_enhancer": False,
                                                       "keep_original_resolution": True, "images": [{"file": files["scene_a"], "name": "scene_a.png"}]}},
        {"name": "inpaint_brush", "params": {"mode": "inpaint", "prompt": "Replace the sun with a bright full moon.", "image": files["mask_app"], "seed": 5555}},
        {"name": "outpaint_default", "params": {"mode": "outpaint", "image": files["scene_a_plain"], "pad_left": 192, "pad_right": 192, "seed": 6666}},
    ]


def sniff_sub(name: str, kind: str) -> str:
    return "minimax_h3" if kind == "media" else "accio"


def phase_prepare(work: Path, brush_png: Path) -> None:
    inputs = work / "inputs"
    inputs.mkdir(parents=True, exist_ok=True)
    a, b = scene(1024, 768, 1, (200, 180, 140)), scene(768, 1024, 2, (170, 40, 40))
    blobs = {"scene_a": png_bytes(a), "scene_b": png_bytes(b), "scene_a_plain": png_bytes(a)}
    if (work / "scene_a.png").exists() and (work / "scene_a.png").read_bytes() != blobs["scene_a"]:
        raise SystemExit("scene_a.png changed since the brush mask was built; rebuild the mask")
    mask_png = brush_png.read_bytes()
    c = app_client()
    uploaded: dict[str, dict] = {}
    for key, data, kind in (("scene_a", blobs["scene_a"], "media"), ("scene_b", blobs["scene_b"], "media"),
                            ("scene_a_plain", blobs["scene_a_plain"], "image"), ("mask_app", mask_png, "mask")):
        r = c.post(f"/api/upload?kind={kind}", content=data)
        r.raise_for_status()
        name = r.json()["file"]
        (inputs / name).write_bytes(data)
        uploaded[key] = {"file": name, "subfolder": "minimax_h3" if kind == "media" else "accio"}
    cases = case_list({k: v["file"] for k, v in uploaded.items()})
    for case in cases:
        r = c.post("/api/build", json={"params": case["params"]})
        r.raise_for_status()
        j = r.json()
        case["prompt"], case["seeds"], case["template"] = j["prompt"], j["seeds"], j["template"]
    (work / "cases.json").write_text(json.dumps({"uploaded": uploaded, "cases": cases}, indent=1), encoding="utf-8")
    print(f"prepared {len(cases)} cases, {len(uploaded)} inputs")


def save_nodes(prompt: dict) -> list[str]:
    return [k for k, v in prompt.items() if v["class_type"] == "SaveImage"]


def wait_history(ref: httpx.Client, pid: str, timeout: float = 3600) -> dict:
    t0 = time.time()
    while time.time() - t0 < timeout:
        h = ref.get(f"/history/{pid}").json()
        if pid in h and h[pid].get("status", {}).get("completed") is not None and h[pid].get("outputs") is not None:
            st = h[pid]["status"]
            if st.get("status_str") == "error":
                raise RuntimeError(f"reference job failed: {json.dumps(st)[:800]}")
            return h[pid]
        time.sleep(3)
    raise TimeoutError(pid)


def phase_reference(work: Path, ref_url: str, only: set[str], repeat: str | None, brush_png: Path) -> None:
    spec = json.loads((work / "cases.json").read_text(encoding="utf-8"))
    ref = httpx.Client(base_url=ref_url, timeout=60)
    for u in spec["uploaded"].values():  # identical bytes under identical names
        data = (work / "inputs" / u["file"]).read_bytes()
        mime = "image/png"
        ref.post("/upload/image", files={"image": (u["file"], data, mime)}, data={"subfolder": u["subfolder"], "type": "input", "overwrite": "true"}).raise_for_status()
    # The reference's mask comes from ComfyUI's own mask-save route (what its MaskEditor posts to): original RGB + the
    # alpha of the drawn mask. Accio's side uses the PNG built by the browser code; both are compared pixel by pixel.
    mask_ref_name = "ref_" + spec["uploaded"]["mask_app"]["file"]
    orig_name = spec["uploaded"]["scene_a_plain"]["file"]
    r = ref.post("/upload/mask", files={"image": (mask_ref_name, brush_png.read_bytes(), "image/png")},
                 data={"original_ref": json.dumps({"filename": orig_name, "subfolder": "accio", "type": "input"}),
                       "type": "input", "subfolder": "accio", "overwrite": "true"})
    r.raise_for_status()
    ref_mask = ref.get("/view", params={"filename": mask_ref_name, "subfolder": "accio", "type": "input"}).content
    (work / "inputs" / mask_ref_name).write_bytes(ref_mask)
    out = work / "reference"
    out.mkdir(exist_ok=True)
    names = [c["name"] for c in spec["cases"] if not only or c["name"] in only]
    runs = [(n, n) for n in names] + ([(repeat + "__repeat", repeat)] if repeat else [])
    for tag, name in runs:
        if (out / f"{tag}.json").exists():
            continue
        case = next(c for c in spec["cases"] if c["name"] == name)
        prompt = copy.deepcopy(case["prompt"])
        for nid in save_nodes(prompt):
            prompt[nid]["inputs"]["filename_prefix"] = f"ParityRef/{tag}"
        if case["params"]["mode"] == "inpaint":
            prompt["250"]["inputs"]["image"] = f"accio/{mask_ref_name} [input]"
        t0 = time.time()
        r = ref.post("/prompt", json={"prompt": prompt, "client_id": "parity"})
        if r.status_code != 200:
            raise RuntimeError(f"reference rejected {tag}: {r.text[:800]}")
        h = wait_history(ref, r.json()["prompt_id"])
        secs = time.time() - t0
        meta = {"seconds": round(secs, 1), "outputs": {}, "text": {}}
        for nid, o in h["outputs"].items():
            for i, img in enumerate(o.get("images", [])):
                data = ref.get("/view", params={"filename": img["filename"], "subfolder": img["subfolder"], "type": img["type"]}).content
                (out / f"{tag}__{nid}_{i}.png").write_bytes(data)
                meta["outputs"].setdefault(nid, []).append(f"{tag}__{nid}_{i}.png")
            if o.get("text"):
                meta["text"][nid] = o["text"][0]
        (out / f"{tag}.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
        print(f"reference {tag}: {secs:.0f}s")


def phase_app(work: Path, only: set[str]) -> None:
    spec = json.loads((work / "cases.json").read_text(encoding="utf-8"))
    c = app_client()
    out = work / "app"
    out.mkdir(exist_ok=True)
    for case in spec["cases"]:
        name = case["name"]
        if (only and name not in only) or (out / f"{name}.json").exists():
            continue
        t0 = time.time()
        r = c.post("/api/jobs", json={"params": {**case["params"]}})
        r.raise_for_status()
        job = r.json()
        while job["status"] in ("queued", "running"):
            time.sleep(3)
            job = c.get(f"/api/jobs/{job['id']}").json()
        if job["status"] != "done":
            raise RuntimeError(f"app job {name} ended {job['status']}: {job.get('error')}")
        meta = {"seconds": round(time.time() - t0, 1), "outputs": {}, "text": {}, "seeds": job["seeds"], "prompt_used": job.get("prompt_used")}
        for i, o in enumerate(job["outputs"]):
            data = c.get(f"/api/jobs/{job['id']}/image/{i}").content
            fn = f"{name}__{o['node']}_0.png"
            (out / fn).write_bytes(data)
            meta["outputs"].setdefault(o["node"], []).append(fn)
        (out / f"{name}.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
        print(f"app {name}: {meta['seconds']:.0f}s seeds={job['seeds']}")


def phase_noise(work: Path, side: str, ref_url: str, case: str, runs: int) -> None:
    """Determinism baseline: run `case` `runs` times on ONE backend, with a different-seed job in between each time so the
    backend's node cache cannot answer for it (a cached repeat takes ~3 s and proves nothing). Compares the runs pairwise."""
    spec = json.loads((work / "cases.json").read_text(encoding="utf-8"))
    base = next(c for c in spec["cases"] if c["name"] == case)
    other_seed = {**base["params"], "seed": 9999, "seed_variance_seed": 8888}
    out = work / f"noise_{side}"
    out.mkdir(exist_ok=True)
    sequence = []
    for i in range(runs):
        sequence += [("A", i), ("B", i)]
    results: dict[str, Path] = {}
    if side == "reference":
        ref = httpx.Client(base_url=ref_url, timeout=60)
        c = app_client()
        built_b = c.post("/api/build", json={"params": other_seed}).json()["prompt"]
        for kind, i in sequence:
            prompt = copy.deepcopy(base["prompt"] if kind == "A" else built_b)
            for nid in save_nodes(prompt):
                prompt[nid]["inputs"]["filename_prefix"] = f"ParityRef/noise_{kind}{i}"
            t0 = time.time()
            r = ref.post("/prompt", json={"prompt": prompt, "client_id": "parity"})
            r.raise_for_status()
            h = wait_history(ref, r.json()["prompt_id"])
            img = next(o["images"][0] for nid, o in h["outputs"].items() if nid in save_nodes(prompt) and o.get("images"))
            data = ref.get("/view", params={"filename": img["filename"], "subfolder": img["subfolder"], "type": img["type"]}).content
            (out / f"{kind}{i}.png").write_bytes(data)
            print(f"noise reference {kind}{i}: {time.time() - t0:.0f}s", flush=True)
    else:
        c = app_client()
        for kind, i in sequence:
            t0 = time.time()
            job = c.post("/api/jobs", json={"params": base["params"] if kind == "A" else other_seed}).json()
            while job["status"] in ("queued", "running"):
                time.sleep(3)
                job = c.get(f"/api/jobs/{job['id']}").json()
            if job["status"] != "done":
                raise RuntimeError(f"noise job ended {job['status']}")
            (out / f"{kind}{i}.png").write_bytes(c.get(f"/api/jobs/{job['id']}/image/0").content)
            print(f"noise app {kind}{i}: {time.time() - t0:.0f}s", flush=True)
    names = [f"A{i}" for i in range(runs)]
    print(f"noise {side} pairwise (max, mean) for {case}:")
    for x in range(runs):
        for y in range(x + 1, runs):
            d = diff(out / f"{names[x]}.png", out / f"{names[y]}.png")
            print(f"  {names[x]} vs {names[y]}: identical={d['identical']} max={d.get('max')} mean={d.get('mean')}", flush=True)


def diff(a: Path, b: Path) -> dict:
    ia, ib = Image.open(a), Image.open(b)
    if ia.size != ib.size or ia.mode != ib.mode:
        return {"identical": False, "note": f"size/mode differ {ia.size} {ia.mode} vs {ib.size} {ib.mode}"}
    x, y = np.asarray(ia).astype("int16"), np.asarray(ib).astype("int16")
    d = np.abs(x - y)
    return {"identical": bool(not d.any()), "max": int(d.max()), "differing_px": int((d.max(axis=-1) > 0).sum()) if d.ndim == 3 else int((d > 0).sum()),
            "mean": round(float(d.mean()), 6), "px": int(x.shape[0] * x.shape[1]), "size": list(ia.size)}


def phase_compare(work: Path) -> None:
    spec = json.loads((work / "cases.json").read_text(encoding="utf-8"))
    rows, report = [], {}
    for case in spec["cases"]:
        n = case["name"]
        if not (work / "app" / f"{n}.json").exists() or not (work / "reference" / f"{n}.json").exists():
            continue
        ra = json.loads((work / "reference" / f"{n}.json").read_text(encoding="utf-8"))
        aa = json.loads((work / "app" / f"{n}.json").read_text(encoding="utf-8"))
        entry = {"reference_s": ra["seconds"], "app_s": aa["seconds"], "outputs": {}}
        for nid, files in aa["outputs"].items():
            if nid in ra["outputs"]:
                entry["outputs"][nid] = diff(work / "reference" / ra["outputs"][nid][0], work / "app" / files[0])
        for nid, txt in ra["text"].items():
            entry.setdefault("prompt_used_same", txt == aa.get("prompt_used"))
        report[n] = entry
        for nid, dd in entry["outputs"].items():
            rows.append((n, nid, dd, entry))
    rep = work / "reference" / "create_std_default__repeat.json"
    if rep.exists():
        r0 = json.loads((work / "reference" / "create_std_default.json").read_text(encoding="utf-8"))
        r1 = json.loads(rep.read_text(encoding="utf-8"))
        report["_noise_reference_vs_reference"] = {nid: diff(work / "reference" / r0["outputs"][nid][0], work / "reference" / r1["outputs"][nid][0]) for nid in r0["outputs"]}
    m = work / "inputs"
    mask_app = spec["uploaded"]["mask_app"]["file"]
    if (m / ("ref_" + mask_app)).exists():
        report["_mask_browser_vs_comfyui_maskroute"] = diff(m / mask_app, m / ("ref_" + mask_app))
    (work / "results.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    lines = ["| case | output node | identical | max diff (of 255) | differing px | ref s | app s |", "|---|---|---|---|---|---|---|"]
    for n, nid, dd, e in rows:
        lines.append(f"| {n} | {nid} | {dd['identical']} | {dd.get('max', '-')} | {dd.get('differing_px', '-')} / {dd.get('px', '-')} | {e['reference_s']} | {e['app_s']} |")
    (work / "results.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    for k, v in report.items():
        if k.startswith("_"):
            print(k, json.dumps(v))
        elif "prompt_used_same" in v:
            print(k, "prompt_used_same:", v["prompt_used_same"])


def launch_reference(ref_dir: Path, work: Path, url: str) -> subprocess.Popen | None:
    try:
        if httpx.get(url + "/system_stats", timeout=2).status_code == 200:
            print("reference already running; using it")
            return None
    except httpx.HTTPError:
        pass
    env = {**__import__("os").environ, "PYTHONUTF8": "1"}
    log = open(work / "reference.log", "wb")
    # same flags as the reference's own launcher (run_merged.bat), plus loopback/no browser
    p = subprocess.Popen([str(ref_dir / "python_embeded" / "python.exe"), "-s", "ComfyUI\\main.py", "--windows-standalone-build", "--disable-cuda-malloc",
                          "--reserve-vram", "1", "--listen", "127.0.0.1", "--port", "8188", "--disable-auto-launch"], cwd=ref_dir, env=env, stdout=log, stderr=subprocess.STDOUT)
    for _ in range(240):
        try:
            if httpx.get(url + "/system_stats", timeout=2).status_code == 200:
                return p
        except httpx.HTTPError:
            time.sleep(2)
    p.kill()
    raise SystemExit("reference ComfyUI did not start; see reference.log")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("phase", choices=["inputs", "prepare", "reference", "app", "compare", "noise", "all"])
    ap.add_argument("--work", required=True, type=Path)
    ap.add_argument("--brush-png", type=Path, help="the RGBA inpaint PNG built by the browser code (inpaintExport) for scene_a")
    ap.add_argument("--reference-dir", type=Path)
    ap.add_argument("--reference-url", default="http://127.0.0.1:8188")
    ap.add_argument("--launch-reference", action="store_true", help="start the reference ComfyUI (and stop it again) if it is not running")
    ap.add_argument("--only", default="", help="comma-separated case names")
    ap.add_argument("--repeat", default="create_std_default", help="reference case to run twice (GPU noise baseline); '' = none")
    ap.add_argument("--side", choices=["reference", "app"], default="reference", help="noise phase: which backend to test")
    ap.add_argument("--noise-case", default="create_std_default")
    ap.add_argument("--noise-runs", type=int, default=3)
    a = ap.parse_args()
    a.work.mkdir(parents=True, exist_ok=True)
    only = {x for x in a.only.split(",") if x}
    if a.phase == "inputs":  # the source picture for the brush-mask step (browser); same bytes prepare will use
        (a.work / "scene_a.png").write_bytes(png_bytes(scene(1024, 768, 1, (200, 180, 140))))
        return
    start_scratch_server(a.work)
    if a.phase in ("prepare", "all"):
        if not a.brush_png:
            raise SystemExit("--brush-png is required for prepare")
        phase_prepare(a.work, a.brush_png)
    if a.phase in ("reference", "all"):
        proc = launch_reference(a.reference_dir, a.work, a.reference_url) if a.launch_reference else None
        try:
            phase_reference(a.work, a.reference_url, only, a.repeat or None, a.brush_png)
            try:
                httpx.post(a.reference_url + "/free", json={"unload_models": True, "free_memory": True}, timeout=20)
            except httpx.HTTPError:
                pass
        finally:
            if proc:
                subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True)
    if a.phase == "noise":
        if a.side == "reference":
            proc = launch_reference(a.reference_dir, a.work, a.reference_url) if a.launch_reference else None
            try:
                phase_noise(a.work, "reference", a.reference_url, a.noise_case, a.noise_runs)
            finally:
                if proc:
                    subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True)
        else:
            phase_noise(a.work, "app", a.reference_url, a.noise_case, a.noise_runs)
    if a.phase in ("app", "all"):
        phase_app(a.work, only)
    if a.phase in ("compare", "all"):
        phase_compare(a.work)


if __name__ == "__main__":
    main()
