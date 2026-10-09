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


class CreateParams(Strict):
    mode: Literal["create"]
    variant: Literal["standard", "detailed"]
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
    loras: list[LoraEntry] = Field(default_factory=list, max_length=10)
    film_grain: FilmGrain | None = None


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


JobParams = Annotated[Union[CreateParams, MultiEditParams, InpaintParams, OutpaintParams], Field(discriminator="mode")]


class JobRequest(Strict):
    params: JobParams
