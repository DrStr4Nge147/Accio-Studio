# Accio Studio - progress

Read `APP_SPEC.md` first; this file records state, decisions and how to run. Last updated: 2026-10-07.

## Status

| Phase | State |
|---|---|
| 1. Scaffold | **Done** |
| 2. Template engine | **Done** (structural parity 20/20) |
| 2b. Portable bundle | **Done** (see below) |
| 3. Design proposal | **Done, approved by user 2026-10-07** (see "Approved design" below; user: "a good start, we can always edit it") |
| 4. Create mode | **Next** |
| 5-8 | Not started |

Project root = `E:\AI_Softwares\ImageGenerator\AccioStudio` (`git init` done on branch `main`, **nothing committed yet**: ask the user before the first commit, and branch first).

## Spec change recorded after Phase 2 (APP_SPEC rule 3, 5.1, 9.2 step 1, new section 11)

Accio now ships its **own portable ComfyUI** (v0.38.0, port **8189**) installed by `Install.bat` into `comfyui\ComfyUI_windows_portable\`. The user's existing ComfyUI (`...\Merged\ComfyUI_windows_portable`, port 8188) is **reference only**: never edited, installed into, launched or depended on at runtime. The only allowed contact is reading its `models` folder via `extra_model_paths.yaml` (section 11.4) on the user's own PC. Parity (section 7) is now: user's ComfyUI (reference) vs Accio + bundled ComfyUI.

**Spec text still out of date (not edited, it is the user's document):** section 5.1 still says "ComfyUI URL ... default `http://127.0.0.1:8188`" and "queue is shared with the user's own ComfyUI use"; section 1 / 9.3 still describe the user's ComfyUI as the backend ("the user also uses this ComfyUI directly"). The code follows rule 3 / 9.2 / 11 (default 8189). Section 9.3 (auto-unload default OFF) is still a Phase 7/8 item.

## Phase 2b results (verified on this PC)

- **Fresh install into the app folder: PASS.** `Install.bat nopause --yes --optional-loras no --models-from "<user's ...\ComfyUI\models>"`: portable 7zr, GPU detect (RTX 2060, compute 7.5, 6144 MB -> build `nvidia`, flags `--disable-cuda-malloc --reserve-vram 1`), ComfyUI 0.38.0 downloaded (1.99 GB, size-checked) and extracted (5.0 GB on disk), 8 pinned node packs + their requirements into the bundled `python_embeded`, 8 required models found in the user's models folder and header-verified (0 bytes downloaded), frontend present. All steps OK. Re-run is idempotent (0.9 s, everything skipped).
- **Bundled ComfyUI starts via `Run_Accio.bat` (option 1): PASS.** Own minimized window on 127.0.0.1:8189, log in `data\logs\comfyui.log`, polled until ready (about 18 s), server on 7862 connected. `/api/health`: `comfy_version 0.38.0`, no missing models, no missing nodes, no warnings.
- **`/object_info` has every template class: PASS.** `tests/test_live_object_info.py` (20 live tests, run against 8189) all pass; also `/api/health.missing_nodes == []`. Note: `PixaromaRunTimer` is *not* installed in the bundle (spec drops Pixaroma); that is fine because section 4.4 strips it before queueing. The health check now evaluates the stripped templates (it wrongly listed it before the fix).
- **One Standard job on the bundled ComfyUI: PASS.** 512x512, seeds 12345/777, finished with progress 8/8 and the image served via `/api/jobs/{id}/image/0`. **Bonus preliminary parity datapoint:** the same request was run on the user's ComfyUI earlier (Phase 2): the two PNGs are **pixel-identical (max difference 0)**. This is one Standard case only; the formal GPU parity runs stay in Phase 8.
- **Pins:** 6 git packs from `git rev-parse HEAD` in the reference install (working trees clean). 2 registry packs resolved by cloning upstream and matching every file of the user's installed copy byte-for-byte (LF-normalised, `__pycache__` ignored) against each commit: **ComfyUI-Krea2T-Enhancer 1.4.2 = `e1f60f79e168c62b1cb1cf773dfb3ae4ee2292e2`** (13/13 files match, 0 extra), **ComfyUI-RBG-SmartSeedVariance 2.2.1 = `00fe680709fc7a0b943994dc91c99bbd20e64d7b`** (12/12, 0 extra; the repo includes the demo .mp4). All 8 recorded in `server/templates/manifest.json`.
- **Models manifest:** 12 files (8 required = 36.9 GB, 4 optional preset LoRAs). All 12 HuggingFace URLs were HEAD-checked: HTTP 200 and Content-Length equal to the manifest size and to the files on the reference PC. HF honours Range requests (206).
- **Resumable download + verification: tested with a local range server** (`.part` of 300 KB resumed with `Range: bytes=300000-`, content identical, wrong size rejected) and safetensors header verification (complete OK; truncated, padded, garbage, wrong manifest size all rejected). **A full real HF download was not completed**: HF served this machine at about 37 KB/s during the test, so a 159 MB LoRA would take over an hour; I stopped it. Real-network resume against HF is therefore verified only for range support, not end to end.
- **Portable Node fallback: PASS** (forced with `--portable-node`: downloaded Node v24.21.0 LTS into `bin\node` and rebuilt the frontend).
- **No hard-coded user paths** in shipped files: enforced by `tests/test_installer.py` (scans py/bat/json/ts/html/css/js/md/txt outside APP_SPEC, PROGRESS, `comfy-templates`, env/bin/comfyui/data). Machine-specific values live only in git-ignored `data\install.json` and `comfyui\...\extra_model_paths.yaml`.
- `pytest tests -q`: **107 passed** (with the bundled ComfyUI running; 20 live tests skip when it is offline).

### Not verified in 2b
- The installer on a machine **without** an existing models folder (a real 37 GB download), and on non-Nvidia GPUs (code path for AMD/Intel/old Nvidia exists, untested; AMD/Intel flags are read from the build's own `run_*_gpu.bat`).
- `Install.bat` from a completely empty folder (uv bootstrap + venv creation were done in Phase 1 and are skipped as already present; the new `Install.bat` text for those steps is unchanged logic).
- Interactive prompts (models-folder question, optional-LoRA question, GPU menu): only the `--yes`/arguments path was run.
- Release packaging (`scripts\make_release`, section 11.5): not part of 2b, not built. `Update.bat`, `Run_Accio-zrok-only.bat`, `Setup_Zrok.bat`: later phases.
- The "Download missing models" UI action and the setup-check screen (section 11.3): server side `/api/health` reports missing models/nodes and a ComfyUI-version warning (non-blocking), the UI and the download action come with the frontend phases.

## What exists

- `installer/` (`install.py`, `core.py`): stdlib-only installer logic called by `Install.bat` (portable `7zr.exe` with GitHub fallback because 7-zip.org timed out here, GPU detect, ComfyUI download/extract, pinned node archives via GitHub zip + built-in `tar`, `pip -c data\pip-constraints.txt` so node requirements cannot replace the torch stack, resumable curl downloads, safetensors verification, `extra_model_paths.yaml`, frontend build with portable Node fallback). State in `data\install.json`. Flags: `--models-from`, `--optional-loras yes|no|ask`, `--yes`, `--skip-models`, `--portable-node`.
- `server/templates/manifest.json`: ComfyUI version, 8 node pins, 12 models (URL, size, required flag), 7zr sources. `server/main.py` derives its required-model list from it.
- `server/` FastAPI app (port 7862): `main.py`, `engine.py`, `schemas.py`, `jobs.py`, `history.py`, `comfy.py`, `config.py` (bundled ComfyUI URL/dir, `template_files()` excludes `manifest.json`), `settings_cli.py`, `static/testpage.html` (`/dev`). Engine/API description is unchanged from Phase 2 (see below).
- `frontend/` Vite + React 19 + TS + Tailwind 4 + vite-plugin-pwa placeholder shell.
- `Install.bat`, `Run_Accio.bat` (CRLF). `tests/` (107 tests), `scripts/export-templates.js|.md`, `scripts/compare_exports.py`.

## Engine (APP_SPEC 4.3) in one paragraph

`engine.build(params, catalog)` picks the template, deep-copies it from cached text, strips `Image Comparer (rgthree)` + `PixaromaRunTimer` (asserts no dangling link), overwrites only the listed input values (raising `BuildError` on template drift), injects LoRA entries before the add-lora marker, deletes node `160` when "Save first-pass" is off, and sets `158` from the chosen size x upscale (rounded half-up to a multiple of 8 only when factor != 1). Seeds are random 0..2^53-1 unless supplied; all used seeds are returned and stored. Sampler/scheduler/LoRA/Seed-Variance values are validated against live `/object_info` + `/models/loras`. API: `GET /api/health`, `GET /api/catalog`, `POST /api/build` (dry run), `POST /api/jobs`, `GET /api/jobs[/{id}]`, `POST /api/jobs/{id}/cancel`, `GET /api/jobs/{id}/image/{i}`, `POST /api/upload?kind=media|image|mask`, `GET /api/queue`, `WS /api/ws`.

## Phase 2 results (unchanged)

Structural parity (spec 7.1) for all 20 templates: **PASS** (fresh re-export from ComfyUI's own frontend identical to the shipped templates; engine output differs from templates only at the 4.3 patch points). The re-export was done on the user's ComfyUI frontend; the templates are version-pinned to 0.38.0 and the bundled ComfyUI is the same version.

## Decisions and deviations

- **Server binds `127.0.0.1` by default** (spec 9.2 says local mode binds `0.0.0.0`): no login until Phase 7, `/api/*` is unauthenticated. LAN is opt-in via `"lan_access": true` in `settings.json`. Revisit in Phase 7.
- `--tunnel cloudflare|zrok` accepted but falls back to local (Phase 7).
- Settings keys changed: `comfy_port` (8189), `external_comfy_url` (advanced; when set the bundled ComfyUI is not started), `comfy_dir` (advanced override). The old `comfy_url`/`comfy_dir` defaults pointing at the user's install are gone.
- The installer is Python (called by a thin `Install.bat`) instead of pure batch: needed for header verification, JSON manifest, resumable logic and testability. Downloads still use Windows' `curl.exe -L -f -C -` as in spec 11.2.
- Node packs install their `requirements.txt` into the bundled python with torch/torchvision/torchaudio pinned via a constraints file (not in the spec; protects parity). Packs' `.accio_pin` / `.accio_reqs_ok` marker files record progress; a pack folder without a matching pin is replaced (inside the bundle only).
- Existing-models option copies nothing; `extra_model_paths.yaml` maps `diffusion_models`, `text_encoders`, `vae`, `loras` to the other install's folders. Every candidate is header-verified and size-checked against the manifest before it is reused. Side effect: the LoRA picker will show all LoRAs of that folder, including ones outside this app's scope.
- `Run_Accio.bat` waits with `ping -n 4` instead of `timeout` (works when stdin is redirected).
- Python 3.12 via uv for the Accio server; dimensions multiples of 8 (1080 allowed); `media_state` minimal shape per spec 5.2 (untested with the loader, verify in Phase 5); Multi-Edit uploads to `input/minimax_h3/`, Inpaint/Outpaint to `input/accio/`.
- Dev-only npm warning: deprecated `glob@11.1.0` via `vite-plugin-pwa`/workbox (build-time only).

## Environment notes

- At the end of this session the user's ComfyUI on 8188 was **not running** (it was not stopped by me: only my own server processes and the bundled ComfyUI were stopped). Accio does not need it.
- The Phase 2 output file and the 2b output file are in each ComfyUI's own `output\AccioStudio\` folder.

## Open questions (user)

- (Answered 2026-10-07) Design direction approved as in "Approved design"; further edits welcome later.
- Remove/Move object presets (spec 6.4): confirm the intended input (red box burned into RGB + mask?). **Ask before Phase 5.**
- OK to make the first commit (and on which branch name)?

## How to run and test

```powershell
.\Install.bat                      # once; add  --models-from "<existing ComfyUI folder>"  to reuse its models
.\Run_Accio.bat                    # pick 1; starts bundled ComfyUI (8189) + Accio (http://127.0.0.1:7862); dev test page at /dev
env\Scripts\python.exe -m pytest tests -q
cd frontend; npm run dev           # Vite dev server, proxies /api to :7862
```

Dry-run any request without queueing: `POST /api/build` with `{"params": {...}}`.

## Approved design (Phase 3, approved 2026-10-07)

Reference prototype: `design/proposal.html` (static HTML, open in a browser; has a light-theme toggle and the reveal animation). It is the source of truth for tokens and layouts; the user approved it as a starting point and expects edits later. Nothing in the real UI is built yet. Not Z-Fusion's look by design (spec 6.1b).

**Direction: "Lamplight on ink".** Ink surfaces, parchment text, one gold accent. Gold only marks active / primary / progressing, never decoration. Image content is never tinted. Green/red only for success/error. Dark-first, light theme included.

**Tokens (CSS variables, mapped into Tailwind):**

| Token | Dark | Light |
|---|---|---|
| bg | `#0B0A0F` | `#F5F0E5` |
| surface | `#121118` | `#FBF8F1` |
| raised | `#1A1922` | `#EFE9DB` |
| overlay | `#24222E` | `#E6DFCD` |
| line / line-strong | `#2C2A37` / `#3D3A4B` | `#DDD5C1` / `#C9BFA6` |
| text / text-2 / text-3 | `#F1EADB` / `#B9B2A3` / `#8A8478` | `#1B1810` / `#554E3F` / `#756D5B` |
| gold (fill) | `#E8B04A`, hi `#F6CD7C` | `#D9992A`, hi `#E8B04A` |
| gold-text (small text) | `#E8B04A` | `#85560A` |
| on-gold (label on gold fill) | `#17120A` | `#17120A` |
| success / error | `#7FC79A` / `#EF7B6C` | `#2F7D4F` / `#B3392B` |

Radii 10 / 14 / 22 / pill. Three surface levels separated by 1 px hairlines. Line icons, 1.7 px stroke, 20-24 px (lucide-react), 44 px touch areas. Contrast ratios in the prototype are estimates: run a real contrast check in Phase 4 and fix anything under 4.5:1 (3:1 for large text / icons).

**Type:** Fraunces (variable, SOFT 100, wordmark / empty states / sheet titles only), Instrument Sans (UI, weights 400/500/600, 15 px base), JetBrains Mono (seeds, step counts). Self-host variable WOFF2, Latin subset, about 60 KB, `font-display: swap` (the prototype uses Google Fonts only for convenience). Scale 12/13/15/17/22/28/40. Sentence case everywhere.

**Wordmark / icon:** lowercase "accio" in Fraunces; the final "o" is an open ring (one 11-unit stroke with a gap, round caps) with a four-point gold spark entering it. The ring is the app icon (on an ink rounded square, inside the 80% maskable safe zone), loading spinner and completion flash. Add a monochrome icon variant. SVG is in the prototype (`#ring` symbol).

**Navigation:**
- Mobile: bottom tab bar Create / Edit / Gallery. Settings + connection (QR, tunnel URL, ComfyUI status) behind a gear in the top bar, no 4th tab. Edit sub-modes (Multi-edit / Inpaint / Outpaint) = segmented control in the top bar. Composer is a bottom sheet: collapsed = prompt + chips + Generate, drag up = Advanced.
- Desktop (>= 1024 px): three panes. Left 316 px = mode nav + composer (Generate pinned at the bottom of the pane); center = canvas (result viewer, compare slider, brush, outpaint handles) with a "this session" strip; right 272 px = queue above, history below (click to view, drag to a reference slot).
- One composer component for all modes: prompt, main-toggle chips (mobile) / toggles (desktop), Generate. Never covers the image. Advanced = sheet (mobile) / collapsible section (desktop).
- Desktop shortcuts: Ctrl+Enter generate, Esc cancel, `[` `]` brush size, Ctrl+Z undo, Space+drag pan, 1/2/3 switch Create/Edit/Gallery, left/right arrows on the compare slider.

**Screens in the prototype:** mobile (360x740): Create ready, Create generating, Advanced sheet, Multi-edit (9-slot tray, numbered, 1 = base with gold outline, "Prompt used" overlay), Inpaint (full-bleed canvas, floating pill toolbar), Outpaint (hatched canvas, four drag handles, live padding numbers), Gallery (3-col grid). Desktop (1180x700): Create Detailed mid-run, Inpaint, Multi-edit with before/after slider + Prompt used + seeds panel. Also described, not drawn: first-run empty state, setup-check screen (per-item found/missing + "Download missing models"), error cards (friendly text, Retry, Details without paths or traces).

**Motion:** CSS transitions/transforms only (150-250 ms ease-out), animate `transform`/`opacity`/`clip-path` never layout, no animation library in the first bundle. The summon reveal (1.1 s: ring of light opens from the centre while the blurred preview resolves) plays once per finished image for the job on screen only. `prefers-reduced-motion`: reveal becomes a 250 ms fade, shimmer stops. Progress/preview updates throttled to 10/s. Skeletons instead of spinners where layout is known.

**Decisions made in this phase:**
- Generate button label stays plainly "Generate" (spec: no spell names for modes); the summoning feel lives in the reveal and progress copy ("Summoning...").
- No stack additions beyond the spec baseline (React, Vite, Tailwind, lucide-react, Zustand).
- Aspect presets (spec 6.3, unverified with Krea2) stay as proposed there.
- Chips are 36 px tall visually, with 44 px hit areas via padding in the real build.

**Deviations / caveats:** the prototype uses gradients as image stand-ins and is not responsive between the phone and desktop frames (the real app switches at 1024 px). Prototype lives in `design/` and is not shipped (excluded from release packaging).

## Next (Phase 4: Create mode, short demo at the end)

Build the frontend foundation from the approved design (tokens as CSS variables + Tailwind, self-hosted fonts, app shell with the mobile tab bar and desktop three-pane layout, theme switch, shared composer component), then Create mode: Standard + Detailed, toggles, Advanced, LoRAs, live progress/preview/cancel in the result slot, results feed. Backend API already exists (Phase 2). Edit modes stay stubs until Phase 5; ask the spec 6.4 Remove/Move question before Phase 5.
