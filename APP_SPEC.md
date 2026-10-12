# Accio Studio — Build Spec

A responsive PWA (React) for **image generation (Krea2)** and **image editing (Qwen Image Edit 2.1)** that uses the user's existing local ComfyUI purely as a backend. App name: **Accio Studio** ("Accio" is the Summoning Charm). The two modes are named plainly **Create** and **Edit**; do not use spell names for modes.

This document is self-contained. It was written after a full audit of the user's ComfyUI workflows, models, and custom nodes. Read all of it before writing code.

**Path placeholders.** Reference locations on the author's machine are written as `<COMFYUI_REF>`, `<ZFUSION_REF>`, `<WORKFLOWS_DIR>` and `<INSTALLER_REF>`. They are only needed for re-exporting templates (§4.5), re-running GPU parity tests (§7.2) and reusing existing models (§11.4); the app itself never depends on them. The author's real values live in the git-ignored `LOCAL_PATHS.md` (absent in a fresh clone).

---

## 0. Non-negotiable rules

1. **Output parity with ComfyUI.** Given the same inputs and seeds, the app must produce the same images the user gets when running the same workflow groups in ComfyUI. No "close enough".
2. **Never rebuild the graphs by hand.** The app uses the API-format templates in `comfy-templates/` (exported by ComfyUI's own frontend, see §4). The backend only changes *input values* and removes the *output-only* nodes listed in §4.4. It never adds, rewires, or re-derives nodes.
3. **Accio Studio ships its own bundled, portable ComfyUI** (§11), installed by Accio's `Install.bat` into the app folder and launched by Accio. **The user's existing ComfyUI at `<COMFYUI_REF>` is a reference only: never edit it, install into it, or depend on it at runtime.** Exception: on the user's own PC the installer may *read* its `models` folder (via `extra_model_paths.yaml` in the bundled ComfyUI) to avoid re-downloading ~37 GB (§11.4). Talk to ComfyUI over HTTP/WebSocket only. Uploads go through ComfyUI's `/upload/image`.
4. **Build in a separate project folder** (the user will provide or create it). Copy `comfy-templates/` into it (e.g. `server/templates/`).
5. **Follow the user's existing app as the pattern reference:** `<ZFUSION_REF>` (a Flux Klein mobile web UI the user built: `app\mobileui\mobile_app.py` + `app\mobileui\frontend\`, launched by `Run_Mobile.bat` / `Run_Mobile-zrok-only.bat`). Use it only as a reference for **how the app is launched and shared** (one-click `.bat` launchers, connection menu, tunnels, QR codes; see §9) and as a known-good stack. **Do not copy its UI/UX, visual design, or code structure.** The user wants a full overhaul (§6.1b). **Do not copy its security shortcuts** (§5.5). Read it, but don't modify it.
6. User's global rules apply: Windows 10, PowerShell 5.1, ask before creating/modifying `.env` files, no secrets in source, no AI attribution in commits/docs, branch before committing, and propose a plan before large changes.

---

## 1. Environment (verified 2026-10-06)

| Item | Value |
|---|---|
| ComfyUI | 0.38.0, portable, frontend 1.53.6, `http://127.0.0.1:8188` |
| Launch args | `--windows-standalone-build --disable-cuda-malloc --reserve-vram 1` |
| GPU | NVIDIA RTX 2060 6 GB. The workflows are already tuned for it, so do **not** add VRAM limits or block anything (non-blocking hints at most) |
| Python | 3.13 embedded, torch 2.14 + cu130 |
| Typical timing | Krea combo ≈ 3–4 min (8 steps ≈ 14 s/it + 4 steps). Plan the UX around long jobs |
| Source workflows | `<WORKFLOWS_DIR>\KREA2_ULTRA_WORKFLOW-V3_fixed.json` and `...\QWEN-IMAGE-EDIT-21-TURBO_ULTRA_WORKFLOW_autoenhancer.json` (the non-`_fixed`/non-`autoenhancer` files are the user's originals, reference only) |

---

## 2. Scope

### In scope
| App mode | Workflow / group |
|---|---|
| **Create → Standard** | Krea2: `TEXT TO IMAGE` (+ sub-groups `TXT SEED VARIANCE`, `TXT T-Enhancer`, `TXT SHARPEN`) |
| **Create → Detailed** | Krea2: `TWO TIMES COMBO` (+ `COMBOS VARIANCE`, `COMBOS T-Enhancer`, `COMBOS SHARP`, `COMBOS IMAGE RESIZE`) |
| **Edit → Multi-Edit** | Qwen: `MULTI-EDIT` (+ `RESIZE IMAGE - BYPASS TO USE ORIGINAL RESOLUTION`) |
| **Edit → Inpaint** | Qwen: `INPAINTING` |
| **Edit → Outpaint** | Qwen: `OUTPAINTING` |

### Out of scope (do not build)
Krea prompt builders (`TEXT/IMAGE/COMBO PROMPT BUILDER`), Krea image-to-image, Krea inpaint/outpaint/pseudo-edit/identity mode, Qwen text-to-image, Qwen **ControlNet**, model downloading/management.

---

## 3. Models and custom nodes

### Required models (all present and verified complete)
| File | ComfyUI folder | Used by |
|---|---|---|
| `krea2_turbo_int8_convrot.safetensors` | diffusion_models | Create |
| `qwen3vl_4b_fp8_scaled.safetensors` | text_encoders | Create |
| `qwen_image_vae.safetensors` | vae | Create |
| `krea2_turbo_lora_rank_64_bf16.safetensors` | loras | Detailed (both passes, 0.2) |
| `Qwen-Image-2.1-viggle-turbo-v0.3-6step-int8_convrot.safetensors` | diffusion_models | Edit |
| `qwen3vl_8b_int8_convrot.safetensors` | text_encoders | Edit + Prompt Enhancer |
| `texture_fix_vae_for_qwen_image_2.1_bf16.safetensors` | vae | Edit |
| `qwen-image-2.1-outpaint-v2.safetensors` | loras | Outpaint |

### Optional (preset LoRAs, off by default)
`bfs_head_v1.1_qwen_2.1.safetensors`, `bfs_body_swap_v1.0_qwen_2.1.safetensors` (Multi-Edit), `Qwen-Image-2.1-Object-Remover-Bbox-turbo-4000.safetensors`, `Qwen-Image-2.1-Object-Mover-Bbox-turbo-4000.safetensors` (Inpaint).

The app does **not** download models. On startup, check via ComfyUI (`GET /models/<folder>` or `/object_info`) that the required files exist and show a clear setup screen if any are missing.

### Custom node packs the templates need (installed)
rgthree-comfy, ComfyUI-KJNodes, ComfyUI_essentials, ComfyUI-Krea2T-Enhancer, ComfyUI-RBG-SmartSeedVariance, ComfyUI-AusBoss, ComfyUI-PixelDriftFix, ComfyUI-Fantastic-MiniMaxH3-PromptBuilder. Everything else is ComfyUI core (TextEncodeQwenImage21, TextGenerate, QwenImage21Cache, ComfySwitchNode, ComfyMathExpression, etc.).

---

## 4. Templates (the core of parity)

### 4.1 Files (`comfy-templates/`, 20 files)
| File | Use |
|---|---|
| `krea_t2i__var{0|1}_tenh{0|1}_sharp{0|1}.json` (8) | Create Standard; pick by the 3 toggles |
| `krea_combo__var{0|1}_tenh{0|1}_sharp{0|1}.json` (8) | Create Detailed; pick by the 3 toggles (Image Resize always on) |
| `qwen_multiedit__resize1.json` / `__resize0.json` | Multi-Edit: resize to 1 MP / keep original resolution |
| `qwen_inpaint.json` | Inpaint |
| `qwen_outpaint.json` | Outpaint |

These are ComfyUI **API-format** prompts (`{ nodeId: { class_type, inputs } }`) produced by the ComfyUI frontend's own `app.graphToPrompt()`. Subgraphs are flattened (ids like `"833:828"`), bypassed nodes are removed with their passthroughs rewired, muted nodes are dropped, Set/Get nodes are resolved, and rgthree LoRA entries are serialized. **Treat them as read-only data.** Deep-clone per job.

They contain stale example values (old prompts, filenames, seeds). The backend overwrites every user-facing value listed in §4.3.

### 4.2 Toggle → template selection
- A **group-bypass** toggle selects a different template: TXT/COMBOS Variance, T-Enhancer, Sharpen, and Qwen Resize.
- A **widget** toggle patches a value: Enhancer, Pixel Drift, Manual size, LoRA on/off, invert mask, fix edge halo.
- **Removing an output node** is used for "Save first-pass image".

### 4.3 Patch points (node id → input)

**Create Standard (`krea_t2i__*`)**
| What | Node.input | Default |
|---|---|---|
| Prompt | `143.value` | — |
| Seed (main) | `832.seed` | random |
| Seed Variance seed (only if var1) | `281.seed` | random (independent) |
| Width / Height / Batch | `833:829.width/.height/.batch_size` | 1080 / 1920 / 1 |
| Steps / CFG / sampler / scheduler / denoise | `833:828.*` (`seed` there is a link to 832, so leave it) | 8 / 1 / er_sde / simple / 1 |
| Sharpen strength (if sharp1) | `141["method.strength"]` (method `rcas`) | 0.75 |
| T-Enhancer strength (if tenh1) | `146.strength` | 1 |
| Seed Variance params (if var1) | `281.*` (preset `🌿 Balanced`, fine_tune 50, model_type `📸 Krea2 (SingleStream)`, …) | as template |
| User LoRAs | `82` add `lora_N` (model only; this loader has no clip input) | none |
| Output | `SaveImage 12` (set `filename_prefix`, e.g. `AccioStudio/create`) | |

**Create Detailed (`krea_combo__*`)**
| What | Node.input | Default |
|---|---|---|
| Prompt | `278.value` | — |
| Width / Height / Batch | `244.value` / `245.value` / `246.value` | 1920 / 1080 / 1 |
| Pass-1 KSampler | `273.*` (seed, steps 8, cfg 1, er_sde, simple, denoise 1) | seed random |
| Pass-2 KSampler | `265.*` (seed, steps 4, cfg 1, euler, simple, denoise 0.3) | seed random |
| Resize before refine | `158.width/.height` = **chosen W/H × upscale factor** (method `keep proportion`, lanczos, `always`) | factor 1 |
| Turbo LoRA pass 1 / pass 2 | `180.lora_1` / `174.lora_1` (`on`, `strength`) | on, 0.2 |
| Seed Variance seed (if var1) | `282.seed` (feeds **both** passes) | random |
| Sharpen (if sharp1) | `193["method.strength"]` | 0.75 |
| T-Enhancer (if tenh1) | `215.strength` | 1 |
| User LoRAs | add to `180` and/or `174` (default: both) | |
| Outputs | `SaveImage 183` = final; `SaveImage 160` = first-pass image (delete node `160` when "Save first-pass" is off) | |

Always set `158` from the chosen size. The original workflow hard-codes 1920×1080 there, and `keep proportion` fits the image *inside* that box. A portrait size would then be shrunk to about 608×1080 before pass 2. That bug must never reach users.

**Multi-Edit (`qwen_multiedit__*`)**
| What | Node.input | Default |
|---|---|---|
| Prompt | `279.value` | — |
| Images 1–9 | `296.media_state` (see §5.2) | image 1 = base |
| Seed / steps / cfg … | `36.*` | random / 6 / 1 / euler / simple / 1 |
| Prompt Enhancer | `291:282.value` | true |
| Pixel Drift Fix | `278:39.switch` (method `flat_4_points`, mesh 400 in `278:38`) | true |
| Manual output size | `341:340.switch`; size in `341:339.width/.height/.batch_size` | false; 1024×1024 |
| Base image megapixels (resize1 only) | `16.megapixels` | 1 |
| Reference megapixels img2…img9 | `298:302`, `298:306`, `298:310`, `298:314`, `298:318`, `298:322`, `298:326`, `298:330` `.megapixels` | 1 each |
| Head Swap / Body Swap LoRA | `24.lora_1` / `24.lora_2` `.on` | off |
| User LoRAs | `24` add `lora_N` | |
| Prompt actually used | `PreviewAny 280` output text | |
| Output | `SaveImage 45` | |

**Inpaint (`qwen_inpaint`)**
| What | Node.input | Default |
|---|---|---|
| Prompt | `200.value` | — |
| Image + mask | `250.image` = uploaded RGBA PNG (see §5.3) | |
| Seed … | `60.*` | random / 6 / 1 / euler / simple / 1 |
| Prompt Enhancer | `210:208.value` | true |
| Crop settings | `267:266.*` (context_factor 1.4, blend_pixels 16, output_multiple 32, mask_grow 8, mask_blur 0, **invert_mask** false, context_pixels 64, target_megapixels 1, bilinear) | |
| Fix edge halo / seam | `267:262.fix_edge_halo` / `.seam` | false / `classic` |
| Remover / Mover LoRA | `213.lora_1` / `213.lora_2` `.on` | off |
| Prompt actually used | `PreviewAny 215` | |
| Output | `SaveImage 64` | |

**Outpaint (`qwen_outpaint`)**
| What | Node.input | Default |
|---|---|---|
| Prompt | `253.value` | `Outpaint the image: replace the solid gray areas with a seamless continuation of the scene, keeping the existing picture unchanged.` |
| Image | `71.image` (uploaded filename) | |
| Padding px | `71.pad_left/.pad_top/.pad_right/.pad_bottom` | user-chosen |
| Fill mode | `71.mode` ∈ `color`, `edge`, `edge pixel`, `pillarbox blur`, `mirror`; `71.fill_color`, `71.backdrop_blur` | `color`, `#808080`, 0.5 |
| Feather / canvas multiple / target MP | `71.feather` / `.canvas_multiple` / `.target_megapixels` | 32 / 32 / 1.5 |
| Seed … | `74.*` | random / 6 / 1 / euler / simple / 1 |
| Fix edge halo / seam | `259:258.fix_edge_halo` / `.seam` | false / `blend in` |
| Outpaint LoRA v2 | `252.lora_1.on` / `.strength` | on / 1 |
| Output | `SaveImage 78` | |
| (No prompt enhancer in this group, by design.) | | |

**LoRA entry format (rgthree Power Lora Loader):** `"lora_N": {"on": true, "lora": "<path relative to models/loras>", "strength": 1.0}`. Keep `PowerLoraLoaderHeaderWidget` and `"➕ Add Lora": ""` exactly as they are in the template.

### 4.4 Nodes to delete before queueing (output/UI-only; deleting them cannot change any other output)
- `Image Comparer (rgthree)`: `188` (combo), `46` (multi-edit), `65` (inpaint), `79` (outpaint). They hold stale temp-image URLs.
- `PixaromaRunTimer`: `842` (Krea), `342` (Qwen).

Write the deletion generically: drop nodes whose `class_type` is in that list, then assert that no remaining input references a deleted id.

### 4.5 Re-exporting templates (maintenance)
If the user changes a workflow or updates ComfyUI or custom nodes, regenerate the templates with ComfyUI's frontend, never by hand. Procedure used originally (run in a browser tab at `http://127.0.0.1:8188` via devtools or automation; nothing is queued):
1. `await app.loadGraphData(workflowJson, true, true, null)`. A `DataCloneError` thrown afterwards by workflow-tab bookkeeping is harmless. Verify the node count matches the file.
2. Group membership = node whose **top-left `pos`** lies inside the group's `_bounding` (`recomputeInsideNodes()` did not work headless).
3. Set every group's nodes to mode 4 (bypass). Then set the wanted group to 0, the prompt-builder groups to 2 (mute), and sub-group toggles to 0/4. **When setting a node's mode, also set it recursively on `node.subgraph.nodes`**, as rgthree's group toggles do. Without this, the combo export silently loses its subgraph nodes.
4. `(await app.graphToPrompt()).output` gives the template JSON.

Ship this as a documented maintenance script (e.g. `scripts/export-templates.md` + JS snippet), and re-run the parity tests afterwards.

---

## 5. Backend

### 5.1 Stack and shape
- **Python + FastAPI + uvicorn** (same as Z-Fusion's `mobile_app.py`), using `httpx` and `websockets` for ComfyUI. It serves the built React app (`frontend/dist`, mounted last so `/api/*` routes win), a REST + WebSocket API, and the proxy to ComfyUI. One origin and **one port, `7862`** (Z-Fusion uses 7861, so both can run at once). Local, LAN, Cloudflare Tunnel and zrok all point at that port.
- Python environment: a project-local venv created with portable `uv`, like Z-Fusion's `Install.bat` (Python 3.10+). It must **not** use or modify ComfyUI's `python_embeded`.
- ComfyUI URL is configurable (default `http://127.0.0.1:8188`). The browser **never** talks to ComfyUI directly.
- ComfyUI endpoints used:
  - `POST /prompt` (`{prompt, client_id}`)
  - `GET /ws?clientId=` (events: `status`, `execution_start`, `executing`, `progress`, `executed`, `execution_error`, `execution_interrupted`)
  - `GET /history/{prompt_id}`
  - `GET /view?filename=&subfolder=&type=`
  - `POST /upload/image` (multipart: `image`, `subfolder`, `type=input`)
  - `POST /interrupt`
  - `POST /queue` (delete)
  - `GET /object_info`
  - `GET /models/loras`
- Relay progress to app clients over the app's own WebSocket. Show the current node and step X/Y, plus a live preview if ComfyUI sends preview images (binary frames).
- Persist history server-side (SQLite or JSON files): mode, all parameters, **every seed used**, template name, ComfyUI prompt_id, output filenames, and the "prompt used" text. History is shared across devices. Reading the images goes through `/view` via the backend.
- The ComfyUI queue is shared with the user's own ComfyUI use, so show the queue position.

### 5.2 Multi-Edit images (keep the MiniMax loader)
The app **must keep** `MiniMaxH3MediaLoader` (`296`) and `MiniMaxH3ReferenceSplitter` (`297`); do not replace them with `LoadImage`. The loader applies EXIF transpose + RGB conversion. The splitter returns `None` for empty slots, which the downstream "Reference Image Sizes" switches rely on.
- Upload each image via `POST /upload/image` with `subfolder=minimax_h3`, `type=input`, and a server-generated unique filename.
- `media_state` = JSON string of a list, in order (index 0 = image 1 = base):
  `[{"kind":"picture","file":"minimax_h3/<filename> [input]","name":"<original name>"}, ...]`, with 1–9 items.
- The output size follows image 1 unless Manual size is on.
- Prompts can refer to `<image1>`, `<image2>` … (see the presets in §6.4).

### 5.3 Inpaint mask format (must match ComfyUI's mask editor)
`LoadImage` derives the mask from the **alpha channel** (`mask = 1 − alpha`). Upload a **PNG, RGBA, original RGB untouched, alpha = 0 where the user painted, 255 elsewhere**, at the original image resolution. Never re-encode or resize the RGB. Verify against a mask saved by ComfyUI's MaskEditor during parity testing.

### 5.4 Seeds
ComfyUI's "randomize" happens in its browser UI, not the server, so the app generates seeds itself: random 0…2^53−1 unless the seed is locked. Record every seed (Krea: `832` + `281`; combo: `273` + `265` + `282`; Qwen: KSampler). "Reuse" from history restores all of them.

### 5.5 Security (the app is reachable from the internet via Cloudflare/zrok)
- Login required for everything except the login page and static assets. Use a single-user password, hashed server-side with a slow KDF (`hashlib.scrypt` with a random salt), set on first run through a setup screen and stored in the app's settings file (ask the user before creating `.env`).
- **Do not copy these Z-Fusion patterns:**
  - default `admin/admin` credentials
  - a fixed default token (`zfusion-auth-token-123`)
  - client-side SHA-256 "hashing" (the hash simply becomes the password)
  - a token that never expires
  - `CORS allow_origins=["*"]`
  - returning raw exception text (`str(e)`, provider responses) to the client

  Instead: there is no default password (forced setup on first run), a random session token per login with expiry and logout, sessions are invalidated when the password changes, and comparisons are constant-time.
- Session in an httpOnly, `Secure`, `SameSite=Lax` cookie. Rate-limit login. WebSocket upgrade also checks the session.
- Same-origin only, no permissive CORS. Validate every request body (types, ranges, enums against the lists in §4.3). Never pass client strings into node inputs except prompt text and validated filenames/LoRA names. A LoRA name must exist in ComfyUI's `/models/loras` list.
- Uploads: max size (e.g. 40 MB), check magic bytes (PNG/JPEG/WebP), server-generated filenames. Do not re-encode (parity).
- Never expose ComfyUI errors, paths, or stack traces raw. Map them to friendly messages and log details server-side.
- Bind to `127.0.0.1` by default (tunnels connect locally). LAN access (`0.0.0.0`) is an explicit config option.
- ComfyUI stays bound to localhost and is never tunneled.

---

## 6. Frontend

### 6.1 Stack
**Baseline:** React + Vite + Tailwind CSS + lucide-react + `vite-plugin-pwa` (`registerType: 'autoUpdate'`). This is the stack the user already runs in Z-Fusion. Swap any piece if a better-performing option clearly fits, and justify it briefly. Use TypeScript. Use animation (CSS transitions first; framer-motion or similar only where it earns its weight) without hurting frame rate. The service worker caches the app shell only, never `/api`, WebSocket traffic or result images. Use the Vite dev proxy `/api` → `http://localhost:7862` for development. Structure the code by feature/mode with small components; no giant single-file pages.

### 6.1b Design direction: a full overhaul, not a Z-Fusion reskin
The user explicitly wants an **overhaul**: Accio Studio must **not look or feel like Z-Fusion**. Z-Fusion (`app\mobileui\assets\z-fusion-mobileui.jpg`) shows the *level* the user is used to (dark, mobile-first, one-tap generate). Beat it with a fresh design language, new layouts and better interaction. Do not reuse its colors, gradient, typography, wordmark style, card shapes, button styles, or screen composition.

**Design goals:**
- **Fresh identity.** Design a new visual language for "Accio" (summoning): its own palette (e.g. warm gold/amber light on deep ink, used sparingly), typography, iconography, wordmark and app icon. Pick one coherent direction and apply it everywhere. Dark-first, with a light theme.
- **Content first.** The image is the hero. Chrome stays minimal and gets out of the way while viewing results.
- **Task-shaped layouts** built around what each mode needs, rather than one generic card + button screen:
  - **Create:** a prompt-centric composer, with results streaming into a feed or grid beneath or beside it.
  - **Multi-Edit:** a reference tray (up to 9 numbered slots) plus a canvas with the result.
  - **Inpaint:** a full-bleed canvas with a floating brush toolbar.
  - **Outpaint:** a canvas with drag-to-extend edges.
- **One composer pattern** shared across modes (prompt + main toggles + Generate), docked at the bottom on mobile and in a side panel on desktop. It never covers the image.
- **Progressive disclosure.** Main toggles are visible; Advanced sits in a sheet/drawer. Presets are one tap.
- **Live, in-place feedback.** Progress, step X/Y, live preview and cancel appear where the result will appear. The "summon" reveal animation is short and tasteful and respects reduced motion.
- **Quality bar:**
  - sentence-case labels, clear type hierarchy;
  - WCAG AA contrast; touch targets ≥ 44 px;
  - safe-area insets; one consistent surface/elevation system;
  - empty, loading and error states designed (not afterthoughts);
  - keyboard shortcuts on desktop (e.g. Ctrl+Enter to generate, `[`/`]` brush size).
- **Desktop and mobile are designed separately** (§6.2): desktop is a real multi-pane workspace; mobile is thumb-first with gestures.

Before coding the UI, produce a short design proposal for the user to approve: palette, type, the key screens for mobile and desktop as simple mockups (an HTML prototype or images), and the navigation model.
### 6.1a Performance and smoothness (required)
The app must feel instant on a mid-range phone over a tunnel:
- **Bundle:** route/mode-level code splitting. Lazy-load the heavy editors (mask brush canvas, outpaint editor) and the gallery. Initial JS ≲ 200 KB gzipped. No heavy UI kits.
- **Images:**
  - The backend serves **thumbnails** (WebP, e.g. 384 px and 1024 px) for the gallery and history, generated once and cached on disk. Full-resolution images load only when opened or downloaded.
  - Thumbnails are for display only; generation inputs and outputs are never altered (parity).
  - Use `loading="lazy"`, explicit width/height (no layout shift), and HTTP caching headers for immutable outputs.
- **Gallery:** virtualized list/grid, so hundreds of items stay smooth. Infinite scroll with paged API.
- **Canvas (mask and outpaint):**
  - pointer events with `touch-action: none`;
  - paint on a canvas via `requestAnimationFrame`, not React state per stroke;
  - pinch-zoom/pan on the GPU (CSS transforms), with undo/redo;
  - build the RGBA mask PNG off the main thread (`OffscreenCanvas` or a worker) where supported.
- **State:** a lightweight store (e.g. Zustand) with selectors, so progress updates re-render only the progress UI. Throttle WebSocket progress and preview updates to ≤ 10 per second in the UI.
- **Uploads:** show local previews immediately (`URL.createObjectURL`). Upload in the background with progress. Avoid re-encoding (parity).
- **Network over tunnels:**
  - Compress JSON (gzip/br).
  - Keep one WebSocket with auto-reconnect and resume (re-fetch the job state after reconnect).
  - Lost connections never lose a running job: jobs live on the server, and the UI re-attaches.
- **Feel:** 60 fps scrolling and gestures. Skeleton states instead of spinners where possible. Respect `prefers-reduced-motion`. Lighthouse PWA/performance checks on mobile should pass with no major issues.

### 6.2 Layouts (distinct designs, not a shrunk desktop)
**Desktop (≥1024 px):** three panes.
- Left: mode switch (Create / Edit) and controls.
- Center: canvas/result with a before/after compare slider (Edit), mask brush and outpaint handles.
- Right: history gallery and queue.

**Mobile:**
- Full-screen result or canvas.
- Bottom sheet holding prompt + main toggles; swipe up for Advanced.
- Bottom tab bar: Create / Edit / Gallery.
- Touch mask painting with pinch-zoom/pan; swipe through history.
- Camera/gallery picker for uploads; Web Share and download for results.

**Everywhere:**
- Big Generate button, live progress, cancel.
- "Send to Edit" on any result.
- "Reuse settings" from history.
- Professional, clean, dark-first, with a light theme.

### 6.3 Controls: main vs Advanced (defaults = workflow values)
**Create**
- Main:
  - prompt
  - Standard / Detailed
  - aspect presets
  - count
  - Seed Variance (ON), T-Enhancer (OFF), Sharpen (ON). In Detailed, these map to the COMBOS groups with the same defaults.
- Advanced:
  - seed + lock
  - steps / CFG / sampler / scheduler / denoise (per pass in Detailed)
  - sharpen and T-Enhancer strengths
  - Seed Variance preset and params
  - Detailed only: Turbo LoRA pass 1 / pass 2 (on, 0.2 each), Upscale before refine (1×, 1.25×, 1.5×, 2×; default 1×), Save first-pass image (ON)
  - LoRAs
- Size defaults:
  - Standard 1080×1920, Detailed 1920×1080.
  - Other presets should keep about the same pixel count (≈2.07 MP), multiples of 16. **Proposed, unverified with Krea2:** 1:1 1440×1440, 4:3 1664×1248, 3:4 1248×1664, 3:2 1760×1176, 2:3 1176×1760. Plus custom.

**Multi-Edit**
- Main:
  - up to 9 image slots, reorderable and numbered (1 = base)
  - prompt
  - Prompt Enhancer (ON)
  - Keep original resolution (OFF = resize to 1 MP, i.e. `resize1`)
  - Pixel Drift Fix (ON)
  - presets
- Advanced:
  - seed / steps / CFG
  - Manual output size (OFF; 1024×1024)
  - base and per-reference megapixels
  - LoRAs
- No limit on image count or size (the user's setup is tuned); soft hints at most.
- Untested risk: Pixel Drift Fix with Manual size ON (output size ≠ image 1). Test it. If it errors or warps, auto-disable Pixel Drift when Manual size is on and show a note.

**Inpaint**
- Main: image, brush/eraser/size, prompt, Prompt Enhancer (ON), presets.
- Advanced: invert mask, mask grow, context factor, blend pixels, fix edge halo, seed/steps, LoRAs.

**Outpaint**
- Main: image, per-side padding (drag handles + numeric), prompt prefilled with the default.
- Advanced: fill mode, feather, target MP, fix edge halo, Outpaint LoRA on/strength, seed/steps, LoRAs.

**All Edit modes:** a "Prompt used" panel shows the enhancer's rewritten prompt (from PreviewAny) with "copy to prompt".

### 6.4 Presets (one tap = enable LoRA + fill prompt; from the user's workflow notes)
- **Head Swap** (Multi-Edit, `24.lora_1` on, needs image 1 + image 2): `head_swap: start with <image1> as the base image, keeping its lighting, environment, and background. remove the head from <image1> completely and replace it with the head from <image2>, strictly preserving the hair, eye color, nose structure from <image2>. copy the direction of the eye, head rotation, micro expressions from <image1>, high quality, sharp details, 4k`
- **Body Swap** (Multi-Edit, `24.lora_2` on): `body_swap: start with <image1> as the base image, keeping its lighting, environment, and background. replace the body from <image1> with the body from <image2>, strictly preserving the clothing, body shape and proportions from <image2>. strictly replicate the exact pose, arm positions, leg positions, hand gestures, head rotation, eye direction and micro expressions from <image1>`
- **Remove Object** (Inpaint, `213.lora_1` on): `Remove the red highlighted object from the scene`
- **Move Object** (Inpaint, `213.lora_2` on): `Move the object highlighted in the red box to the location indicated by the other red box in the scene.`

**Open question (ask the user before building):** the Remove/Move LoRAs expect red boxes drawn into the image. The workflow does not show how the user combines that with the inpaint mask. Confirm the intended input (red box burned into RGB + mask over the area?) before implementing these two presets.

### 6.5 Prompt guidance (show as placeholder/help text)
- Inpaint and Edit: direct instructions with active verbs (replace, change, add, remove, transform, preserve, match, keep). State what changes, what to preserve, and to match lighting, perspective and style.
- Outpaint: describe what continues into the padded area; the default prompt works as-is.

### 6.6 LoRAs
- The list comes from ComfyUI (`/models/loras`), refreshed each time the picker opens.
- Each entry has on/off and a strength slider; entries can be stacked; the panel is collapsible.
- Filtering is by top-level folder name only (never file contents): folders starting `krea2` show only in Create; folders starting `qwen` or `flux`, or ending `-edit`, only in Edit; everything else, including files loose in `loras/`, under "Shared / unsorted" in both. The picker shows one headed section per folder with a divider between sections, and long names truncate with the full name on hover. Remember which mode each LoRA was last used in.
- The installer creates `loras/krea2`, `loras/qwen2.1-edit` and `loras/flux-klein9b-edit`. Files may sit in any subfolder: the manifest and templates name bare files, so the health check, the installer's already-installed check and the engine (for template LoRAs) match by file name anywhere under `loras`. A file name present in two subfolders is ambiguous and counts as missing.
- A wrong-family LoRA usually only triggers ComfyUI "lora key not loaded" warnings. Surface that as a non-blocking hint if detectable.

---

## 7. Acceptance criteria (definition of done)

1. **Structural parity (no GPU):** for each mode and toggle combination, set the same settings in ComfyUI's UI, use Export (API), and diff it against the prompt the app builds. Ignore the §4.4 deleted nodes, `filename_prefix`, and the patched user values. There must be no other differences.
2. **Pixel parity (GPU):** for each of the 5 modes (at least the default toggles, plus each Krea toggle once), run in ComfyUI with fixed seeds and identical inputs, then run in the app with the same seeds. Output images must be identical, or show a max per-pixel difference ≤ 1/255 with a written explanation (GPU nondeterminism). Include an inpaint test using a ComfyUI-MaskEditor-saved mask versus the app's brush mask on the same region.
3. All flows work on desktop Chrome and on mobile (Android Chrome / iOS Safari) through Cloudflare Tunnel and zrok, including WebSocket progress, uploads, login, and PWA install.
4. Nothing in the ComfyUI install changed (`git status`/file timestamps in that folder untouched, apart from ComfyUI's own `input/`, `output/` and `temp/` writes).
5. Error paths: ComfyUI offline, a missing model, a validation error from `/prompt`, a node execution error, cancel mid-run. Each must show a friendly message and never a raw stack trace.

---

## 8. Known facts and traps (from the audit)

- `KREA2_ULTRA_WORKFLOW-V3_fixed.json` was missing the link from the combo's first-pass image to `ImageResize+` (#158). It was fixed on 2026-10-06 (backup `.bak` next to it). The exported templates include the fix (`158.image ← 274:267`).
- Qwen KSampler seeds are fixed at 42 in the workflow, and the combo KSampler seeds are fixed. The app randomizes them unless locked (§5.4).
- The Seed Variance node in the combo feeds both passes' positive conditioning.
- `TextGenerate` (enhancer) uses `sampling_mode: off` (deterministic). Images >2048 px on a side are scaled to 0.6 MP for the enhancer only, and the edit uses full-size inputs. If the rewrite fails or comes back empty, it falls back to the original prompt.
- The `qwen_image_2.1_int8_convrot` UNet referenced inside the Qwen model subgraph is overridden by the outer value (viggle turbo). It is not needed.
- `TextEncodeQwenImage21.resolution = 0` means "keep each reference at its own size", after the per-reference megapixel scaling.
- The negative prompt has no effect at CFG 1, so don't add a negative-prompt UI.
- Untested: Pixel Drift + Manual size (§6.3); Remove/Move preset input format (§6.4); aspect presets other than 1920×1080 / 1080×1920 for Krea2 (§6.3).

---

## 9. How the user runs it (launchers, modeled on Z-Fusion)

The user runs Z-Fusion by double-clicking `Run_Mobile.bat` (connection menu) or `Run_Mobile-zrok-only.bat`. Accio Studio must feel the same: **one double-click, everything starts**. Batch files use CRLF line endings, `chcp 65001`, `setlocal enabledelayedexpansion`, and `cd /d "%~dp0"`, as in Z-Fusion.

### 9.1 Files in the project root
| File | Does |
|---|---|
| `Install.bat` | Downloads portable `uv` into `bin\`, creates the project venv `env\`, installs `requirements.txt`, then runs `npm install` + `npm run build` in `frontend\` (Node.js v24 is installed on the PC). Never installs anything into ComfyUI. |
| `Run_Accio.bat` | The main launcher with a connection menu, like `Run_Mobile.bat`: `1. LOCAL ONLY (Wi-Fi/LAN)`, `2. CLOUDFLARE (random URL)`, `3. ZROK (persistent URL)`, default 1. |
| `Run_Accio-zrok-only.bat` | The same, but skips the menu and goes straight to zrok, like `Run_Mobile-zrok-only.bat`. |
| `Setup_Zrok.bat` | Same flow as Z-Fusion's `Setup_Zrok.bat`, but reserves a **new** unique name for Accio pointing at `http://127.0.0.1:7862`, saved to `.zrok_share` in Accio's root. This PC is already `zrok enable`d (`%USERPROFILE%\.zrok\environment.json` exists), so skip the token step when already enabled. Z-Fusion's reserved name stays Z-Fusion's. |
| `Update.bat` (optional) | Pull + reinstall requirements + rebuild the frontend, like `Update_MobileUI.bat`. |

`cloudflared.exe` and `zrok.exe` live in Accio's root, as in Z-Fusion. Download `cloudflared` automatically on first Cloudflare use, and `zrok` (pinned v1.1.x) in `Setup_Zrok.bat`. Add both executables, `env\`, `bin\`, `frontend\node_modules\`, `frontend\dist\`, `.zrok_share`, settings and history to `.gitignore`.

### 9.2 What `Run_Accio.bat` does, in order
1. **ComfyUI (bundled):** check whether the bundled ComfyUI is already up (`http://127.0.0.1:8189/system_stats`). If not, start it in its own minimized window from `comfyui\` (builds before the flat layout used `comfyui\ComfyUI_windows_portable\`; `config.bundled_comfy_dir()` still finds it): `python_embeded\python.exe -s ComfyUI\main.py --windows-standalone-build --listen 127.0.0.1 --port 8189 <GPU flags saved by the installer>` (GPU flags: `--disable-cuda-malloc --reserve-vram 1` on Nvidia cards with ≤ 8 GB VRAM, as in the user's installer). Port **8189** so it never collides with a separately run ComfyUI on 8188. Then poll `/system_stats` until it answers ("Starting ComfyUI…", timeout ≈ 3 min, clear error + log path on failure); no fixed sleeps. Advanced setting: "Use an external ComfyUI URL instead" for power users (then the bundled one is not started).
2. **Self-heal:** if `env\` is missing, tell the user to run `Install.bat`. If `frontend\dist\index.html` is missing, run `npm install` + `npm run build` (same as Z-Fusion).
3. **Start the server:** `env\Scripts\python.exe server\main.py --tunnel local|cloudflare|zrok`.
   - The server prints the local URL (`http://<LAN-IP>:7862`) and an **ASCII QR code**, using the `qrcode` package like Z-Fusion.
   - For Cloudflare it runs `cloudflared tunnel --url http://localhost:7862` in a background thread, parses the `trycloudflare.com` URL, and prints it with a QR code.
   - For zrok it runs `zrok share reserved <name>` (or `share public` if no `.zrok_share`) in a thread with an **auto-reconnect loop** and QR output. That is the same logic as Z-Fusion's `run_zrok_tunnel`, pointed at port 7862.
4. **Bind address:**
   - Local mode binds `0.0.0.0` so the phone on Wi-Fi works (as Z-Fusion does). Login protects it.
   - Tunnel modes may bind `127.0.0.1`, because the tunnel connects locally. This is configurable.

### 9.3 Nice-to-haves from Z-Fusion
- **Auto-unload models when idle** (Z-Fusion's `auto_unload_task` → ComfyUI `POST /free`). Include it as a setting, **default OFF**: the user also uses this ComfyUI directly, and unloading would slow their own runs.
- Show the public URL and a QR code in the app's settings page too, so the phone can be paired from the desktop.

### 9.4 Daily use (what to tell the user in the README)
1. Double-click `Run_Accio.bat` and pick 1, 2 or 3 (or use `Run_Accio-zrok-only.bat`).
2. Scan the QR code or open the URL. Log in.
3. Install it as an app from the browser ("Install app" / "Add to Home Screen").

---

## 10. Build phases and session handoff

This is a multi-session build. Work in phases. **Keep `PROGRESS.md` in the project root up to date at the end of every phase (and before any long pause).** It must record:
- the phase, what's done, and what's next;
- decisions made and why;
- the user's answers to the open questions;
- known issues;
- how to run and test.

A fresh session must be able to continue from `APP_SPEC.md` + `PROGRESS.md` alone. Commit at the end of each phase, on a feature branch (ask before the first commit).

| Phase | Deliverable | Stop for user? |
|---|---|---|
| 1. Scaffold | Repo, `.gitignore`, venv via `uv`, FastAPI skeleton on 7862, Vite app shell, `Install.bat` / `Run_Accio.bat` (local mode), ComfyUI detect/launch + wait | No |
| 2. Template engine | Load and select templates, patch inputs per §4.3, strip §4.4 nodes, validation, seeds, LoRA injection, queue/progress/history via ComfyUI API, minimal test page. **Structural parity test** (§7.1) for every template | Report results |
| 2b. Portable bundle | Rework \Install.bat\ / \Run_Accio.bat\ per §11 + §9.2: bundled ComfyUI v0.38.0 on 8189, pinned node packs (resolve the 2 registry pins), resumable + verified model downloads, existing-models option (§11.4), no hard-coded user paths. Verify on this PC: fresh install into the app folder, bundled ComfyUI starts, \/object_info\ has every template class, one Standard job runs | Report |
| 3. Design proposal | Palette, type, mobile + desktop mockups, navigation (§6.1b) | **Yes, wait for approval** |
| 4. Create mode | Standard + Detailed, toggles, Advanced, LoRAs, progress, results | Short demo |
| 5. Edit modes | Multi-Edit (MiniMax upload), Inpaint (mask canvas), Outpaint (pad editor), enhancer "prompt used", presets | Ask the §6.4 open question first |
| 6. Gallery, history, PWA | Thumbnails, virtualized gallery, reuse settings, Send to Edit, install | No |
| 7. Security + tunnels | Login/setup, sessions, validation, Cloudflare + zrok launchers, `Setup_Zrok.bat`, QR codes | Report |
| 8. Parity + polish | GPU pixel-parity runs (§7.2), error paths, performance checks (§6.1a), README | **Yes, final review** |

---

## 11. Fully portable distribution with bundled ComfyUI

**Goal: convenience.** A user on a fresh Windows PC with an Nvidia GPU unzips Accio Studio, double-clicks `Install.bat`, waits, then double-clicks `Run_Accio.bat` and it works. They don't install Python, Node, Git, 7-Zip or ComfyUI themselves, and nothing is installed system-wide (no winget, no PATH changes, no admin rights). Everything lives inside the Accio folder, so deleting the folder uninstalls it.

The user's existing installer `<INSTALLER_REF>` (`COMFYUI_KREA2_QWEN21_AUTO_INSTALL_AUTODETECT.bat`) is the **reference** for the ComfyUI part (GPU detection, ComfyUI version, node list, model URLs). Reuse its logic, but make it portable and slimmed down as described below.

### 11.1 Folder layout
```
AccioStudio\
  Install.bat  Run_Accio.bat  Run_Accio-zrok-only.bat  Setup_Zrok.bat  Update.bat
  bin\            portable tools downloaded by Install.bat: uv, 7zr.exe, (node only if needed), cloudflared.exe, zrok.exe
  env\            Accio server venv (uv-managed Python)
  comfyui\ComfyUI\ and comfyui\python_embeded\   bundled ComfyUI (flat layout: the portable package is unpacked, ComfyUI and python_embeded moved up, the update scripts, run_*.bat, README and advanced\ discarded)
  server\  frontend\dist\  templates\ (= comfy-templates + manifest.json)
  data\           settings, history, thumbnails, logs
```

### 11.2 What `Install.bat` does (idempotent; re-running resumes and skips finished steps)
1. **Portable tools into `bin\`**: `uv`, and `7zr.exe` (standalone 7-Zip console from 7-zip.org) to extract the ComfyUI `.7z`. **No Git:** custom nodes are downloaded as GitHub archive zips at pinned commits (`https://github.com/<owner>/<repo>/archive/<commit>.zip`), extracted with Windows' built-in `tar`.
2. **GPU detection**, as in the reference installer: `nvidia-smi` gives the name, compute capability, VRAM and driver.
   - Compute ≥ 7.5 → `ComfyUI_windows_portable_nvidia.7z`; older Nvidia → `_nvidia_cu126`.
   - ≤ 8.3 GB VRAM → launch flags `--disable-cuda-malloc --reserve-vram 1`.
   - Non-Nvidia GPUs: warn that the int8 models were only tested on RTX 20+, and offer to continue or quit.
   - Save the choice to `data\install.json`.
3. **Bundled ComfyUI v0.38.0** (pinned, the version the templates were exported against): download the release `.7z` into `comfyui\` (first from the project's own mirror, `https://huggingface.co/NicRaf/AccioStudio/resolve/main/comfyui/v0.38.0/ComfyUI_windows_portable_<build>.7z`, then from `https://github.com/comfyanonymous/ComfyUI/releases/download/v0.38.0/ComfyUI_windows_portable_<build>.7z`; both unmodified; every build's size and sha256 are in `manifest.json` > `comfyui.archives` and are checked before unpacking; the Nvidia driver must be 580+ for the default build, 525+ for `nvidia_cu126`, which the installer picks when the driver is older), extract it to `comfyui\_extract`, move `ComfyUI\` and `python_embeded\` up into `comfyui\` and delete the rest (the AMD/Intel launch flags are read from `run_*_gpu.bat` first and saved in `data\install.json`). `Install.bat` refuses an install folder path longer than 100 characters or containing `!` (Windows cannot load torch's DLLs from a deeper folder), and downloads abort and resume when a connection stalls (`--speed-time 60 --speed-limit 1024`).
4. **Only the custom nodes the templates need**, pinned for parity (each pack is fetched from the project's mirror first, `manifest.json` > `nodes_mirror_url`, and checked against its recorded size and sha256, then from the author's GitHub at the pinned commit; `ComfyUI-PixelDriftFix` declares no license, so it is not mirrored and is fetched from GitHub only; `uv` is pinned to one version with a sha256 in `Install.bat`) (not the reference installer's full list: no Manager, controlnet_aux, RES4LYF, WAS, Krea edit nodes, Pixaroma or PiD):

| Pack | Source | Pin (installed on the user's PC, 2026-10-07) |
|---|---|---|
| rgthree-comfy | github.com/rgthree/rgthree-comfy | commit `602ae5ea451e…` |
| ComfyUI-KJNodes | github.com/kijai/ComfyUI-KJNodes | commit `d3cfe21625e5…` |
| ComfyUI_essentials | github.com/cubiq/ComfyUI_essentials | commit `9d9f4bedfc9f…` |
| ComfyUI-AusBoss | github.com/ausboss/ComfyUI-AusBoss | commit `d87c259b64b6…` |
| ComfyUI-PixelDriftFix | github.com/Mozer/ComfyUI-PixelDriftFix | commit `62b79b86016e…` |
| ComfyUI-Fantastic-MiniMaxH3-PromptBuilder | github.com/Adudeguyman/ComfyUI-Fantastic-MiniMaxH3-PromptBuilder | commit `01b6d8d91180…` |
| ComfyUI-Krea2T-Enhancer | github.com/capitan01R/ComfyUI-Krea2T-Enhancer | registry install, version **1.4.2** (no `.git`) |
| ComfyUI-RBG-SmartSeedVariance | github.com/RamonGuthrie/ComfyUI-RBG-SmartSeedVariance | registry install, version **2.2.1** (no `.git`) |

   - Get the full 40-character hashes with `git -C <pack> rev-parse HEAD` in the `custom_nodes\` folder of the ComfyUI install they come from.
   - For the two registry installs, find the GitHub commit (or Comfy Registry archive) whose files match the user's installed copy byte-for-byte (compare file hashes, ignoring `__pycache__`) and pin that.
   - Record every pin in `templates\manifest.json`.
   - Install each pack's `requirements.txt` into the **bundled** `python_embeded` (`python_embeded\python.exe -m pip install -r …`).
   - After install, verify via `/object_info` that every `class_type` used by the templates is registered.
5. **Models**: download into the bundled `ComfyUI\models\…` (the 8 required ones from §3; the 4 preset LoRAs optional, offered as a yes/no).
   - URLs come from the reference installer: mostly `https://huggingface.co/Aitrepreneur/FLX/resolve/main/<file>?download=true`. Krea2T/outpaint/BFS/Object LoRAs are listed there too.
   - Downloads are resumable (`curl -L -f -C - -o <file>.part`, then rename) and skip files that already exist.
   - After each download, **verify completeness** by checking the safetensors header (8-byte header length + JSON header; file size must equal 8 + header_len + max data offset). This check found two truncated LoRAs on the user's PC during the audit.
   - Show the total size (~37 GB required) and the free disk space before starting.
6. **Accio server**: create `env\` with uv, install `requirements.txt`.
7. **Frontend**: release zips already contain `frontend\dist`. Build only if it's missing (developer checkout): use system Node if present, else download portable Node LTS into `bin\node\`.
8. Write `extra_model_paths.yaml` only in the cases described in §11.4. Print a summary of what succeeded, what failed, and what to retry.

### 11.3 Runtime
- `Run_Accio.bat` starts the bundled ComfyUI on `127.0.0.1:8189` (never exposed; §9.2) and the Accio server on `7862`.
- The setup-check screen (`/object_info` + `/models/*`) still runs on every start and shows anything missing, with a "Download missing models" action that reuses the installer's downloader logic.
- Show a non-blocking warning when the bundled ComfyUI or node versions don't match `templates\manifest.json` (e.g. after a manual update). Point to the re-export procedure (§4.5).

### 11.4 On the user's own PC (don't re-download 37 GB)
`Install.bat` asks: "Use models from an existing ComfyUI folder? (path or Enter to skip)". If a path is given, write the bundled ComfyUI's `extra_model_paths.yaml` to point at that folder's `models\` subfolders, read-only use. Skip downloading files that are found there. The user's ComfyUI itself is never modified or launched by Accio.

### 11.5 Release packaging
A script (`scripts\make_release`) produces `AccioStudio-<version>.zip` containing:
- the app code, `frontend\dist`, `templates\` + manifest;
- the `.bat` files;
- README and LICENSE.

It excludes `env\`, `bin\`, `comfyui\`, `node_modules\`, `data\`, `.zrok_share` and any model files. Model licenses (Krea2, Qwen, LoRAs) are the end user's responsibility; say so in the README. Never bundle model files.

### 11.5b Updates

`Update.bat` runs `installer\update.py`: it asks the newest GitHub release (`manifest.json` > `updates.api_url`), downloads
`AccioStudio-X.Y.Z.zip`, verifies its SHA-256 (the release's own digest or the attached `.sha256`; no checksum = no install), unpacks it
to `data\update\new` with every member checked (only app files, no `..`, no models or personal files), refuses a release that changes
the ComfyUI version, stops everything that runs from the folder, backs up the replaced files to `data\backup\` (last three kept),
swaps `server\`, `installer\`, `frontend\dist\`, `scripts\`, the top-level `.bat` files and README/LICENSE/requirements/VERSION.txt
(folders are moved aside first, so any failure puts the old ones back), then runs `Install.bat nopause`. The `.bat` files are replaced
last and `Update.bat` ends in one `... & exit /b` line, because cmd reads a running batch file as it goes. The server only reports
(`GET /api/update`, cached six hours, `check_updates` can switch it off) and may start the updater for the PC's own browser
(`POST /api/update/apply`; 403 for any other device); it never replaces files itself. The installer remembers the answers to its
optional-model questions (`data\install.json` > `choices`) so an update does not ask them again.

### 11.6 Parity note
Parity (§7) is now measured between the **user's existing ComfyUI** (the reference, running the workflows) and **Accio with its bundled ComfyUI** (same pinned versions, same models). If a mismatch appears, first check pins and versions (`manifest.json` versus the user's install) before anything else.
