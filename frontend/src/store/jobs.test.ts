import { beforeEach, describe, expect, it } from "vitest";
import type { Job } from "../api/types";
import { useJobs } from "./jobs";

const job = (id: string, status: Job["status"], created_at: number) => ({ id, status, created_at, outputs: [], live: {} }) as unknown as Job;

beforeEach(() => useJobs.setState({ jobs: {}, order: [], selectedId: null, reveal: {}, preview: null }));

describe("jobs store selection", () => {
  it("keeps the canvas blank until a job is picked", () => {
    useJobs.getState().upsert([job("a", "done", 1), job("b", "done", 2)]);
    expect(useJobs.getState().selectedId).toBeNull();
    expect(useJobs.getState().order).toEqual(["b", "a"]);
  });

  it("stays blank after a deselect, even when later updates arrive", () => {
    useJobs.getState().upsert([job("a", "running", 1)]);
    useJobs.getState().select("a");
    useJobs.getState().select(null);
    useJobs.getState().upsert([job("a", "done", 1)]);
    expect(useJobs.getState().selectedId).toBeNull();
  });

  it("marks a job for the reveal only when it was seen running", () => {
    useJobs.getState().upsert([job("a", "running", 1), job("old", "done", 0)]);
    useJobs.getState().upsert([job("a", "done", 1), job("old", "done", 0)]);
    expect(Object.keys(useJobs.getState().reveal)).toEqual(["a"]);
  });
});
