"""Template engine.

Builds a ComfyUI API prompt from one of the exported templates in ./templates. The graphs are never
modified structurally: this module only (1) picks a template, (2) overwrites input *values* at the
patch points in APP_SPEC section 4.3, (3) injects LoRA entries into existing rgthree loaders, and
(4) drops the output/UI-only nodes in STRIP_CLASSES. Templates are read-only data.
"""
from __future__ import annotations

import json
import secrets
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any, Callable

from config import TEMPLATES_DIR
from schemas import (
    MAX_SEED,
    CreateParams,
    InpaintParams,
    JobParams,
    LoraEntry,
    MultiEditParams,
    OutpaintParams,
    SamplerOpts,
)

STRIP_CLASSES = {"Image Comparer (rgthree)", "PixaromaRunTimer"}  # spec 4.4
OUTPAINT_DEFAULT_PROMPT = (
    "Outpaint the image: replace the solid gray areas with a seamless continuation of the scene, "
    "keeping the existing picture unchanged."
)
UPLOAD_SUBFOLDER = "accio"  # inpaint / outpaint uploads
MEDIA_SUBFOLDER = "minimax_h3"  # multi-edit uploads (spec 5.2)
LORA_ADD_MARKER = "➕ Add Lora"
REF_MEGAPIXEL_NODES = ["298:302", "298:306", "298:310", "298:314", "298:318", "298:322", "298:326", "298:330"]
VARIANCE_RESERVED = {"conditioning", "seed", "presets_buttons"}


class BuildError(ValueError):
    """A request that is well-formed but not acceptable (unknown LoRA, bad sampler name...)."""


@dataclass
class Catalog:
    """Live option lists from ComfyUI. None = not available (offline tests): membership checks are skipped."""

    loras: set[str] | None = None
    samplers: set[str] | None = None
    schedulers: set[str] | None = None
    variance_spec: dict[str, Any] | None = None  # RBG_Smart_Seed_Variance input name -> object_info spec


@dataclass
class Built:
    prompt: dict[str, Any]
    template: str
    seeds: dict[str, int]
    outputs: dict[str, str]  # SaveImage node id -> role ("final" | "first_pass")
    prompt_used_node: str | None
    mode: str
    label: str = ""
    warnings: list[str] = field(default_factory=list)


# --------------------------------------------------------------------------- template access

@lru_cache(maxsize=None)
def _raw_template(name: str) -> str:
    return (TEMPLATES_DIR / f"{name}.json").read_text(encoding="utf-8")


def load_template(name: str) -> dict[str, Any]:
    """Fresh copy of a template (the cached text is parsed anew, so shared data is never mutated)."""
    return json.loads(_raw_template(name))


def is_link(v: Any) -> bool:
    return isinstance(v, list) and len(v) == 2 and isinstance(v[0], str) and isinstance(v[1], int)


def strip_output_only(prompt: dict[str, Any]) -> dict[str, Any]:
    for nid in [nid for nid, n in prompt.items() if n["class_type"] in STRIP_CLASSES]:
        del prompt[nid]
    assert_graph_ok(prompt)
    return prompt


def assert_graph_ok(prompt: dict[str, Any]) -> None:
    """Every link must point at a node that still exists."""
    for nid, node in prompt.items():
        for key, val in node["inputs"].items():
            if is_link(val) and val[0] not in prompt:
                raise AssertionError(f"node {nid} input '{key}' references missing node {val[0]}")


# --------------------------------------------------------------------------- patch helpers

def _set(prompt: dict, node: str, key: str, value: Any) -> None:
    n = prompt.get(node)
    if n is None:
        raise BuildError(f"template drift: node {node} missing")
    if key not in n["inputs"]:
        raise BuildError(f"template drift: node {node} has no input '{key}'")
    n["inputs"][key] = value


def _has(prompt: dict, node: str, key: str) -> bool:
    return node in prompt and key in prompt[node]["inputs"]


def _choice(value: str, allowed: set[str] | None, label: str) -> None:
    if allowed is not None and value not in allowed:
        raise BuildError(f"unknown {label}: {value!r}")


def _seed(given: int | None, source: Callable[[], int]) -> int:
    return given if given is not None else source()


def default_seed() -> int:
    return secrets.randbelow(MAX_SEED + 1)


def _round8(x: float) -> int:
    return max(8, int(x / 8 + 0.5) * 8)  # half-up, deterministic


def _apply_sampler(prompt: dict, node: str, opts: SamplerOpts | None, cat: Catalog) -> None:
    if opts is None:
        return
    if opts.sampler_name is not None:
        _choice(opts.sampler_name, cat.samplers, "sampler")
    if opts.scheduler is not None:
        _choice(opts.scheduler, cat.schedulers, "scheduler")
    for key, val in (
        ("steps", opts.steps),
        ("cfg", opts.cfg),
        ("sampler_name", opts.sampler_name),
        ("scheduler", opts.scheduler),
        ("denoise", opts.denoise),
    ):
        if val is not None:
            _set(prompt, node, key, val)


def _inject_loras(prompt: dict, node: str, entries: list[LoraEntry], cat: Catalog) -> None:
    """Add `lora_N` entries to an rgthree Power Lora Loader, just before its add-lora marker."""
    if not entries:
        return
    if cat.loras is None:
        raise BuildError("LoRA list unavailable")
    inputs = prompt[node]["inputs"]
    n = max((int(k[5:]) for k in inputs if k.startswith("lora_") and k[5:].isdigit()), default=0)
    added: dict[str, Any] = {}
    for e in entries:
        if e.name not in cat.loras:
            raise BuildError(f"unknown LoRA: {e.name!r}")
        n += 1
        added[f"lora_{n}"] = {"on": e.on, "lora": e.name, "strength": e.strength}
    rebuilt: dict[str, Any] = {}
    for k, v in inputs.items():
        if k == LORA_ADD_MARKER:
            rebuilt.update(added)
        rebuilt[k] = v
    if LORA_ADD_MARKER not in inputs:
        rebuilt.update(added)
    prompt[node]["inputs"] = rebuilt


def _lora_slot(prompt: dict, node: str, slot: str, *, on: bool | None = None, strength: float | None = None) -> None:
    entry = prompt[node]["inputs"].get(slot)
    if not isinstance(entry, dict):
        raise BuildError(f"template drift: {node}.{slot} missing")
    if on is not None:
        entry["on"] = on
    if strength is not None:
        entry["strength"] = strength


def _apply_variance(prompt: dict, node: str, overrides: dict | None, cat: Catalog) -> None:
    if not overrides:
        return
    current = prompt[node]["inputs"]
    for key, val in overrides.items():
        if key in VARIANCE_RESERVED or key not in current or is_link(current[key]):
            raise BuildError(f"unsupported Seed Variance setting: {key!r}")
        base = current[key]
        if isinstance(base, str) != isinstance(val, str):
            raise BuildError(f"Seed Variance '{key}' has the wrong type")
        spec = (cat.variance_spec or {}).get(key)
        if spec:
            kind, opts = spec[0], (spec[1] if len(spec) > 1 else {})
            if isinstance(kind, list):
                _choice(val, set(kind), f"Seed Variance '{key}'")
            elif kind in ("INT", "FLOAT"):
                if ("min" in opts and val < opts["min"]) or ("max" in opts and val > opts["max"]):
                    raise BuildError(f"Seed Variance '{key}' out of range")
        if isinstance(val, str) and len(val) > 200:
            raise BuildError(f"Seed Variance '{key}' too long")
        if isinstance(base, int) and not isinstance(base, bool) and isinstance(val, float):
            if not val.is_integer():
                raise BuildError(f"Seed Variance '{key}' must be a whole number")
            val = int(val)
        current[key] = val


def create_defaults() -> dict[str, Any]:
    """Workflow default values of the Create patch points, read from the templates (single source of truth for the UI)."""
    std = load_template("krea_t2i__var1_tenh1_sharp1")
    combo = load_template("krea_combo__var1_tenh1_sharp1")
    sampler_keys = ("steps", "cfg", "sampler_name", "scheduler", "denoise")

    def sampler(pr: dict, node: str) -> dict[str, Any]:
        return {k: pr[node]["inputs"][k] for k in sampler_keys}

    return {
        "standard": {
            "width": std["833:829"]["inputs"]["width"],
            "height": std["833:829"]["inputs"]["height"],
            "sampler": sampler(std, "833:828"),
        },
        "detailed": {
            "width": combo["244"]["inputs"]["value"],
            "height": combo["245"]["inputs"]["value"],
            "pass1": sampler(combo, "273"),
            "pass2": sampler(combo, "265"),
            "turbo_pass1": {k: combo["180"]["inputs"]["lora_1"][k] for k in ("on", "strength")},
            "turbo_pass2": {k: combo["174"]["inputs"]["lora_1"][k] for k in ("on", "strength")},
        },
        "sharpen_strength": std["141"]["inputs"]["method.strength"],
        "t_enhancer_strength": std["146"]["inputs"]["strength"],
        "variance": {
            k: v
            for k, v in std["281"]["inputs"].items()
            if k not in VARIANCE_RESERVED and not is_link(v)
        },
    }


# --------------------------------------------------------------------------- builders

def _build_create(p: CreateParams, cat: Catalog, seeds_src: Callable[[], int], prefix: str) -> Built:
    var, tenh, sharp = int(p.seed_variance), int(p.t_enhancer), int(p.sharpen)
    seeds: dict[str, int] = {}
    outputs: dict[str, str] = {}

    if p.variant == "standard":
        name = f"krea_t2i__var{var}_tenh{tenh}_sharp{sharp}"
        pr = strip_output_only(load_template(name))
        _set(pr, "143", "value", p.prompt)
        seeds["main"] = _seed(p.seed, seeds_src)
        _set(pr, "832", "seed", seeds["main"])
        for key, val in (("width", p.width), ("height", p.height)):
            if val is not None:
                _set(pr, "833:829", key, val)
        _set(pr, "833:829", "batch_size", p.batch)
        _apply_sampler(pr, "833:828", p.sampler, cat)  # its `seed` is a link to 832; left alone
        if var:
            seeds["variance"] = _seed(p.seed_variance_seed, seeds_src)
            _set(pr, "281", "seed", seeds["variance"])
            _apply_variance(pr, "281", p.variance, cat)
        if sharp and p.sharpen_strength is not None:
            _set(pr, "141", "method.strength", p.sharpen_strength)
        if tenh and p.t_enhancer_strength is not None:
            _set(pr, "146", "strength", p.t_enhancer_strength)
        _inject_loras(pr, "82", p.loras, cat)
        _set(pr, "12", "filename_prefix", f"{prefix}/create")
        outputs["12"] = "final"
        return Built(pr, name, seeds, outputs, None, "create", "Create · Standard")

    # detailed (two-pass combo)
    name = f"krea_combo__var{var}_tenh{tenh}_sharp{sharp}"
    pr = strip_output_only(load_template(name))
    _set(pr, "278", "value", p.prompt)
    w = p.width if p.width is not None else pr["244"]["inputs"]["value"]
    h = p.height if p.height is not None else pr["245"]["inputs"]["value"]
    _set(pr, "244", "value", w)
    _set(pr, "245", "value", h)
    _set(pr, "246", "value", p.batch)
    seeds["pass1"] = _seed(p.seed, seeds_src)
    seeds["pass2"] = _seed(p.seed_pass2, seeds_src)
    _set(pr, "273", "seed", seeds["pass1"])
    _set(pr, "265", "seed", seeds["pass2"])
    _apply_sampler(pr, "273", p.pass1, cat)
    _apply_sampler(pr, "265", p.pass2, cat)
    # Always size the pre-refine resize from the chosen size (the original hard-codes 1920x1080, spec 4.3).
    f = float(p.upscale)
    rw, rh = (w, h) if f == 1 else (_round8(w * f), _round8(h * f))
    _set(pr, "158", "width", rw)
    _set(pr, "158", "height", rh)
    for node, t in (("180", p.turbo_pass1), ("174", p.turbo_pass2)):
        if t is not None:
            _lora_slot(pr, node, "lora_1", on=t.on, strength=t.strength)
    if var:
        seeds["variance"] = _seed(p.seed_variance_seed, seeds_src)
        _set(pr, "282", "seed", seeds["variance"])
        _apply_variance(pr, "282", p.variance, cat)
    if sharp and p.sharpen_strength is not None:
        _set(pr, "193", "method.strength", p.sharpen_strength)
    if tenh and p.t_enhancer_strength is not None:
        _set(pr, "215", "strength", p.t_enhancer_strength)
    for node, targets in (("180", {"both", "pass1"}), ("174", {"both", "pass2"})):
        _inject_loras(pr, node, [e for e in p.loras if e.target in targets], cat)
    _set(pr, "183", "filename_prefix", f"{prefix}/create")
    outputs["183"] = "final"
    if p.save_first_pass:
        _set(pr, "160", "filename_prefix", f"{prefix}/create_first")
        outputs["160"] = "first_pass"
    else:
        del pr["160"]  # output-only node; nothing consumes it
    return Built(pr, name, seeds, outputs, None, "create", "Create · Detailed")


def _media_state(images) -> str:
    items = [{"kind": "picture", "file": f"{MEDIA_SUBFOLDER}/{i.file} [input]", "name": i.name or i.file} for i in images]
    return json.dumps(items, separators=(",", ":"), ensure_ascii=False)


def _build_multiedit(p: MultiEditParams, cat: Catalog, seeds_src: Callable[[], int], prefix: str) -> Built:
    name = f"qwen_multiedit__resize{0 if p.keep_original_resolution else 1}"
    pr = strip_output_only(load_template(name))
    _set(pr, "279", "value", p.prompt)
    _set(pr, "296", "media_state", _media_state(p.images))
    seed = _seed(p.seed, seeds_src)
    _set(pr, "36", "seed", seed)
    _apply_sampler(pr, "36", p.sampler, cat)
    _set(pr, "291:282", "value", p.prompt_enhancer)
    _set(pr, "278:39", "switch", p.pixel_drift_fix)
    _set(pr, "341:340", "switch", p.manual_size)
    _set(pr, "341:339", "width", p.manual_width)
    _set(pr, "341:339", "height", p.manual_height)
    _set(pr, "341:339", "batch_size", p.manual_batch)
    if p.base_megapixels is not None and _has(pr, "16", "megapixels"):  # resize1 only
        _set(pr, "16", "megapixels", p.base_megapixels)
    for node, mp in zip(REF_MEGAPIXEL_NODES, p.ref_megapixels):
        if mp is not None:
            _set(pr, node, "megapixels", mp)
    _lora_slot(pr, "24", "lora_1", on=p.head_swap)
    _lora_slot(pr, "24", "lora_2", on=p.body_swap)
    _inject_loras(pr, "24", p.loras, cat)
    _set(pr, "45", "filename_prefix", f"{prefix}/edit")
    warnings = []
    if p.manual_size and p.pixel_drift_fix:
        warnings.append("Pixel Drift Fix with Manual size is untested (APP_SPEC 6.3).")
    return Built(pr, name, {"main": seed}, {"45": "final"}, "280", "multiedit", "Edit · Multi-Edit", warnings)


def _build_inpaint(p: InpaintParams, cat: Catalog, seeds_src: Callable[[], int], prefix: str) -> Built:
    pr = strip_output_only(load_template("qwen_inpaint"))
    _set(pr, "200", "value", p.prompt)
    _set(pr, "250", "image", f"{UPLOAD_SUBFOLDER}/{p.image} [input]")
    seed = _seed(p.seed, seeds_src)
    _set(pr, "60", "seed", seed)
    _apply_sampler(pr, "60", p.sampler, cat)
    _set(pr, "210:208", "value", p.prompt_enhancer)
    _set(pr, "267:266", "invert_mask", p.invert_mask)
    for key in ("mask_grow", "mask_blur", "context_factor", "context_pixels", "blend_pixels", "output_multiple", "target_megapixels"):
        val = getattr(p, key)
        if val is not None:
            _set(pr, "267:266", key, val)
    _set(pr, "267:262", "fix_edge_halo", p.fix_edge_halo)
    _set(pr, "267:262", "seam", p.seam)
    _lora_slot(pr, "213", "lora_1", on=p.remover)
    _lora_slot(pr, "213", "lora_2", on=p.mover)
    _inject_loras(pr, "213", p.loras, cat)
    _set(pr, "64", "filename_prefix", f"{prefix}/inpaint")
    return Built(pr, "qwen_inpaint", {"main": seed}, {"64": "final"}, "215", "inpaint", "Edit · Inpaint")


def _build_outpaint(p: OutpaintParams, cat: Catalog, seeds_src: Callable[[], int], prefix: str) -> Built:
    pr = strip_output_only(load_template("qwen_outpaint"))
    _set(pr, "253", "value", p.prompt.strip() or OUTPAINT_DEFAULT_PROMPT)
    _set(pr, "71", "image", f"{UPLOAD_SUBFOLDER}/{p.image}")
    for side in ("left", "top", "right", "bottom"):
        _set(pr, "71", f"pad_{side}", getattr(p, f"pad_{side}"))
    _set(pr, "71", "mode", p.fill_mode)
    _set(pr, "71", "fill_color", p.fill_color)
    _set(pr, "71", "backdrop_blur", p.backdrop_blur)
    _set(pr, "71", "feather", p.feather)
    _set(pr, "71", "canvas_multiple", p.canvas_multiple)
    _set(pr, "71", "target_megapixels", p.target_megapixels)
    seed = _seed(p.seed, seeds_src)
    _set(pr, "74", "seed", seed)
    _apply_sampler(pr, "74", p.sampler, cat)
    _set(pr, "259:258", "fix_edge_halo", p.fix_edge_halo)
    _set(pr, "259:258", "seam", p.seam)
    _lora_slot(pr, "252", "lora_1", on=p.outpaint_lora_on, strength=p.outpaint_lora_strength)
    _inject_loras(pr, "252", p.loras, cat)
    _set(pr, "78", "filename_prefix", f"{prefix}/outpaint")
    return Built(pr, "qwen_outpaint", {"main": seed}, {"78": "final"}, None, "outpaint", "Edit · Outpaint")


def build(
    params: JobParams,
    catalog: Catalog | None = None,
    *,
    seed_source: Callable[[], int] = default_seed,
    output_prefix: str = "AccioStudio",
) -> Built:
    cat = catalog or Catalog()
    if isinstance(params, CreateParams):
        built = _build_create(params, cat, seed_source, output_prefix)
    elif isinstance(params, MultiEditParams):
        built = _build_multiedit(params, cat, seed_source, output_prefix)
    elif isinstance(params, InpaintParams):
        built = _build_inpaint(params, cat, seed_source, output_prefix)
    elif isinstance(params, OutpaintParams):
        built = _build_outpaint(params, cat, seed_source, output_prefix)
    else:  # pragma: no cover - the discriminated union makes this unreachable
        raise BuildError("unknown mode")
    assert_graph_ok(built.prompt)
    return built
