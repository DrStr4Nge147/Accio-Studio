# Accio Studio - progress

Read `APP_SPEC.md` first; this file records state, decisions and how to run. Last updated: 2026-10-07 (Phase 4).

## Status

| Phase | State |
|---|---|
| 1. Scaffold | **Done** |
| 2. Template engine | **Done** (structural parity 20/20) |
| 2b. Portable bundle | **Done** (see below) |
| 3. Design proposal | **Done, approved by user 2026-10-07** (see "Approved design" below; user: "a good start, we can always edit it") |
| 4. Create mode | **Done** (see "Phase 4 results"; awaiting the user's demo/test) |
| 5. Edit modes | **Next** (ask the spec 6.4 Remove/Move question first) |
| 6-8 | Not started |

Project root = `E:\AI_Softwares\ImageGenerator\AccioStudio`. Git: all work is on branch `dev`, **committed phase by phase directly on `dev` (user decision 2026-10-07: no feature branches, no new branches; this overrides APP_SPEC section 10's "feature branch")**. History: Phase 1+2, Phase 2b, Phase 3 design, Phase 4 Create. Commit at the end of each phase without asking. `main` is the default branch and is not used yet.

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

## Phase 4 results (Create mode, 2026-10-07)

Built the real frontend from the approved design and Create (Standard + Detailed) end to end.

**Verified on this PC (bundled ComfyUI 0.38.0 on 8189, real GPU, in the in-app browser):**
- Desktop (three panes) and mobile (375x812) layouts render; theme switch (dark/light/system) works; state persists across reload.
- Standard 512x512 job from the UI: queued, running with step X/8, live blurred preview, queue pane entry, finished, summon reveal played, image shown, appears in History / Recent.
- Detailed 576x384 job from the UI (mobile): "step N/8, pass 1 of 2" then "step N/4, pass 2 of 2", final image plus a "1st pass" image in the output strip, Details panel with all three seeds.
- `POST /api/build` accepted a Detailed request shaped exactly like the UI sends (overrides, turbo toggle, LoRA with `target`, upscale 1.25 gives node 158 = 1560x2080, `save_first_pass: false` removes node 160, seeds 11/22/33 recorded).
- `pytest tests -q`: **108 passed** (new: `create_defaults` test). `npm test` (vitest): **11 passed** (request building, validation, reuse round trip, LoRA grouping). `npm run build`: tsc clean; **initial JS 88 KB gzipped** (budget 200 KB), CSS 7 KB, fonts 133 KB (lazy, `font-display: swap`).
- `node scripts/check-contrast.mjs`: all token pairs pass in both themes (see deviations for the light-theme fixes).

**What exists (frontend, `frontend/src`):**
- `index.css`: tokens as CSS variables (dark + light) mapped into Tailwind, self-hosted fonts (`assets/fonts`, Latin subset, OFL licences alongside; Fraunces is the SOFT-axis build, 62 KB), summon / shimmer / sheet animations (transform, opacity, clip-path only; `prefers-reduced-motion` handled). Base resets are in `@layer base` (an unlayered `button { color: inherit }` had overridden Tailwind text colours).
- `api/` (fetch wrapper that surfaces the server's friendly error text, endpoints, WebSocket with auto-reconnect and a re-sync of jobs after every reconnect, binary preview frames to blob URL). `store/` (zustand: jobs, ui, health + catalog). `lib/` (aspects, LoRA grouping, ETA / pass helpers, share, media query).
- `components/`: shared `Composer` (dock on mobile, pane on desktop), `Settings` (theme + setup check: ComfyUI online/version, missing models/nodes, warnings), `HealthBanner`, `Sheet`, `ui/controls` (Chip, Toggle, Segmented, Slider, IconButton), `stage/` (RunningCard with in-place progress / preview / ETA / cancel, ResultView with download / share / reuse / details, error and cancelled card, empty state).
- `features/create/`: store (persisted to localStorage; stores only overrides of the workflow defaults), `params.ts` (UI state to request, validation, "reuse settings"), `actions.ts` (generate / cancel), AspectPicker, CreateControls (mobile chips, desktop toggles), CreateAdvanced (seed lock + 3 seeds, per-pass sampler, Turbo LoRA 1/2, upscale, save first pass, sharpen / T-Enhancer strength, Seed Variance preset + all node settings, stackable LoRAs). `features/history/` (queue, history, recent strip). `layout/` Desktop (>= 1024 px) and Mobile (tab bar, feed, full-screen viewer, Advanced sheet). Edit and Gallery tabs are plain "coming" screens.
- Server: `engine.create_defaults()` and `defaults` in `GET /api/catalog` (workflow defaults read from the templates, so the UI never hard-codes them; a test asserts the combo's variance node matches).
- Desktop shortcuts: Ctrl+Enter generate, Esc cancel, 1/2/3 switch tab.

**Decisions / deviations (Phase 4):**
- Light-theme token tweaks from the contrast check (approved palette otherwise untouched): `text-3` `#756D5B` to `#675F4D` (hint text on raised surfaces was 4.24:1); new `--gold-ui` (`#9C6708` in light, the same gold in dark) for non-text UI (switch, slider / progress fill, focus ring) because the light gold fill was 2.2:1; switch track colours darkened to reach 3:1. Gold fill, gold text and the on-gold label are unchanged. `design/proposal.html` was not updated to match.
- One job at a time from the composer: while any job is active the button is Cancel (no queueing a second job from the UI). The queue pane still lists any active jobs (e.g. from another device).
- Mobile: aspect chip, Advanced and everything beyond the chips live in the Advanced sheet (grab handle tap / swipe up, or the sliders button). While a job is on screen, mobile shows it full height (back arrow returns to the feed); idle shows a 2-column feed.
- "Reuse settings" and "Details" (seeds, copy) were pulled forward from later phases because they are cheap and make seed lock usable. "Send to Edit" waits for Phase 5.
- Retry on a failed job reuses its settings but draws new seeds.
- Seed Variance fine-tune only applies when the preset is Custom (node tooltip); the UI says so under "All settings".
- Aspect presets: 16:9 and 9:16 are the workflow's own sizes. 1:1 (1440x1440), 4:3 (1664x1248) and 3:2 (1760x1176) lost the "untested" hint on 2026-10-07 after a web check: no official ratio list exists (Krea repo: Turbo handles 1024-2048 px per side), but a community test of Krea 2 Turbo (note.com/truenorthai, one author, character sheets) found each of these ratios stable well above our 2.07 MP (1:1 to 6.0 MP, 4:3 to 3.2, 3:2 to 2.5; 16:9 only to 1.7 MP yet 1920x1080 works for the user, so those limits are scenario-specific) and a civitai test ran square 1.05-4.19 MP fine. 2:3 and 3:4 keep the hint ("portrait twin of a tested ratio"): no report covers them. Not verified by running them here.
- Added dev-only tooling: `vitest` for frontend logic, `scripts/check-contrast.mjs` (repeatable token check). New runtime dependency: `lucide-react` (spec baseline).

**Added after the first demo (user requests):** desktop control pane scrolls as one piece with slim scrollbars; browser auto-opens from `Run_Accio.bat` (`--open-browser`); blank canvas until something is generated or picked, and "Reuse settings" clears it; running jobs appear in the Recent strip; "Time taken" in Details; a ripple card + breathing bar during VAE decode (server reports the executing node class in `live.class`; the card stays in that look until sampling resumes); bubbles on the summon card; `Run_Accio.bat` starts ComfyUI with UTF-8 output and `--disable-auto-launch`; **zoom and pan on the canvas** (`components/stage/Zoomable.tsx`: wheel / pinch zoom toward the pointer, drag pan, double click or double tap toggles fit and 100% pixels, +/-/0 and arrow keys, zoom pill with a fullscreen viewer). **Hover highlights:** a `hover-wash` utility (faint wash of the text colour over any background, pointer devices only) on nav items, icon buttons, aspect buttons, chips, segmented options, collapsibles, thumbnails (border) and text buttons. The nav items (Create / Edit / Gallery) and the aspect buttons deliberately have no tooltips (user request). **Tooltips:** one app-wide `TooltipLayer` (`components/ui/Tooltip.tsx`) driven by `data-tip` attributes (hover with a short delay, keyboard focus, Esc hides; no wrapper elements); texts for the Create settings live in `features/create/tips.ts`, Seed Variance settings reuse the ComfyUI node's own tooltips, thumbnails show their prompt. Touch screens have no hover, so the mobile Advanced sheet also spells out Variance / Sharpen / T-Enhancer and the Detailed options in plain text. Dedicated tests for the tooltip were not written (checked in the in-app browser with synthetic events). Zoom is DOM-driven and was exercised with synthetic wheel / pointer events in the in-app browser only (no real touch device, no unit tests).

**Known issues / not done in Phase 4:**
- **No thumbnails yet:** history, feed and the recent strip load full-size PNGs lazily. Fine on this PC, heavy over a tunnel. Server-side WebP thumbnails and the virtualized gallery are Phase 6.
- **Service worker / PWA install not verified:** registration fails inside the in-app browser pane ("unknown error fetching script"; `sw.js` itself is served 200); not tried in Chrome. No app icons yet (needed for install). Phase 6.
- Not tested: batch > 1, T-Enhancer or LoRA runs on the GPU, Upscale 1.25-2x run, Reuse / Retry clicked in the browser (covered by unit tests and a `/api/build` dry run only), desktop widths other than 1280x800, a real phone, keyboard shortcuts clicked through, error paths (the ComfyUI-offline banner is implemented but not exercised), Cancel while running (it calls the Phase 2 endpoint tested earlier), the LoRA picker with real LoRAs applied.
- Wrong-family LoRA hint (spec 6.6) not implemented (not detectable from the API).
- Progress / preview updates are throttled server-side to 10/s; the UI does not throttle further.
- Contrast was computed on tokens only; text on image overlays (progress text on the dark gradient) was not measured.
- Starting ComfyUI from a Git Bash shell crashed on an emoji log line (cp1252 redirect); `Run_Accio.bat` is unaffected (worked in 2b). Set `PYTHONUTF8=1` if you launch it from bash.

## What exists (Phases 1-2b: backend and installer)

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
- (Answered 2026-10-07) Commits go directly on `dev`, one per phase, no new branches.

## How to run and test

```powershell
.\Install.bat                      # once; add  --models-from "<existing ComfyUI folder>"  to reuse its models
.\Run_Accio.bat                    # pick 1; starts bundled ComfyUI (8189) + Accio (http://127.0.0.1:7862); dev test page at /dev
env\Scripts\python.exe -m pytest tests -q
cd frontend; npm run dev           # Vite dev server, proxies /api to :7862
cd frontend; npm test              # vitest (frontend logic)
cd frontend; npm run build         # tsc + production build into frontend/dist (the server serves it)
node scripts/check-contrast.mjs    # design-token contrast check
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

## Next (Phase 5: Edit modes)

Multi-Edit (MiniMax upload, 9-slot tray), Inpaint (mask canvas, RGBA mask per spec 5.3), Outpaint (pad editor), enhancer "Prompt used" panel, presets, Send to Edit. **Ask the user the spec 6.4 Remove/Move question first.** Reuse the Phase 4 pieces: `Composer`, `Sheet`, `ui/controls`, `stage/` (add the before/after compare slider to `ResultView`), the jobs store and WebSocket. The Edit tab currently renders `features/edit/ComingSoon.tsx`; the Edit sub-modes become a segmented control in the mobile top bar (design). The server already supports all three Edit modes (`/api/upload?kind=media|image|mask`, `/api/jobs`).
