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
UNET_CLASS = "UNETLoader"
GRAIN_NODE = "film_grain"  # id of the node inserted before the Save step
KLEIN_MAX_IMAGES = 3
KLEIN_IMAGE_NODES = [("76", "109"), ("81", "115"), ("102", "116")]  # (LoadImage, ImageScaleToTotalPixels) per input image
KLEIN_LORA_NODES = ["120", "121", "122", "123", "124", "125"]  # model-only LoRA loaders, chained in this order
REF_MEGAPIXEL_NODES = ["298:302", "298:306", "298:310", "298:314", "298:318", "298:322", "298:326", "298:330"]
VARIANCE_RESERVED = {"conditioning", "seed", "presets_buttons"}


class BuildError(ValueError):
    """A request that is well-formed but not acceptable (unknown LoRA, bad sampler name...)."""


@dataclass
class Catalog:
    """Live option lists from ComfyUI. None = not available (offline tests): membership checks are skipped."""

    loras: set[str] | None = None
    unets: set[str] | None = None  # diffusion models, only fetched when a job asks for one
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


def is_klein(name: str | None) -> bool:
    """Flux2 Klein edit models (GGUF) run on their own templates; everything else is a Qwen Edit model."""
    return bool(name) and "klein" in name.lower() and name.lower().endswith(".gguf")


def _apply_unet(prompt: dict, name: str | None, cat: Catalog) -> None:
    """Point the template's diffusion-model loader at another installed model (Qwen Edit modes only)."""
    if name is None:
        return
    if is_klein(name):
        raise BuildError("Klein models support Multi-edit only")
    _choice(name, cat.unets, "model")
    loaders = [n for n in prompt.values() if n["class_type"] == UNET_CLASS]
    if len(loaders) != 1:
        raise BuildError("template drift: expected exactly one diffusion model loader")
    loaders[0]["inputs"]["unet_name"] = name


def find_model(name: str, available: set[str]) -> str | None:
    """The installed entry for a model file, wherever it sits under its models folder.

    ComfyUI lists models relative to the folder (`krea2/x.safetensors`), but templates and the manifest name bare
    files. An exact match wins; otherwise a unique entry with the same file name in any subfolder.
    """
    if name in available:
        return name
    base = name.replace("\\", "/").rsplit("/", 1)[-1].lower()
    hits = sorted(a for a in available if a.replace("\\", "/").rsplit("/", 1)[-1].lower() == base)
    return hits[0] if len(hits) == 1 else None


def _relocate_template_loras(prompt: dict, installed: set[str] | None) -> None:
    """Template LoRAs are named by bare file; point them at wherever the user filed them (loras/krea2/...)."""
    if installed is None:
        return
    for node in prompt.values():
        inputs = node["inputs"]
        if node["class_type"] == "LoraLoaderModelOnly" and isinstance(inputs.get("lora_name"), str):
            inputs["lora_name"] = find_model(inputs["lora_name"], installed) or inputs["lora_name"]
        for v in inputs.values():
            if isinstance(v, dict) and isinstance(v.get("lora"), str):
                v["lora"] = find_model(v["lora"], installed) or v["lora"]


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


def _apply_grain(prompt: dict, save_node: str, strength: float | None, seed: int) -> None:
    """Film grain: ComfyUI's own seeded ImageAddNoise sits between the image and its SaveImage. Same seed = same grain."""
    if strength is None:
        return
    save = prompt[save_node]["inputs"]
    if not is_link(save.get("images")):
        raise BuildError(f"template drift: node {save_node} has no image link")
    prompt[GRAIN_NODE] = {
        "inputs": {"image": save["images"], "seed": seed, "strength": strength},
        "class_type": "ImageAddNoise",
        "_meta": {"title": "Film grain"},
    }
    save["images"] = [GRAIN_NODE, 0]


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
    moss = load_template("moss_t2i__sharp1")
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
        "moss": {
            "width": moss["15"]["inputs"]["value"],
            "height": moss["16"]["inputs"]["value"],
            "sampler": sampler(moss, "331"),
            "sharpen_strength": moss["336"]["inputs"]["alpha"],
        },
        "sharpen_strength": std["141"]["inputs"]["method.strength"],
        "t_enhancer_strength": std["146"]["inputs"]["strength"],
        "variance": {
            k: v
            for k, v in std["281"]["inputs"].items()
            if k not in VARIANCE_RESERVED and not is_link(v)
        },
    }


def _klein_defaults() -> dict[str, Any]:
    pr = load_template("klein_multiedit_gguf_3")
    return {
        "unet_name": pr["107"]["inputs"]["unet_name"],
        "sampler": {
            "steps": pr["118"]["inputs"]["steps"],
            "cfg": pr["117"]["inputs"]["cfg"],
            "sampler_name": pr["103"]["inputs"]["sampler_name"],
        },
        "base_megapixels": pr["109"]["inputs"]["megapixels"],
        "ref_megapixels": [pr[n]["inputs"]["megapixels"] for _, n in KLEIN_IMAGE_NODES[1:]],
        "max_images": KLEIN_MAX_IMAGES,
        "max_loras": len(KLEIN_LORA_NODES),
    }


def _unet_of(prompt: dict[str, Any]) -> str:
    return next(n["inputs"]["unet_name"] for n in prompt.values() if n["class_type"] == UNET_CLASS)


def edit_defaults() -> dict[str, Any]:
    """Workflow default values of the Edit patch points (single source of truth for the UI)."""
    me = load_template("qwen_multiedit__resize1")
    ip = load_template("qwen_inpaint")
    op = load_template("qwen_outpaint")
    sampler_keys = ("steps", "cfg", "sampler_name", "scheduler", "denoise")

    def sampler(pr: dict, node: str) -> dict[str, Any]:
        return {k: pr[node]["inputs"][k] for k in sampler_keys}

    crop_keys = ("context_factor", "blend_pixels", "output_multiple", "mask_grow", "mask_blur", "context_pixels", "target_megapixels")
    pad = op["71"]["inputs"]
    return {
        "unet_name": _unet_of(me),
        "klein": _klein_defaults(),
        "multiedit": {
            "sampler": sampler(me, "36"),
            "base_megapixels": me["16"]["inputs"]["megapixels"],
            "ref_megapixels": [me[n]["inputs"]["megapixels"] for n in REF_MEGAPIXEL_NODES],
            "manual_width": me["341:339"]["inputs"]["width"],
            "manual_height": me["341:339"]["inputs"]["height"],
        },
        "inpaint": {
            "sampler": sampler(ip, "60"),
            "crop": {k: ip["267:266"]["inputs"][k] for k in crop_keys},
            "seam": ip["267:262"]["inputs"]["seam"],
        },
        "outpaint": {
            "sampler": sampler(op, "74"),
            "fill_mode": pad["mode"],
            "fill_color": pad["fill_color"],
            "backdrop_blur": pad["backdrop_blur"],
            "feather": pad["feather"],
            "canvas_multiple": pad["canvas_multiple"],
            "target_megapixels": pad["target_megapixels"],
            "seam": op["259:258"]["inputs"]["seam"],
            "lora_strength": op["252"]["inputs"]["lora_1"]["strength"],
            "prompt": op["253"]["inputs"]["value"],
        },
    }


# --------------------------------------------------------------------------- builders

def _build_moss(p: CreateParams, cat: Catalog, seeds_src: Callable[[], int], prefix: str) -> Built:
    """MOSS Image, turbo text to image. Prompt mode stays on the template's "manual prompt"; the size is always the manual one
    (the workflow's automatic resolution picker is switched off)."""
    sharp = int(p.sharpen)
    name = f"moss_t2i__sharp{sharp}"
    pr = strip_output_only(load_template(name))
    _set(pr, "104", "value", p.prompt)
    seeds = {"main": _seed(p.seed, seeds_src)}
    _set(pr, "331", "seed", seeds["main"])
    _set(pr, "676", "value", False)
    for node, val in (("15", p.width), ("16", p.height)):
        if val is not None:
            _set(pr, node, "value", val)
    _set(pr, "337:329", "batch_size", p.batch)
    _apply_sampler(pr, "331", p.sampler, cat)
    if sharp and p.sharpen_strength is not None:
        _set(pr, "336", "alpha", p.sharpen_strength)
    _inject_loras(pr, "341", p.loras, cat)
    save = "147" if sharp else "86"
    _apply_grain(pr, save, p.film_grain, seeds["main"])
    _set(pr, save, "filename_prefix", f"{prefix}/create")
    return Built(pr, name, seeds, {save: "final"}, None, "create", "Create · MOSS")


def _build_create(p: CreateParams, cat: Catalog, seeds_src: Callable[[], int], prefix: str) -> Built:
    if p.variant == "moss":
        return _build_moss(p, cat, seeds_src, prefix)
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
        _apply_grain(pr, "12", p.film_grain, seeds["main"])
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
    _apply_grain(pr, "183", p.film_grain, seeds["pass2"])
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


def _build_klein_multiedit(p: MultiEditParams, cat: Catalog, seeds_src: Callable[[], int], prefix: str) -> Built:
    """Flux2 Klein edit: 1-3 reference images, own sampler (steps / CFG / sampler only). Only values are patched, plus
    dropping the LoRA loaders nobody uses (the template's placeholders name a file that does not exist)."""
    n = len(p.images)
    if n > KLEIN_MAX_IMAGES:
        raise BuildError(f"Klein edits take up to {KLEIN_MAX_IMAGES} images")
    if len(p.loras) > len(KLEIN_LORA_NODES):
        raise BuildError(f"Klein edits take up to {len(KLEIN_LORA_NODES)} LoRAs")
    name = f"klein_multiedit_gguf_{n}"
    pr = strip_output_only(load_template(name))
    _choice(p.unet_name, cat.unets, "model")
    _set(pr, "107", "unet_name", p.unet_name)
    _set(pr, "111", "text", p.prompt)
    for (load, scale), img in zip(KLEIN_IMAGE_NODES, p.images):
        _set(pr, load, "image", f"{MEDIA_SUBFOLDER}/{img.file} [input]")
    seed = _seed(p.seed, seeds_src)
    _set(pr, "106", "noise_seed", seed)
    if p.sampler is not None:
        if p.sampler.sampler_name is not None:
            _choice(p.sampler.sampler_name, cat.samplers, "sampler")
        for node, key, val in (("118", "steps", p.sampler.steps), ("117", "cfg", p.sampler.cfg), ("103", "sampler_name", p.sampler.sampler_name)):
            if val is not None:
                _set(pr, node, key, val)
    if p.manual_size:
        for node in ("112", "118"):
            _set(pr, node, "width", p.manual_width)
            _set(pr, node, "height", p.manual_height)
        _set(pr, "112", "batch_size", p.manual_batch)
    if p.base_megapixels is not None:
        _set(pr, "109", "megapixels", p.base_megapixels)
    for (_, scale), mp in zip(KLEIN_IMAGE_NODES[1:n], p.ref_megapixels):
        if mp is not None:
            _set(pr, scale, "megapixels", mp)
    active = [e for e in p.loras if e.on]
    if active and cat.loras is None:
        raise BuildError("LoRA list unavailable")
    for node, e in zip(KLEIN_LORA_NODES, active):
        _choice(e.name, cat.loras, "LoRA")
        _set(pr, node, "lora_name", e.name)
        _set(pr, node, "strength_model", e.strength)
    used = KLEIN_LORA_NODES[: len(active)]
    for node in KLEIN_LORA_NODES[len(used):]:
        del pr[node]
    _set(pr, "117", "model", [used[-1] if used else "107", 0])
    _apply_grain(pr, "200", p.film_grain, seed)
    _set(pr, "200", "filename_prefix", f"{prefix}/edit")
    warnings = []
    ignored = [label for label, on in (("Keep original resolution", p.keep_original_resolution), ("Head swap", p.head_swap), ("Body swap", p.body_swap)) if on]
    if ignored:
        warnings.append(f"Not available with Klein, ignored: {', '.join(ignored)}.")
    return Built(pr, name, {"main": seed}, {"200": "final"}, None, "multiedit", "Edit · Multi-Edit (Klein)", warnings)


def _build_multiedit(p: MultiEditParams, cat: Catalog, seeds_src: Callable[[], int], prefix: str) -> Built:
    if is_klein(p.unet_name):
        return _build_klein_multiedit(p, cat, seeds_src, prefix)
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
    _apply_unet(pr, p.unet_name, cat)
    _apply_grain(pr, "45", p.film_grain, seed)
    _set(pr, "45", "filename_prefix", f"{prefix}/edit")
    warnings = []
    if p.manual_size and p.pixel_drift_fix:
        warnings.append("Pixel Drift Fix is on with a manual size: the fix returns the result at image 1's size, which can undo the manual size.")
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
    _apply_unet(pr, p.unet_name, cat)
    _apply_grain(pr, "64", p.film_grain, seed)
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
    _apply_unet(pr, p.unet_name, cat)
    _apply_grain(pr, "78", p.film_grain, seed)
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
    _relocate_template_loras(built.prompt, cat.loras)
    assert_graph_ok(built.prompt)
    return built
