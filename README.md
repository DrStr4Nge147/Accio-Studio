# Accio Studio

A web app for **image generation** (Krea 2) and **image editing** (Qwen Image Edit 2.1) that runs on your own PC.
It works on a computer, a phone and a tablet, and installs like an app. Everything stays on your machine unless you
choose to share it over a tunnel.

It ships with its own portable copy of ComfyUI as the engine. You never open ComfyUI yourself.

- **Create**: Standard (one pass) and Detailed (two passes with a refine step), with Seed Variance, T-Enhancer and Sharpen switches.
- **Edit**: Multi-edit (up to 9 images, head and body swap presets), Inpaint (paint a mask; remove or move an object) and Outpaint (drag the edges out).
- **Gallery** of everything you made, with thumbnails, "Reuse settings" and "Send to Edit".

| Desktop | Mobile |
|---|---|
| <img src="docs/screenshots/desktop.png" alt="Accio Studio on a desktop browser" width="640"> | <img src="docs/screenshots/mobile.png" alt="Accio Studio on a phone" width="220"> |

## What you need

| | |
|---|---|
| OS | Windows 10 or 11, 64-bit |
| GPU | **Nvidia**, RTX 20-series or newer recommended (the int8 models were tested on an RTX 2060 6 GB; it is slow there, about 3 to 4 minutes per Create job). Other GPUs: the installer warns and lets you continue, untested. |
| Disk | about **45 GB** free (37 GB of models, 5 GB for the engine, the rest for results) |
| Internet | for the install (models come from Hugging Face). Not needed afterwards unless you use a tunnel. |

You do **not** need to install Python, Node, Git, 7-Zip or ComfyUI. Nothing is installed system-wide: no admin rights, no PATH
changes. Everything lives in this folder, so deleting the folder uninstalls it.

## Install (once)

1. Unzip `AccioStudio-<version>.zip` into a **short folder path** with plenty of space, for example `C:\AccioStudio` or `D:\AccioStudio`.
   The path must be at most 100 characters and must not contain `!`: Windows cannot load some of the engine's files from a deeper
   folder, so `Install.bat` stops with a clear message instead. Avoid `C:\Program Files`. **Do not move or rename the folder
   afterwards** (if you do, run `Install.bat` again; it repairs the Python environment and keeps everything else).
2. Double-click **`Install.bat`** and wait. It is safe to close it and run it again later: it resumes and skips finished steps.
   It downloads the tools, the engine (ComfyUI 0.38.0), 9 pinned custom-node packs and the models, and checks every model
   file is complete.
3. When it asks "Use models from an existing ComfyUI folder?", press Enter to download everything, or give the path of
   a ComfyUI folder that already has the models (it is only **read**, never changed, and nothing is copied). It also asks whether to
   download the four optional preset LoRAs (head swap, body swap, remove object, move object), and separately whether to
   download Flux2 Klein 9B (about 19 GB), a second Edit model that does Multi-edit with up to 3 images. Once installed, pick it
   in Edit > Advanced > Model.

## Daily use

1. Double-click **`Run_Accio.bat`** and pick a connection mode (the default is 1):

   | | Mode | Use it for |
   |---|---|---|
   | 1 | Local only | this PC (`http://127.0.0.1:7862`) |
   | 2 | Cloudflare | reach it from your phone anywhere; a random `trycloudflare.com` address each time |
   | 3 | zrok | the same, with an address that stays the same (run **`Setup_Zrok.bat`** once first). `Run_Accio-zrok-only.bat` skips the menu. |
   | 4 | Same network | other devices on your Wi-Fi |
   | 5 | Tailscale | private: only devices signed into your own Tailscale account (needs the Tailscale app, and Serve enabled once on your tailnet) |

2. The browser opens. The **first time** you choose a password (at least 10 characters). On another device, or whenever a tunnel is
   running, the one-time setup code printed in the server window is needed too.
3. Scan the QR code in the window (or in Settings, under Connection) with your phone and sign in.
4. Install it as an app: "Install app" in the browser menu, or "Add to Home Screen" on iPhone. (Browsers only offer this over https or
   on `localhost`, so a plain-http Wi-Fi address cannot be installed; use a tunnel for that.)

The first job after starting takes longer: the models have to load into GPU memory.

**`Stop_Accio.bat`** stops the server, the engine and any tunnel this folder started, and nothing else.
**`Reset_Password.bat`** removes the password and signs every device out (use it if you forget it).

## Where things are

```
Install.bat  Run_Accio.bat  Run_Accio-zrok-only.bat  Setup_Zrok.bat  Stop_Accio.bat  Reset_Password.bat
bin\        portable tools (uv, 7zr, Node when needed, cloudflared, zrok)
env\        Python environment of the Accio server
comfyui\    the engine: ComfyUI\ (with the models in ComfyUI\models\) and python_embededserver\     the Accio server and its prompt templates (templates\manifest.json lists every pinned version)
data\       your history, thumbnails, uploads and logs (data\logs\comfyui.log is the engine's log)
settings.json   optional settings (below). Holds your password hash once set; do not share it.
```

Results are also saved by the engine in `comfyui\ComfyUI\output\AccioStudio\`.
(Installs made by earlier builds keep working: their engine lives one level deeper, in `comfyui\ComfyUI_windows_portable\`.)

### Optional `settings.json`

Create it next to `Run_Accio.bat`. Unknown keys are ignored.

| Key | Default | Meaning |
|---|---|---|
| `port` | `7862` | the app's port |
| `lan_access` | `false` | listen on the network (same as menu option 4) |
| `session_days` | `14` | how long a login lasts |
| `max_upload_mb` | `40` | largest image you can upload |
| `auto_unload_minutes` | `0` (off) | free GPU memory after this many idle minutes |
| `comfy_port` | `8189` | the bundled engine's port (it listens on this PC only) |
| `external_comfy_url` | empty | advanced: use another ComfyUI instead of the bundled one (it is then not started) |

## Safety

- There is **no default password**. Sessions expire, signing out ends them, and changing the password signs out every other device.
- Failed logins are rate-limited. The app only accepts same-site requests and sets no permissive CORS headers.
- The engine is never exposed: it listens on `127.0.0.1` and the browser only talks to Accio.
- Over a tunnel, anyone who has the address can reach the **login page**, nothing else. Use a long password.
- By default the server listens on this PC only. Menu option 4 (or `lan_access`) opens it to your local network; the login still applies.

## Troubleshooting

| Problem | What to do |
|---|---|
| "The backend did not answer within 3 minutes" | open `data\logs\comfyui.log`; update the Nvidia driver; run `Install.bat` again |
| Settings shows missing models or nodes | run `Install.bat` again, it downloads and verifies what is missing |
| `Install.bat` says the folder path is too long | move the whole folder closer to the drive root, e.g. `C:\AccioStudio`, and run it again |
| "The Python environment does not start" | the folder was moved or renamed; run `Install.bat`, it rebuilds the environment |
| The install seems stuck on a download | a connection that delivers nothing for a minute is cancelled and retried by itself. If it still fails, close the window and run `Install.bat` again: finished files are kept and partial ones resume. |
| "The backend ran out of GPU memory" | close other GPU programs, lower the size, or use Standard instead of Detailed |
| A job seems stuck at "Waiting for the GPU" | another job is running in the engine; the queue pane shows it |
| Can't reach it from the phone | same Wi-Fi? choose option 4, and allow private networks if Windows Firewall asks |
| Forgot the password | `Reset_Password.bat` |

## Models and licences

Accio Studio does **not** include any model. `Install.bat` downloads them from their public mirrors, and **the licences of
Krea 2, Qwen Image, the VAEs and every LoRA are your responsibility**: read them before you use the results commercially.
ComfyUI (GPL-3.0) and the custom-node packs are downloaded from their own repositories at pinned versions and keep their own licences.

## For developers

```powershell
env\Scripts\python.exe -m pytest tests -q          # backend tests (live ones need the bundled engine running)
cd frontend; npm test; npm run build               # frontend tests and production build into frontend\dist
node scripts\check-contrast.mjs                    # design-token contrast check
scripts\make_release.bat --build                   # builds release\AccioStudio-<version>.zip
env\Scripts\python.exe scripts\parity_gpu.py --help   # GPU pixel-parity runs against a reference ComfyUI
```

- `APP_SPEC.md` is the build spec and `PROGRESS.md` the build log (decisions, results, known gaps).
- The prompt templates in `server\templates\` are exported by ComfyUI's own frontend, never edited by hand.
  After changing a workflow or updating ComfyUI or a node pack, re-export them (`scripts\export-templates.md`) and re-run the parity tests.
- The release zip contains only the launchers, the server, installer and templates, the built frontend, this README and the licence.
  It never contains models, `env\`, `bin\`, `comfyui\`, `data\`, `settings.json` or `.zrok_share`.
