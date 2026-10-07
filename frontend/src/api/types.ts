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

export interface Catalog {
  loras: string[];
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
  };
}
