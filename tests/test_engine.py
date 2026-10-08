"""Engine behaviour beyond plain parity: LoRAs, seeds, resize bug guard, validation."""
from __future__ import annotations

import json

import pytest
from pydantic import ValidationError

from engine import BuildError, Catalog, build
from schemas import JobRequest

CAT = Catalog(
    loras={"a.safetensors", "krea2/b.safetensors", "qwen/c.safetensors"},
    unets={"Qwen-Image-Other.safetensors"},
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


def test_inpaint_source_is_display_only():
    b = build(mk(mode="inpaint", prompt="x", image="m.png", source="orig.png"), CAT, seed_source=lambda: 1)
    assert "orig.png" not in json.dumps(b.prompt)
    with pytest.raises(ValidationError):
        mk(mode="inpaint", prompt="x", image="m.png", source="../orig.png")


def _unet(b):
    return [n["inputs"]["unet_name"] for n in b.prompt.values() if n["class_type"] == "UNETLoader"]


@pytest.mark.parametrize(
    "kw",
    [
        dict(mode="multiedit", prompt="x", images=[{"file": "a.png"}]),
        dict(mode="inpaint", prompt="x", image="a.png"),
        dict(mode="outpaint", image="a.png", pad_left=64),
    ],
)
def test_qwen_model_override(kw):
    default = _unet(run(**kw))
    assert len(default) == 1 and default != ["Qwen-Image-Other.safetensors"]
    assert _unet(run(**kw, unet_name="Qwen-Image-Other.safetensors")) == ["Qwen-Image-Other.safetensors"]
    with pytest.raises(BuildError):
        run(**kw, unet_name="not_installed.safetensors")


def test_create_has_no_model_override():
    with pytest.raises(ValidationError):
        mk(mode="create", variant="standard", prompt="x", unet_name="Qwen-Image-Other.safetensors")


# --------------------------------------------------------------------------- Flux2 Klein (Multi-edit)

KLEIN = "flux-2-klein-9b-Q8_0.gguf"
KCAT = Catalog(
    loras={"a.safetensors", "krea2/b.safetensors", "qwen/c.safetensors"},
    unets={KLEIN, "Qwen-Image-Other.safetensors"},
    samplers={"euler", "er_sde"},
    schedulers={"simple"},
)


def krun(**kw):
    kw.setdefault("mode", "multiedit")
    kw.setdefault("prompt", "make it night")
    kw.setdefault("unet_name", KLEIN)
    return build(mk(**kw), KCAT, seed_source=iter(range(10, 99)).__next__)


@pytest.mark.parametrize("n", [1, 2, 3])
def test_klein_picks_the_template_by_image_count_and_patches_values(n):
    b = krun(images=[{"file": f"i{k}.png"} for k in range(n)], seed=5)
    assert b.template == f"klein_multiedit_gguf_{n}" and b.mode == "multiedit"
    assert b.prompt["107"]["inputs"]["unet_name"] == KLEIN
    assert b.prompt["111"]["inputs"]["text"] == "make it night"
    assert b.prompt["106"]["inputs"]["noise_seed"] == 5 and b.seeds == {"main": 5}
    loads = [v["inputs"]["image"] for v in b.prompt.values() if v["class_type"] == "LoadImage"]
    assert loads == [f"minimax_h3/i{k}.png [input]" for k in range(n)]
    assert b.outputs == {"200": "final"} and b.prompt["200"]["inputs"]["filename_prefix"] == "AccioStudio/edit"
    assert not [v for v in b.prompt.values() if v["class_type"] == "PreviewImage"]


def test_klein_rejects_too_many_images_and_loras():
    with pytest.raises(BuildError):
        krun(images=[{"file": "a.png"}] * 4)
    with pytest.raises(BuildError):
        krun(images=[{"file": "a.png"}], loras=[{"name": "a.safetensors"}] * 7)


def test_klein_model_must_be_installed():
    with pytest.raises(BuildError):
        krun(images=[{"file": "a.png"}], unet_name="flux-2-klein-9b-Q4_K_S.gguf")


def test_klein_loras_fill_the_chain_and_unused_loaders_are_dropped():
    b = krun(images=[{"file": "a.png"}], loras=[{"name": "a.safetensors", "strength": 0.5}, {"name": "qwen/c.safetensors", "on": False}, {"name": "krea2/b.safetensors"}])
    assert b.prompt["120"]["inputs"] == {"lora_name": "a.safetensors", "strength_model": 0.5, "model": ["107", 0]}
    assert b.prompt["121"]["inputs"]["lora_name"] == "krea2/b.safetensors" and b.prompt["121"]["inputs"]["model"] == ["120", 0]
    assert not {"122", "123", "124", "125"} & set(b.prompt)
    assert b.prompt["117"]["inputs"]["model"] == ["121", 0]
    none = krun(images=[{"file": "a.png"}])
    assert not {"120", "121", "122", "123", "124", "125"} & set(none.prompt)
    assert none.prompt["117"]["inputs"]["model"] == ["107", 0]
    with pytest.raises(BuildError):
        krun(images=[{"file": "a.png"}], loras=[{"name": "nope.safetensors"}])


def test_klein_sampler_manual_size_and_megapixels():
    b = krun(
        images=[{"file": "a.png"}, {"file": "b.png"}],
        sampler={"steps": 8, "cfg": 1.5, "sampler_name": "er_sde"},
        manual_size=True, manual_width=832, manual_height=1216, manual_batch=2,
        base_megapixels=2, ref_megapixels=[0.5],
    )
    assert b.prompt["118"]["inputs"]["steps"] == 8 and b.prompt["117"]["inputs"]["cfg"] == 1.5
    assert b.prompt["103"]["inputs"]["sampler_name"] == "er_sde"
    for node in ("112", "118"):
        assert (b.prompt[node]["inputs"]["width"], b.prompt[node]["inputs"]["height"]) == (832, 1216)
    assert b.prompt["112"]["inputs"]["batch_size"] == 2
    assert b.prompt["109"]["inputs"]["megapixels"] == 2 and b.prompt["115"]["inputs"]["megapixels"] == 0.5
    with pytest.raises(BuildError):
        krun(images=[{"file": "a.png"}], sampler={"sampler_name": "nope"})


def test_klein_warns_about_qwen_only_options():
    b = krun(images=[{"file": "a.png"}], keep_original_resolution=True, head_swap=True)
    assert len(b.warnings) == 1 and "Keep original resolution" in b.warnings[0] and "Head swap" in b.warnings[0]
    assert krun(images=[{"file": "a.png"}]).warnings == []


def test_klein_only_multiedit():
    for kw in (dict(mode="inpaint", image="a.png"), dict(mode="outpaint", image="a.png", pad_left=64)):
        with pytest.raises(BuildError):
            krun(**kw)


def test_klein_defaults_come_from_the_template():
    from engine import edit_defaults

    k = edit_defaults()["klein"]
    assert k["unet_name"] == KLEIN and k["sampler"] == {"steps": 4, "cfg": 1, "sampler_name": "euler"}
    assert k["max_images"] == 3 and k["max_loras"] == 6 and k["base_megapixels"] == 1 and len(k["ref_megapixels"]) == 2


def test_klein_templates_are_not_mutated_by_builds():
    from engine import load_template

    before = load_template("klein_multiedit_gguf_3")
    krun(images=[{"file": "a.png"}] * 3, loras=[{"name": "a.safetensors"}])
    assert load_template("klein_multiedit_gguf_3") == before
