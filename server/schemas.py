"""Request models. Everything a client can send is validated here (types, ranges, filenames);
enum membership against ComfyUI's live lists (samplers, LoRAs, variance options) is checked in engine.py."""
from __future__ import annotations

from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

MAX_SEED = 2**53 - 1
Seed = Annotated[int, Field(ge=0, le=MAX_SEED)]
Prompt = Annotated[str, StringConstraints(min_length=1, max_length=8000)]
# Server-generated upload names only: no path separators, no dots-only, no spaces.
Filename = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")]
Dim = Annotated[int, Field(ge=64, le=8192, multiple_of=8)]
# Render size of one picture: [width, height].
Size = Annotated[list[Dim], Field(min_length=2, max_length=2)]
# Display-only: pixel size the UI should reserve for the result (Edit jobs have no width/height inputs). Never reaches a node.
SizeHint = Annotated[list[Annotated[int, Field(ge=1, le=32768)]], Field(min_length=2, max_length=2)]
# Qwen Edit only: a diffusion model file name from ComfyUI's list (checked against it in engine.py). None = the template's model.
UnetName = Annotated[str, StringConstraints(min_length=1, max_length=300)]
# Film grain strength added to the result before it is saved. None = no grain.
FilmGrain = Annotated[float, Field(gt=0, le=0.5)]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class LoraEntry(Strict):
    name: Annotated[str, StringConstraints(min_length=1, max_length=300)]
    strength: float = Field(1.0, ge=-10, le=10)
    on: bool = True
    # Create/Detailed only: which pass loader receives the entry.
    target: Literal["both", "pass1", "pass2"] = "both"


class SamplerOpts(Strict):
    """None = keep the template's value (which equals the workflow default)."""

    steps: int | None = Field(None, ge=1, le=100)
    cfg: float | None = Field(None, ge=0, le=30)
    sampler_name: str | None = Field(None, max_length=64)
    scheduler: str | None = Field(None, max_length=64)
    denoise: float | None = Field(None, ge=0, le=1)


class LoraToggle(Strict):
    on: bool = True
    strength: float = Field(0.2, ge=0, le=5)


# CreateParams fields that only mean something for Krea (variance, T-Enhancer, the two-pass Detailed variant).
MOSS_UNSUPPORTED = frozenset({
    "seed_variance", "t_enhancer", "variance", "seed_variance_seed", "t_enhancer_strength",
    "seed_pass2", "pass1", "pass2", "turbo_pass1", "turbo_pass2", "upscale", "save_first_pass",
})


class CreateParams(Strict):
    mode: Literal["create"]
    variant: Literal["standard", "detailed", "moss"]
    prompt: Prompt
    width: Dim | None = None
    height: Dim | None = None
    batch: int = Field(1, ge=1, le=8)
    seed_variance: bool = True
    t_enhancer: bool = False
    sharpen: bool = True
    sharpen_strength: float | None = Field(None, ge=0, le=1)
    t_enhancer_strength: float | None = Field(None, ge=0, le=2)
    variance: dict[str, str | int | float] | None = None
    # Seeds: None = generate randomly (lock = client sends the seed back).
    seed: Seed | None = None  # Standard: SeedNode 832. Detailed: pass 1.
    seed_pass2: Seed | None = None  # Detailed pass 2.
    seed_variance_seed: Seed | None = None
    sampler: SamplerOpts | None = None  # Standard
    pass1: SamplerOpts | None = None  # Detailed
    pass2: SamplerOpts | None = None
    turbo_pass1: LoraToggle | None = None
    turbo_pass2: LoraToggle | None = None
    upscale: Literal[1, 1.25, 1.5, 2] = 1
    save_first_pass: bool = True
    # MOSS Image only: the two LoRAs its workflow always loads (template slots lora_1 = 8-step turbo, lora_2 = SFT).
    turbo_lora: LoraToggle | None = None
    sft_lora: LoraToggle | None = None
    # MOSS Image only: let the model rewrite the prompt (the workflow's PROMPT MODE 2, "enhanced prompt").
    prompt_enhancer: bool = False
    loras: list[LoraEntry] = Field(default_factory=list, max_length=10)
    film_grain: FilmGrain | None = None

    @model_validator(mode="after")
    def _moss_has_no_krea_options(self) -> "CreateParams":
        """MOSS Image ("moss") has one pass and none of Krea's extras: say so instead of silently ignoring what was sent."""
        if self.variant == "moss":
            sent = sorted(self.model_fields_set & MOSS_UNSUPPORTED)
            if sent:
                raise ValueError(f"MOSS Image does not take: {', '.join(sent)}")
        elif {"turbo_lora", "sft_lora", "prompt_enhancer"} & self.model_fields_set:
            raise ValueError("turbo_lora, sft_lora and prompt_enhancer are for MOSS Image only")
        return self


class ImageRef(Strict):
    file: Filename  # name returned by /api/upload
    name: Annotated[str, StringConstraints(max_length=200)] = ""


class MultiEditParams(Strict):
    mode: Literal["multiedit"]
    prompt: Prompt
    images: list[ImageRef] = Field(min_length=1, max_length=9)
    prompt_enhancer: bool = True
    keep_original_resolution: bool = False
    pixel_drift_fix: bool = True
    manual_size: bool = False
    manual_width: Dim = 1024
    manual_height: Dim = 1024
    manual_batch: int = Field(1, ge=1, le=8)
    base_megapixels: float | None = Field(None, gt=0, le=16)
    ref_megapixels: list[Annotated[float, Field(gt=0, le=16)] | None] = Field(default_factory=list, max_length=8)
    head_swap: bool = False
    body_swap: bool = False
    seed: Seed | None = None
    sampler: SamplerOpts | None = None
    size_hint: SizeHint | None = None
    loras: list[LoraEntry] = Field(default_factory=list, max_length=10)
    unet_name: UnetName | None = None
    film_grain: FilmGrain | None = None


class InpaintParams(Strict):
    mode: Literal["inpaint"]
    prompt: Prompt
    image: Filename  # RGBA PNG (alpha = mask) from /api/upload
    prompt_enhancer: bool = True
    invert_mask: bool = False
    mask_grow: int | None = Field(None, ge=-256, le=256)
    mask_blur: float | None = Field(None, ge=0, le=64)
    context_factor: float | None = Field(None, ge=1, le=10)
    context_pixels: int | None = Field(None, ge=0, le=2048)
    blend_pixels: int | None = Field(None, ge=0, le=256)
    output_multiple: int | None = Field(None, ge=1, le=128)
    target_megapixels: float | None = Field(None, gt=0, le=16)
    fix_edge_halo: bool = False
    seam: Literal["classic", "blend in"] = "classic"
    remover: bool = False
    mover: bool = False
    seed: Seed | None = None
    sampler: SamplerOpts | None = None
    # Display-only: the untouched original (plain upload) so the result can be compared with it later. Never reaches a node.
    source: Filename | None = None
    size_hint: SizeHint | None = None
    loras: list[LoraEntry] = Field(default_factory=list, max_length=10)
    unet_name: UnetName | None = None
    film_grain: FilmGrain | None = None


class OutpaintParams(Strict):
    mode: Literal["outpaint"]
    prompt: str = Field("", max_length=8000)  # empty = the default outpaint prompt
    image: Filename
    pad_left: int = Field(0, ge=0, le=16384)
    pad_top: int = Field(0, ge=0, le=16384)
    pad_right: int = Field(0, ge=0, le=16384)
    pad_bottom: int = Field(0, ge=0, le=16384)
    fill_mode: Literal["color", "edge", "edge pixel", "pillarbox blur", "mirror"] = "color"
    fill_color: Annotated[str, StringConstraints(pattern=r"^#[0-9A-Fa-f]{6}$")] = "#808080"
    backdrop_blur: float = Field(0.5, ge=0, le=1)
    feather: int = Field(32, ge=0, le=512)
    canvas_multiple: int = Field(32, ge=1, le=128)
    target_megapixels: float = Field(1.5, gt=0, le=16)
    fix_edge_halo: bool = False
    seam: Literal["classic", "blend in"] = "blend in"
    outpaint_lora_on: bool = True
    outpaint_lora_strength: float = Field(1.0, ge=0, le=5)
    seed: Seed | None = None
    sampler: SamplerOpts | None = None
    size_hint: SizeHint | None = None
    loras: list[LoraEntry] = Field(default_factory=list, max_length=10)
    unet_name: UnetName | None = None
    film_grain: FilmGrain | None = None

    @model_validator(mode="after")
    def _some_padding(self) -> "OutpaintParams":
        if not (self.pad_left or self.pad_top or self.pad_right or self.pad_bottom):
            raise ValueError("add padding on at least one side")
        return self


FaceView = Literal["front", "three_quarter_left", "left_profile", "three_quarter_right", "right_profile", "back"]
BodyView = Literal["front", "three_quarter_left", "left_side", "back", "right_side", "three_quarter_right"]


class CharSheetParams(Strict):
    """Character sheet: one photo in, a sheet of face close-ups and a sheet of full-body views out (Qwen/Klein multi-edit under the hood).

    separate = one render per view at full quality, stitched into two sheets afterwards.
    merged   = two renders (faces, body) that each draw a whole sheet in one picture: quicker, lower quality per view.
    """

    mode: Literal["charsheet"]
    image: ImageRef
    delivery: Literal["separate", "merged"] = "separate"
    face_views: list[FaceView] = Field(default_factory=lambda: ["front", "three_quarter_left", "left_profile", "three_quarter_right", "right_profile"], max_length=6)
    body_views: list[BodyView] = Field(default_factory=lambda: ["front", "three_quarter_left", "left_side", "back", "right_side", "three_quarter_right"], max_length=6)
    # Optional extra text about the character (outfit, hair colour...) added to every view's prompt.
    notes: str = Field("", max_length=1000)
    # Size of every face view / body view when separate, of the faces sheet / body sheet when merged. None = the tuned default.
    face_size: Size | None = None
    body_size: Size | None = None
    seed: Seed | None = None
    sampler: SamplerOpts | None = None
    size_hint: SizeHint | None = None
    loras: list[LoraEntry] = Field(default_factory=list, max_length=10)
    unet_name: UnetName | None = None
    film_grain: FilmGrain | None = None

    @model_validator(mode="after")
    def _views(self) -> "CharSheetParams":
        if len(set(self.face_views)) != len(self.face_views) or len(set(self.body_views)) != len(self.body_views):
            raise ValueError("each view can be chosen once")
        if not (self.face_views or self.body_views):
            raise ValueError("choose at least one view")
        return self


JobParams = Annotated[Union[CreateParams, MultiEditParams, InpaintParams, OutpaintParams, CharSheetParams], Field(discriminator="mode")]


class JobRequest(Strict):
    params: JobParams
