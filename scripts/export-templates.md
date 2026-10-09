# Re-exporting the API templates

The templates in `comfy-templates/` (copied to `server/templates/`) must come from ComfyUI's own frontend,
never from hand edits. Re-export whenever a workflow changes or ComfyUI or a custom-node pack is updated,
then re-run the tests. You only need ComfyUI that Accio installed itself: nothing outside this project folder.

**Status:** the 20 shipped templates were exported from the author's own ComfyUI (same version, 0.38.0, and same
pinned node packs). Re-exporting from the bundled ComfyUI is the intended route from now on, but it has not been run
yet. Step 5 tells you whether it reproduces the shipped templates exactly.

## What you need

- The two source workflows, kept **outside** the project (they are the author's files, not part of the release):
  `KREA2_ULTRA_WORKFLOW-V3_fixed.json` and `QWEN-IMAGE-EDIT-21-TURBO_ULTRA_WORKFLOW_autoenhancer.json`
  (the non-`_fixed` / non-`autoenhancer` files are the author's originals, reference only).
  `LOCAL_PATHS.md` (git-ignored) records where they are (`WORKFLOWS_DIR`).
- The bundled ComfyUI running: `Run_Accio.bat` starts it on port 8189 (or start it by hand, see below).
- A browser, to open the ComfyUI page and use its developer console.

## Steps

1. **Start the bundled ComfyUI** (skip if `Run_Accio.bat` already started it). From the project folder:
   `comfyui\python_embeded\python.exe -s comfyui\ComfyUI\main.py --windows-standalone-build --listen 127.0.0.1 --port 8189 --disable-auto-launch`
   (add the flags from `data\install.json` > `launch_flags`). Installs made by earlier builds keep the engine one folder deeper:
   `comfyui\ComfyUI_windows_portable\`.
2. **Start a tiny helper server** that hands the workflows to the page and saves what the page exports.
   Put this in a scratch folder **outside the project tree** as `export_server.py` and run it with
   `env\Scripts\python.exe export_server.py <workflows_dir> <exports_dir>`:

   ```python
   import sys
   from http.server import BaseHTTPRequestHandler, HTTPServer
   from pathlib import Path

   WORKFLOWS, EXPORTS = Path(sys.argv[1]), Path(sys.argv[2])
   EXPORTS.mkdir(parents=True, exist_ok=True)


   class Handler(BaseHTTPRequestHandler):
       def _cors(self):
           self.send_header("Access-Control-Allow-Origin", "*")
           self.send_header("Access-Control-Allow-Headers", "*")

       def do_OPTIONS(self):
           self.send_response(204); self._cors(); self.end_headers()

       def do_GET(self):  # GET /<workflow file>
           f = WORKFLOWS / Path(self.path.lstrip("/")).name
           if not f.is_file():
               self.send_response(404); self._cors(); self.end_headers(); return
           data = f.read_bytes()
           self.send_response(200); self._cors()
           self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(data)))
           self.end_headers(); self.wfile.write(data)

       def do_POST(self):  # POST /save/<template name>
           name = Path(self.path).name
           body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
           (EXPORTS / f"{name}.json").write_bytes(body)
           self.send_response(200); self._cors(); self.end_headers()


   HTTPServer(("127.0.0.1", 8765), Handler).serve_forever()
   ```

3. **Open `http://127.0.0.1:8189`** in a browser, open the developer console (F12), paste the whole of
   `scripts/export-templates.js` and press Enter. Nothing is queued. It loads each workflow, switches the groups for
   each template, and POSTs the result to the helper, which writes `<exports_dir>\<template name>.json`.
   A `DataCloneError` after loading a workflow is harmless. If the page reports missing nodes (for example the
   Pixaroma run timer, which Accio does not install), dismiss the dialog: the engine strips those nodes before
   queueing (`APP_SPEC.md` section 4.4).
4. **Stop the helper** (Ctrl+C).
5. **Compare:** `env\Scripts\python.exe scripts\compare_exports.py <exports_dir>`. All 20 should print `IDENTICAL`.
   If something differs and the change is intended, copy the export over both `comfy-templates\` and `server\templates\`.
   If it differs and you did not change anything, the engine or a node pack differs from the pinned one
   (`server\templates\manifest.json`); fix that first rather than accepting the new export.
6. **Run the tests:** `env\Scripts\python.exe -m pytest tests -q`. If a patch point moved (node ids changed), update
   `server/engine.py` and `APP_SPEC.md` section 4.3, then re-run the GPU parity checks (`scripts\parity_gpu.py --help`;
   they need a reference ComfyUI, which is optional and not part of the release).

## Group configuration notes (why the script looks the way it does)

- Group membership is the node's top-left `pos` inside the group's `_bounding` box.
- Every group is bypassed (mode 4) first, then the wanted groups are set; the prompt-builder groups are muted (mode 2).
- Sub-groups nested inside a larger group's bounds (CONTROLNET inside MULTI-EDIT) must be set last.
- Modes are applied recursively to `node.subgraph.nodes`.
