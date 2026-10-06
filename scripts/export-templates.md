# Re-exporting the API templates

The templates in `comfy-templates/` (copied to `server/templates/`) must come from ComfyUI's own frontend,
never from hand edits. Re-export whenever the user changes a workflow or updates ComfyUI or a custom-node pack,
then re-run the tests.

1. Copy the two workflow files (`KREA2_ULTRA_WORKFLOW-V3_fixed.json`,
   `QWEN-IMAGE-EDIT-21-TURBO_ULTRA_WORKFLOW_autoenhancer.json`) into a scratch folder together with a small
   local server that:
   - serves `GET /<file>` for those two files with `Access-Control-Allow-Origin: *`,
   - accepts `POST /save/<name>` and writes the body to `<exports_dir>/<name>.json`.
   (Any 30-line `http.server` handler does; keep it outside the project tree.)
2. Open ComfyUI at `http://127.0.0.1:8188` and paste/run `scripts/export-templates.js` in the page
   (browser console or automation). Nothing is queued. A `DataCloneError` after loading a workflow is harmless.
3. Compare: `env\Scripts\python.exe scripts\compare_exports.py <exports_dir>`. If anything differs and the change is
   intended, copy the export over both `comfy-templates\` and `server\templates\`.
4. Run `env\Scripts\python.exe -m pytest tests -q`. If a patch point moved (node ids changed), update
   `server/engine.py` and `APP_SPEC.md` section 4.3, then re-run the GPU parity checks.

Group configuration notes (why the script looks the way it does):
- Group membership is the node's top-left `pos` inside the group's `_bounding` box.
- Every group is bypassed (mode 4) first, then the wanted groups are set; the prompt-builder groups are muted (mode 2).
- Sub-groups nested inside a larger group's bounds (CONTROLNET inside MULTI-EDIT) must be set last.
- Modes are applied recursively to `node.subgraph.nodes`.
