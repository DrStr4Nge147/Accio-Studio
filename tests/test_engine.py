"""Engine behaviour beyond plain parity: LoRAs, seeds, resize bug guard, validation."""
from __future__ import annotations

import json

import pytest
from pydantic import ValidationError

from engine import BuildError, Catalog, build
from schemas import JobRequest

CAT = Catalog(
    loras={"a.safetensors", "krea2/b.safetensors", "qwen/c.safetensors"},
    samplers={"euler", "er_sde"},
    schedulers={"simple", "karras"},
    variance_spec={"fine_tune_variance": ["INT", {"min": 0, "max": 100}], "fade_curve": [["Instant", "Linear"], {}]},
)


def mk(**kw):
    return JobRequest.model_validate({"params": kw}).params


def run(**kw):
    return build(mk(**kw), CAT, seed_source=iter(range(10, 99)).__next__)


def test_seeds_are_random_unless_given_and_recorded():
    b = run(mode="create", variant="detailed", prompt="x")
    assert set(b.seeds) == {"pass1", "pass2", "variance"}
    assert b.prompt["273"]["inputs"]["seed"] == b.seeds["pass1"]
    assert b.prompt["265"]["inputs"]["seed"] == b.seeds["pass2"]
    assert b.prompt["282"]["inputs"]["seed"] == b.seeds["variance"]
    b = run(mode="create", variant="detailed", prompt="x", seed=5, seed_pass2=6, seed_variance_seed=7)
    assert b.seeds == {"pass1": 5, "pass2": 6, "variance": 7}


def test_standard_ksampler_seed_stays_linked_to_seed_node():
    b = run(mode="create", variant="standard", prompt="x", seed=42)
    assert b.prompt["833:828"]["inputs"]["seed"] == ["832", 0]
    assert b.prompt["832"]["inputs"]["seed"] == 42


@pytest.mark.parametrize("w,h,f,expect", [(1080, 1920, 1, (1080, 1920)), (1080, 1920, 1.5, (1624, 2880)), (1920, 1080, 2, (3840, 2160)), (1248, 1664, 1.25, (1560, 2080))])
def test_combo_resize_follows_chosen_size(w, h, f, expect):
    """Regression for the original workflow's hard-coded 1920x1080 (portrait would be shrunk before pass 2)."""
    b = run(mode="create", variant="detailed", prompt="x", width=w, height=h, upscale=f)
    r = b.prompt["158"]["inputs"]
    assert (r["width"], r["height"]) == expect
    assert (b.prompt["244"]["inputs"]["value"], b.prompt["245"]["inputs"]["value"]) == (w, h)


def test_save_first_pass_off_removes_only_node_160():
    on = run(mode="create", variant="detailed", prompt="x", save_first_pass=True)
    off = run(mode="create", variant="detailed", prompt="x", save_first_pass=False)
    assert "160" in on.prompt and "160" not in off.prompt
    assert set(on.prompt) - set(off.prompt) == {"160"}
    assert off.outputs == {"183": "final"}


def test_lora_injection_goes_before_marker_and_respects_targets():
    b = run(mode="create", variant="detailed", prompt="x", loras=[
        {"name": "a.safetensors", "strength": 0.5},
        {"name": "krea2/b.safetensors", "target": "pass2"},
    ])
    p1, p2 = b.prompt["180"]["inputs"], b.prompt["174"]["inputs"]
    assert p1["lora_2"] == {"on": True, "lora": "a.safetensors", "strength": 0.5} and "lora_3" not in p1
    assert p2["lora_2"]["lora"] == "a.safetensors" and p2["lora_3"]["lora"] == "krea2/b.safetensors"
    keys = list(p2)
    assert keys.index("lora_3") < keys.index("➕ Add Lora")
    assert p1["lora_1"]["lora"] == "krea2_turbo_lora_rank_64_bf16.safetensors"  # untouched


def test_standard_lora_loader_starts_empty():
    b = run(mode="create", variant="standard", prompt="x", loras=[{"name": "a.safetensors"}])
    assert b.prompt["82"]["inputs"]["lora_1"]["lora"] == "a.safetensors"


def test_unknown_lora_and_sampler_rejected():
    with pytest.raises(BuildError):
        run(mode="create", variant="standard", prompt="x", loras=[{"name": "nope.safetensors"}])
    with pytest.raises(BuildError):
        run(mode="create", variant="standard", prompt="x", sampler={"sampler_name": "evil"})


def test_lora_without_catalog_is_refused():
    with pytest.raises(BuildError):
        build(mk(mode="create", variant="standard", prompt="x", loras=[{"name": "a.safetensors"}]))


def test_variance_overrides_validated():
    b = run(mode="create", variant="standard", prompt="x", variance={"fine_tune_variance": 30, "fade_curve": "Linear"})
    assert b.prompt["281"]["inputs"]["fine_tune_variance"] == 30
    for bad in ({"fine_tune_variance": 500}, {"fade_curve": "Zigzag"}, {"conditioning": "x"}, {"seed": 1}, {"nope": 1}):
        with pytest.raises(BuildError):
            run(mode="create", variant="standard", prompt="x", variance=bad)


def test_multiedit_media_state_and_presets():
    b = run(mode="multiedit", prompt="p", images=[{"file": "a1.png", "name": "orig 1.jpg"}, {"file": "b2.webp"}], head_swap=True)
    state = json.loads(b.prompt["296"]["inputs"]["media_state"])
    assert state == [
        {"kind": "picture", "file": "minimax_h3/a1.png [input]", "name": "orig 1.jpg"},
        {"kind": "picture", "file": "minimax_h3/b2.webp [input]", "name": "b2.webp"},
    ]
    assert b.prompt["24"]["inputs"]["lora_1"]["on"] is True and b.prompt["24"]["inputs"]["lora_2"]["on"] is False
    assert b.prompt_used_node == "280"


def test_multiedit_resize0_has_no_base_megapixels_node():
    b = run(mode="multiedit", prompt="p", images=[{"file": "a.png"}], keep_original_resolution=True, base_megapixels=2)
    assert b.template.endswith("resize0") and "16" not in b.prompt


def test_multiedit_manual_size_with_pixel_drift_warns():
    b = run(mode="multiedit", prompt="p", images=[{"file": "a.png"}], manual_size=True, pixel_drift_fix=True)
    assert b.warnings


def test_inpaint_lora_presets_and_image_ref():
    b = run(mode="inpaint", prompt="p", image="m.png", remover=True)
    assert b.prompt["213"]["inputs"]["lora_1"]["on"] is True and b.prompt["213"]["inputs"]["lora_2"]["on"] is False
    assert b.prompt["250"]["inputs"]["image"] == "accio/m.png [input]"


def test_outpaint_default_prompt_and_padding_rules():
    b = run(mode="outpaint", image="o.png", pad_left=64)
    assert b.prompt["253"]["inputs"]["value"].startswith("Outpaint the image")
    with pytest.raises(ValidationError):
        mk(mode="outpaint", image="o.png")  # no padding


@pytest.mark.parametrize("bad", [
    dict(mode="create", variant="standard", prompt=""),
    dict(mode="create", variant="standard", prompt="x", seed=2**53),
    dict(mode="create", variant="standard", prompt="x", width=1001),
    dict(mode="create", variant="standard", prompt="x", bogus=1),
    dict(mode="create", variant="standard", prompt="x", upscale=3),
    dict(mode="multiedit", prompt="x", images=[]),
    dict(mode="multiedit", prompt="x", images=[{"file": "a.png"}] * 10),
    dict(mode="multiedit", prompt="x", images=[{"file": "../a.png"}]),
    dict(mode="inpaint", prompt="x", image="a/b.png"),
    dict(mode="outpaint", image="a.png", pad_left=1, fill_color="red"),
])
def test_invalid_requests_rejected(bad):
    with pytest.raises(ValidationError):
        mk(**bad)


def test_create_defaults_match_workflow_values():
    from engine import create_defaults, load_template

    d = create_defaults()
    assert (d["standard"]["width"], d["standard"]["height"]) == (1080, 1920)
    assert (d["detailed"]["width"], d["detailed"]["height"]) == (1920, 1080)
    assert d["standard"]["sampler"]["steps"] == 8 and d["detailed"]["pass2"]["steps"] == 4
    assert d["detailed"]["turbo_pass1"] == {"on": True, "strength": 0.2}
    assert d["variance"]["variance_preset"].endswith("Balanced")
    # The combo's Seed Variance node must expose the same defaults, or the shared UI would lie for Detailed.
    combo_var = load_template("krea_combo__var1_tenh0_sharp0")["282"]["inputs"]
    assert all(combo_var[k] == v for k, v in d["variance"].items())


def test_edit_defaults_match_workflow_values():
    from engine import edit_defaults

    d = edit_defaults()
    assert d["multiedit"]["sampler"]["steps"] == 6 and d["inpaint"]["sampler"]["sampler_name"] == "euler"
    assert d["multiedit"]["base_megapixels"] == 1 and len(d["multiedit"]["ref_megapixels"]) == 8
    assert (d["multiedit"]["manual_width"], d["multiedit"]["manual_height"]) == (1024, 1024)
    assert d["inpaint"]["crop"]["context_factor"] == 1.4 and d["inpaint"]["crop"]["mask_grow"] == 8
    assert d["outpaint"]["fill_color"] == "#808080" and d["outpaint"]["seam"] == "blend in"
    assert d["outpaint"]["prompt"].startswith("Outpaint the image")


def test_size_hint_is_display_only_and_validated():
    p = mk(mode="inpaint", prompt="x", image="a.png", size_hint=[1024, 768])
    b = build(p, CAT, seed_source=lambda: 1)
    assert "size_hint" not in json.dumps(b.prompt)
    with pytest.raises(ValidationError):
        mk(mode="inpaint", prompt="x", image="a.png", size_hint=[1024])
    with pytest.raises(ValidationError):
        mk(mode="inpaint", prompt="x", image="a.png", size_hint=[0, 10])
