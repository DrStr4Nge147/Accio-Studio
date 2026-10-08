"""Structural parity (APP_SPEC 7.1), offline part.

For every template the engine must produce a prompt that differs from the (stripped) template
ONLY at the patch points of spec 4.3 - same nodes, same class types, same links, same other values.

Two checks per template:
  * defaults  - only prompt/seeds/prefixes/uploads supplied -> the diff is exactly those user values.
  * explicit  - every patchable option supplied at its documented default -> still the same diff,
                which proves the spec's defaults equal the template's own values.
"""
from __future__ import annotations

import itertools
import json

import pytest

from config import TEMPLATES_DIR, template_files
from engine import STRIP_CLASSES, Built, Catalog, assert_graph_ok, build, load_template
from schemas import JobRequest

SEEDS = iter(itertools.count(1000))
PREFIX = "AccioStudio"


def seed_source():
    return next(SEEDS)


def diff(a: dict, b: dict) -> set[str]:
    """Paths (node.input) whose value differs, plus added/removed nodes/inputs."""
    out: set[str] = set()
    for nid in set(a) | set(b):
        if nid not in a:
            out.add(f"+node {nid}")
        elif nid not in b:
            out.add(f"-node {nid}")
        else:
            assert a[nid]["class_type"] == b[nid]["class_type"], f"class changed at {nid}"
            ia, ib = a[nid]["inputs"], b[nid]["inputs"]
            for k in set(ia) | set(ib):
                if ia.get(k, "<absent>") != ib.get(k, "<absent>"):
                    out.add(f"{nid}.{k}")
    return out


def stripped_template(name: str) -> dict:
    t = load_template(name)
    for nid in [n for n, v in t.items() if v["class_type"] in STRIP_CLASSES]:
        del t[nid]
    return t


# (template name, minimal request, explicit-defaults request, expected diff paths)
def _cases():
    for v, t, s in itertools.product((0, 1), repeat=3):
        flags = dict(seed_variance=bool(v), t_enhancer=bool(t), sharpen=bool(s))
        name = f"krea_t2i__var{v}_tenh{t}_sharp{s}"
        base = dict(mode="create", variant="standard", prompt="a test prompt", **flags)
        full = dict(
            base, width=1080, height=1920, batch=1,
            sampler=dict(steps=8, cfg=1, sampler_name="er_sde", scheduler="simple", denoise=1),
        )
        if s:
            full["sharpen_strength"] = 0.75
        if t:
            full["t_enhancer_strength"] = 1
        exp = {"143.value", "832.seed", "12.filename_prefix"} | ({"281.seed"} if v else set())
        yield pytest.param(name, base, full, exp, id=name)

    for v, t, s in itertools.product((0, 1), repeat=3):
        flags = dict(seed_variance=bool(v), t_enhancer=bool(t), sharpen=bool(s))
        name = f"krea_combo__var{v}_tenh{t}_sharp{s}"
        base = dict(mode="create", variant="detailed", prompt="a test prompt", **flags)
        full = dict(
            base, width=1920, height=1080, batch=1, upscale=1, save_first_pass=True,
            pass1=dict(steps=8, cfg=1, sampler_name="er_sde", scheduler="simple", denoise=1),
            pass2=dict(steps=4, cfg=1, sampler_name="euler", scheduler="simple", denoise=0.3),
            turbo_pass1=dict(on=True, strength=0.2), turbo_pass2=dict(on=True, strength=0.2),
        )
        if s:
            full["sharpen_strength"] = 0.75
        if t:
            full["t_enhancer_strength"] = 1
        exp = {"278.value", "273.seed", "265.seed", "183.filename_prefix", "160.filename_prefix"}
        exp |= {"282.seed"} if v else set()
        yield pytest.param(name, base, full, exp, id=name)

    for keep in (0, 1):
        name = f"qwen_multiedit__resize{1 - keep}"
        base = dict(mode="multiedit", prompt="make it happy", images=[{"file": "abc.png", "name": "a.png"}], keep_original_resolution=bool(keep))
        full = dict(
            base, prompt_enhancer=True, pixel_drift_fix=True, manual_size=False, manual_width=1024, manual_height=1024,
            manual_batch=1, head_swap=False, body_swap=False, ref_megapixels=[1] * 8,
            sampler=dict(steps=6, cfg=1, sampler_name="euler", scheduler="simple", denoise=1),
        )
        if not keep:
            full["base_megapixels"] = 1
        yield pytest.param(name, base, full, {"279.value", "296.media_state", "36.seed", "45.filename_prefix"}, id=name)

    base = dict(mode="inpaint", prompt="remove it", image="m.png")
    full = dict(
        base, prompt_enhancer=True, invert_mask=False, mask_grow=8, mask_blur=0, context_factor=1.4, context_pixels=64,
        blend_pixels=16, output_multiple=32, target_megapixels=1, fix_edge_halo=False, seam="classic", remover=False, mover=False,
        sampler=dict(steps=6, cfg=1, sampler_name="euler", scheduler="simple", denoise=1),
    )
    yield pytest.param("qwen_inpaint", base, full, {"200.value", "250.image", "60.seed", "64.filename_prefix"}, id="qwen_inpaint")

    t = load_template("qwen_outpaint")["71"]["inputs"]
    base = dict(mode="outpaint", image="o.png", pad_left=t["pad_left"], pad_top=t["pad_top"], pad_right=t["pad_right"], pad_bottom=t["pad_bottom"])
    full = dict(
        base, fill_mode="color", fill_color="#808080", backdrop_blur=0.5, feather=32, canvas_multiple=32, target_megapixels=1.5,
        fix_edge_halo=False, seam="blend in", outpaint_lora_on=True, outpaint_lora_strength=1,
        sampler=dict(steps=6, cfg=1, sampler_name="euler", scheduler="simple", denoise=1),
    )
    yield pytest.param("qwen_outpaint", base, full, {"71.image", "74.seed", "78.filename_prefix"}, id="qwen_outpaint")


CASES = list(_cases())


def _build(req: dict) -> Built:
    params = JobRequest.model_validate({"params": req}).params
    return build(params, Catalog(), seed_source=seed_source, output_prefix=PREFIX)


def test_there_are_exactly_23_templates():
    assert len(template_files()) == 23


@pytest.mark.parametrize("name,base,full,expected", CASES)
def test_defaults_only_touch_user_values(name, base, full, expected):
    built = _build(base)
    assert built.template == name
    ref = stripped_template(name)
    assert diff(ref, built.prompt) <= expected | _loose(name), diff(ref, built.prompt)
    # No output-only node survives, and every link still resolves.
    assert not [n for n in built.prompt.values() if n["class_type"] in STRIP_CLASSES]
    assert_graph_ok(built.prompt)


@pytest.mark.parametrize("name,base,full,expected", CASES)
def test_explicit_defaults_equal_template_values(name, base, full, expected):
    built = _build(full)
    assert built.template == name
    ref = stripped_template(name)
    got = diff(ref, built.prompt)
    assert got == expected, f"unexpected diff: {sorted(got ^ expected)}"


def _loose(name: str) -> set[str]:
    """Extra paths the minimal request may touch: values the engine always writes (batch/size defaults, 158 resize)."""
    if name.startswith("krea_combo"):
        return {"158.width", "158.height", "244.value", "245.value", "246.value"}
    if name.startswith("krea_t2i"):
        return {"833:829.batch_size"}
    return set()


def test_templates_on_disk_not_mutated_by_builds():
    before = {p.name: p.read_bytes() for p in template_files()}
    for p in CASES:
        _build(p.values[1])
    assert before == {p.name: p.read_bytes() for p in template_files()}


def test_server_templates_match_exported_originals():
    src = TEMPLATES_DIR.parent.parent / "comfy-templates"
    for p in template_files():
        assert json.loads(p.read_text("utf-8")) == json.loads((src / p.name).read_text("utf-8")), p.name

