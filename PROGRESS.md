# Accio Studio - progress

Read `APP_SPEC.md` first; this file records state, decisions and how to run. Last updated: 2026-10-07.

## Status

| Phase | State |
|---|---|
| 1. Scaffold | **Done** |
| 2. Template engine | **Done** (structural parity 20/20) |
| 3. Design proposal | **Next. Stop for user approval before any UI work** |
| 4-8 | Not started |

Project root = `E:\AI_Softwares\ImageGenerator\AccioStudio` (`git init` done on branch `main`, **nothing committed yet**: ask the user before the first commit, and branch first).

## What exists

- `server/` FastAPI app (port 7862): `main.py` (routes, upload, WS), `engine.py` (template engine), `schemas.py` (request validation), `jobs.py` (queue/progress/reconcile), `history.py` (SQLite in `data/history.db`), `comfy.py` (ComfyUI client), `config.py`, `static/testpage.html` (dev page at `/dev`).
- `server/templates/` = copy of `comfy-templates/` (20 files, read-only data; a test asserts the copies match).
- `frontend/` Vite + React 19 + TS + Tailwind 4 + vite-plugin-pwa shell (one placeholder screen that calls `/api/health`). Real UI waits for Phase 3 approval. Build: 220 KB JS / 69 KB gzip.
- `Install.bat` (portable uv -> `bin\`, venv `env\` Python 3.12, requirements, `npm install` + build; `Install.bat nopause` for non-interactive), `Run_Accio.bat` (ComfyUI reuse-or-launch + poll up to 3 min, frontend self-heal, connection menu, starts server).
- `tests/` (90 tests), `scripts/export-templates.js|.md`, `scripts/compare_exports.py`.

## Engine (APP_SPEC 4.3) in one paragraph

`engine.build(params, catalog)` picks the template, deep-copies it from cached text, strips `Image Comparer (rgthree)` + `PixaromaRunTimer` (asserts no dangling link), overwrites only the listed input values (raising `BuildError` on template drift), injects LoRA entries before the add-lora marker, deletes node `160` when "Save first-pass" is off, and sets `158` from the chosen size x upscale (rounded half-up to a multiple of 8 only when factor != 1). Seeds are random 0..2^53-1 unless supplied; all used seeds are returned and stored. Sampler/scheduler/LoRA/Seed-Variance values are validated against live `/object_info` + `/models/loras` (`Catalog`). Preset LoRAs are plain booleans (`head_swap`, `body_swap`, `remover`, `mover`, `outpaint_lora_on`).

API: `GET /api/health` (ComfyUI online, missing models/nodes), `GET /api/catalog`, `POST /api/build` (dry run, nothing queued), `POST /api/jobs`, `GET /api/jobs[/{id}]`, `POST /api/jobs/{id}/cancel`, `GET /api/jobs/{id}/image/{i}` (proxied `/view`; filenames come from our history only), `POST /api/upload?kind=media|image|mask` (magic-byte check, 40 MB cap, server-generated name, not re-encoded; `mask` requires RGBA PNG), `GET /api/queue`, `WS /api/ws` (snapshot, job updates, throttled binary preview frames with ComfyUI's 8-byte header).

## Verification results (Phase 2)

- **Structural parity (spec 7.1), all 20 templates: PASS.** Method: re-exported each config from ComfyUI's own frontend (`app.graphToPrompt()` per spec 4.5, nothing queued) from the current workflow files, then `scripts/compare_exports.py`: **20/20 identical** to the shipped templates. Then `tests/test_structural_parity.py`: for each template the engine output differs from the stripped template only at the 4.3 patch points, both with minimal params and with every option set explicitly to its documented default.
- Live `/object_info` check: every class and plain input name in all 20 stripped templates exists (`tests/test_live_object_info.py`; skipped if ComfyUI is offline).
- `pytest tests -q`: **90 passed**.
- End-to-end: one Standard 512x512 job queued, progress followed, finished, 1 PNG served through the image proxy; a second job cancelled mid-run; WS snapshot and job events received.
- **Not verified:** `Run_Accio.bat` launching ComfyUI when it is not running; ComfyUI-offline, missing-model, validation-error and node-error paths beyond code review (Phase 8); pixel parity (GPU, Phase 8); Detailed/Edit modes were only built, never queued; Remove/Move presets; Pixel Drift + Manual size.

## Decisions and deviations

- **Server binds `127.0.0.1` by default** (spec 9.2 says local mode binds `0.0.0.0`): no login until Phase 7, `/api/*` is unauthenticated. LAN is opt-in via `"lan_access": true` in `settings.json`. Revisit in Phase 7.
- `--tunnel cloudflare|zrok` accepted but falls back to local (Phase 7).
- Python 3.12 via uv (spec says 3.10+).
- Uploads: Multi-Edit goes to `input/minimax_h3/`, Inpaint/Outpaint to `input/accio/`.
- `media_state` uses the minimal item shape from spec 5.2 (`kind`, `file`, `name`); whether the loader needs the extra fields is untested (verify in Phase 5).
- Dimensions must be multiples of 8 (1080 allowed); range 64..8192.
- Export procedure gotcha: the `CONTROLNET` group sits inside `MULTI-EDIT`'s bounds, so it must be set to bypass after the main group (documented in `scripts/export-templates.md`).
- Dev-only npm warning: deprecated `glob@11.1.0` via `vite-plugin-pwa`/workbox (build-time only).

## Open questions (user)

- Remove/Move object presets (spec 6.4): confirm the intended input (red box burned into RGB + mask?). **Ask before Phase 5.**
- OK to make the first commit (and on which branch name)?

## How to run and test

```powershell
.\Install.bat
.\Run_Accio.bat                    # pick 1; http://127.0.0.1:7862 ; dev test page at /dev
env\Scripts\python.exe -m pytest tests -q
cd frontend; npm run dev           # Vite dev server, proxies /api to :7862
```

Dry-run any request without queueing: `POST /api/build` with `{"params": {...}}`.

## Next (Phase 3, stop for approval)

Design proposal per spec 6.1b: palette, type, wordmark/icon direction, mobile + desktop mockups (HTML prototype), navigation model. Do not copy Z-Fusion's look. Wait for approval before Phase 4.
