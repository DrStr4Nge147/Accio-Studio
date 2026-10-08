export type JobStatus = "queued" | "running" | "done" | "error" | "cancelled";

export interface JobOutput {
  node: string;
  role: "final" | "first_pass";
  filename: string;
  subfolder: string;
  type: string;
}

export interface JobLive {
  node?: string;
  step?: number;
  max?: number;
  queue_ahead?: number;
  /** ComfyUI class of the node now executing (e.g. "KSampler", "VAEDecode"). */
  class?: string | null;
}

export interface Job {
  id: string;
  created_at: number;
  finished_at: number | null;
  mode: string;
  label: string;
  template: string;
  status: JobStatus;
  params: Record<string, any>;
  seeds: Record<string, number>;
  outputs: JobOutput[];
  prompt_used: string | null;
  error: string | null;
  warnings: string[];
  live: JobLive;
}

export interface Health {
  comfy_online: boolean;
  comfy_version?: string;
  missing_models: string[];
  missing_nodes: string[];
  warnings: string[];
  /** True when Accio owns the backend output folder, so deleting from the gallery also deletes the image files. */
  can_delete_files?: boolean;
}

export interface SamplerDefaults {
  steps: number;
  cfg: number;
  sampler_name: string;
  scheduler: string;
  denoise: number;
}

/** Spec of one ComfyUI input as returned by /object_info: [kind-or-options, opts?]. */
export type InputSpec = [string | string[], Record<string, any>?];

export interface EditDefaults {
  /** diffusion model the Edit workflows ship with */
  unet_name: string;
  multiedit: {
    sampler: SamplerDefaults;
    base_megapixels: number;
    ref_megapixels: number[];
    manual_width: number;
    manual_height: number;
  };
  inpaint: {
    sampler: SamplerDefaults;
    crop: Record<"context_factor" | "blend_pixels" | "output_multiple" | "mask_grow" | "mask_blur" | "context_pixels" | "target_megapixels", number>;
    seam: "classic" | "blend in";
  };
  outpaint: {
    sampler: SamplerDefaults;
    fill_mode: string;
    fill_color: string;
    backdrop_blur: number;
    feather: number;
    canvas_multiple: number;
    target_megapixels: number;
    seam: "classic" | "blend in";
    lora_strength: number;
    prompt: string;
  };
}

export interface Catalog {
  loras: string[];
  /** installed Qwen diffusion models the Edit modes can switch to */
  edit_models: string[];
  samplers: string[];
  schedulers: string[];
  variance: Record<string, InputSpec>;
  defaults: {
    standard: { width: number; height: number; sampler: SamplerDefaults };
    detailed: {
      width: number;
      height: number;
      pass1: SamplerDefaults;
      pass2: SamplerDefaults;
      turbo_pass1: { on: boolean; strength: number };
      turbo_pass2: { on: boolean; strength: number };
    };
    sharpen_strength: number;
    t_enhancer_strength: number;
    variance: Record<string, string | number>;
    edit: EditDefaults;
  };
}
