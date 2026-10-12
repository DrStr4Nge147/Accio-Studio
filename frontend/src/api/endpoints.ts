import { del, get, post, put } from "./http";
import type { Catalog, Health, Job } from "./types";

export const fetchHealth = () => get<Health>("/api/health");
export const fetchCatalog = () => get<Catalog>("/api/catalog");
export const fetchJobs = (limit = 40) => get<{ jobs: Job[] }>(`/api/jobs?limit=${limit}`).then((r) => r.jobs);
export const fetchJob = (id: string) => get<Job>(`/api/jobs/${id}`);
export const submitJob = (params: Record<string, unknown>) => post<Job>("/api/jobs", { params });
export const cancelJob = (id: string) => post<Job>(`/api/jobs/${id}/cancel`);

export interface LogChunk {
  available: boolean;
  external?: boolean;
  offset: number;
  text: string;
  reset: boolean;
}
export const fetchComfyLog = (after: number | null) => get<LogChunk>(after === null ? "/api/logs/comfy" : `/api/logs/comfy?after=${after}`);

export interface AuthStatus {
  configured: boolean;
  authenticated: boolean;
  /** First-run setup from another device needs the code printed in the server window. */
  setup_code_needed: boolean;
}
export const fetchAuthStatus = () => get<AuthStatus>("/api/auth/status");
export const setupPassword = (password: string, code?: string) => post<{ ok: true }>("/api/auth/setup", { password, code: code || undefined });
export const login = (password: string) => post<{ ok: true }>("/api/auth/login", { password });
export const logout = () => post<{ ok: true }>("/api/auth/logout");
export const changePassword = (current: string, next: string) => post<{ ok: true }>("/api/auth/password", { current, new: next });

export interface Connection {
  mode: "local" | "cloudflare" | "zrok" | "tailscale";
  status: string;
  public_url: string | null;
  urls: { local: string; lan: string | null };
  /** SVG data URI of a QR code for `qr_url`. */
  qr: string;
  qr_url: string;
  auto_unload_minutes: number;
}
export const fetchConnection = () => get<Connection>("/api/connection");

export interface JobsPage {
  before?: number;
  group?: "create" | "edit";
  limit?: number;
}
/** Finished jobs, newest first; pass the last job's created_at as `before` for the next page. */
export const fetchDoneJobs = ({ before, group, limit = 60 }: JobsPage = {}) => {
  const q = new URLSearchParams({ status: "done", limit: String(limit) });
  if (before !== undefined) q.set("before", String(before));
  if (group) q.set("group", group);
  return get<{ jobs: Job[] }>(`/api/jobs?${q}`).then((r) => r.jobs);
};
export interface DeleteResult {
  ok: true;
  files_deleted: number;
  /** Image files left on disk (external backend, or a file that could not be removed). */
  files_kept: number;
}
export const deleteJob = (id: string) => del<DeleteResult>(`/api/jobs/${id}`);

export interface UpdateInfo {
  current: string;
  /** false when check_updates is switched off in settings.json: the server never contacts GitHub then. */
  enabled: boolean;
  latest: string | null;
  available: boolean;
  notes_url: string | null;
  /** true only in the browser on the PC that runs Accio: that is the only place the updater may be started. */
  can_apply: boolean;
  error: string | null;
}
export const fetchUpdate = (refresh = false) => get<UpdateInfo>(`/api/update${refresh ? "?refresh=true" : ""}`);
export const applyUpdate = () => post<{ started: true; latest: string }>("/api/update/apply");

export interface SystemGpu {
  name: string;
  vram_mb: number | null;
  driver: string | null;
}
export interface SystemInfo {
  gpus: SystemGpu[];
  /** Newest CUDA the Nvidia driver supports (nvidia-smi); null without an Nvidia driver. */
  driver_cuda: string | null;
  /** CUDA the backend's PyTorch was built for; null while the backend is offline or on a non-CUDA build. */
  engine_cuda: string | null;
  ram_mb: number | null;
}
export const fetchSystem = () => get<SystemInfo>("/api/system");

export interface ModelPathField {
  kind: "diffusion_models" | "text_encoders" | "vae" | "loras";
  label: string;
  path: string;
  /** The app's own folder for this kind, used when the field is empty. */
  default: string;
  /** Model files in the saved folder (null when it is not there). */
  found: number | null;
  missing: boolean;
}
export interface ModelPaths {
  /** false when an external backend is configured: its folders are set up there. */
  available: boolean;
  /** True in the browser on the PC that runs Accio: the native folder dialog can open there. */
  can_pick: boolean;
  restart: { state: "idle" | "restarting" | "ready" | "failed"; message: string };
  families: { id: string; label: string; fields: ModelPathField[] }[];
}
export type ModelPathValues = Record<string, Record<string, string>>;
export interface FolderListing {
  path: string;
  /** "" = the drives list is the parent; null = already showing the drives. */
  parent: string | null;
  folders: string[];
  drives: boolean;
}
export const browseFolders = (path: string) => get<FolderListing>(`/api/model-paths/browse?path=${encodeURIComponent(path)}`);
/** Opens Windows' folder dialog on the PC (waits for the choice); path is null when cancelled. */
export const pickFolder = (start: string) => post<{ path: string | null }>("/api/model-paths/pick", { start });
export const fetchModelPaths = () => get<ModelPaths>("/api/model-paths");
export const saveModelPaths = (paths: ModelPathValues) => put<{ restart: ModelPaths["restart"] }>("/api/model-paths", { paths });
