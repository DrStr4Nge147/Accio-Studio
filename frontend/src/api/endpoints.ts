import { get, post } from "./http";
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
