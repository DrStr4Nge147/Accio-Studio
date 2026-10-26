// Re-export the 25 API templates from ComfyUI's own frontend (APP_SPEC 4.5). Nothing is queued.
//
// Run in the browser console (or via automation) on a tab of the bundled ComfyUI, http://127.0.0.1:8189, after
// serving the two workflow JSON files with CORS (see export-templates.md). Each export is POSTed to
// `${BASE}/save/<template name>`; then run `python scripts/compare_exports.py <exports_dir>`.

const BASE = "http://127.0.0.1:8765";
const KREA = "KREA2_ULTRA_WORKFLOW-V3_fixed.json";
const QWEN = "QWEN-IMAGE-EDIT-21-TURBO_ULTRA_WORKFLOW_autoenhancer.json";
const MOSS = "MOSS_IMAGE_ULTRA_WORKFLOW.json";
// Optional filter: set `globalThis.ACCIO_ONLY = "moss"` before running to export only the templates whose name starts with it.
const ONLY = globalThis.ACCIO_ONLY ?? "";

const acc = {
  // Mode must also be set on subgraph nodes, as rgthree's group toggles do; otherwise the combo export loses nodes.
  setMode(n, mode) { n.mode = mode; if (n.subgraph) for (const s of n.subgraph.nodes) this.setMode(s, mode); },
  // Group membership = node whose top-left pos lies inside the group's bounding box.
  members() {
    const out = {};
    for (const g of app.graph._groups) {
      const b = g._bounding;
      out[g.title] = app.graph._nodes.filter(n => n.pos[0] >= b[0] && n.pos[0] <= b[0] + b[2] && n.pos[1] >= b[1] && n.pos[1] <= b[1] + b[3]);
    }
    return out;
  },
  async load(file) {
    const wf = await (await fetch(`${BASE}/${file}`)).json();
    try { await app.loadGraphData(wf, true, true, null); } catch (e) { /* DataCloneError from tab bookkeeping is harmless */ }
    await new Promise(r => setTimeout(r, 800));
    return wf.nodes.length;
  },
  // cfg: {groupTitle: mode}. Applied in order, after every group is first bypassed (4). Later entries win,
  // so sub-groups that sit inside a bigger group's bounds (e.g. CONTROLNET inside MULTI-EDIT) go last.
  // `off` (optional): ids of top-level nodes to bypass afterwards, for variants a group cannot express.
  async exportConfig(file, name, cfg, off = []) {
    if (!name.startsWith(ONLY)) return `${name}: skipped`;
    const n = await this.load(file);
    if (app.graph._nodes.length !== n) throw new Error(`node count ${app.graph._nodes.length} != ${n}`);
    const m = this.members();
    for (const t of Object.keys(m)) for (const nd of m[t]) this.setMode(nd, 4);
    for (const [t, mode] of Object.entries(cfg)) {
      if (!m[t]) throw new Error("no group " + t);
      for (const nd of m[t]) this.setMode(nd, mode);
    }
    for (const id of off) this.setMode(app.graph.getNodeById(id), 4);
    const { output } = await app.graphToPrompt();
    const r = await fetch(`${BASE}/save/${name}`, { method: "POST", body: JSON.stringify(output) });
    return `${name}: ${Object.keys(output).length} nodes, save ${r.status}`;
  },
};

const log = [];
const on = x => (x ? 0 : 4);
const builders = { "TEXT PROMPT BUILDER": 2, "IMAGE PROMPT BUILDER": 2, "COMBO PROMPT BUILDER": 2 }; // muted (2)
for (const v of [0, 1]) for (const t of [0, 1]) for (const s of [0, 1]) {
  log.push(await acc.exportConfig(KREA, `krea_t2i__var${v}_tenh${t}_sharp${s}`,
    { "TEXT TO IMAGE": 0, "TXT SEED VARIANCE": on(v), "TXT T-Enhancer": on(t), "TXT SHARPEN": on(s), ...builders }));
  log.push(await acc.exportConfig(KREA, `krea_combo__var${v}_tenh${t}_sharp${s}`,
    { "TWO TIMES COMBO": 0, "COMBOS VARIANCE": on(v), "COMBOS T-Enhancer": on(t), "COMBOS SHARP": on(s), "COMBOS IMAGE RESIZE": 0, ...builders }));
}
const RESIZE = "RESIZE IMAGE - BYPASS TO USE ORIGINAL RESOLUTION";
log.push(await acc.exportConfig(QWEN, "qwen_multiedit__resize1", { "MULTI-EDIT": 0, [RESIZE]: 0, CONTROLNET: 4 }));
log.push(await acc.exportConfig(QWEN, "qwen_multiedit__resize0", { "MULTI-EDIT": 0, [RESIZE]: 4, CONTROLNET: 4 }));
log.push(await acc.exportConfig(QWEN, "qwen_inpaint", { INPAINTING: 0 }));
log.push(await acc.exportConfig(QWEN, "qwen_outpaint", { OUTPAINTING: 0 }));
// MOSS Image, text to image, turbo: 325 (negative prompt preview) and 324 (comparer) are UI only; 27 ("Prompt used") stays, it is how
// the engine reads the enhanced prompt. sharp0 keeps the plain save (86), sharp1 saves only the sharpened image (336 -> 147).
log.push(await acc.exportConfig(MOSS, "moss_t2i__sharp0", { "TEXT TO IMAGE TURBO": 0 }, [325, 324, 336, 147]));
log.push(await acc.exportConfig(MOSS, "moss_t2i__sharp1", { "TEXT TO IMAGE TURBO": 0 }, [325, 324, 86]));
log;
