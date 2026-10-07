import { fetchJob, fetchJobs } from "./endpoints";
import type { Job } from "./types";
import { useAuth } from "../store/auth";
import { isActive, useJobs } from "../store/jobs";

/** One app WebSocket with auto-reconnect. Jobs live on the server: after every (re)connect we re-fetch state. */
let started = false;
let attached = false;

function previewMime(buf: ArrayBuffer): string {
  // ComfyUI binary frame: uint32 event type, uint32 image format (1 = JPEG, 2 = PNG), then the image.
  return new DataView(buf).getUint32(4) === 2 ? "image/png" : "image/jpeg";
}

async function resync(snapshot: Job[]) {
  useJobs.getState().upsert(snapshot);
  const live = new Set(snapshot.map((j) => j.id));
  // Jobs we believed active that are not in the snapshot finished while we were away.
  const stale = Object.values(useJobs.getState().jobs).filter((j) => isActive(j) && !live.has(j.id));
  const refreshed = await Promise.all(stale.map((j) => fetchJob(j.id).catch(() => null)));
  useJobs.getState().upsert(refreshed.filter((j): j is Job => !!j));
  const recent = await fetchJobs().catch(() => [] as Job[]);
  useJobs.getState().upsert(recent);
  // On first load, re-attach to a job that is already running (the canvas stays blank otherwise).
  if (!attached) {
    attached = true;
    const running = Object.values(useJobs.getState().jobs).find(isActive);
    if (running && !useJobs.getState().selectedId) useJobs.getState().select(running.id);
  }
}

export function startSocket() {
  if (started) return;
  started = true;
  let delay = 1000;

  const connect = () => {
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/ws`);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      delay = 1000;
      useJobs.getState().setConnected(true);
    };
    ws.onmessage = (m) => {
      if (typeof m.data !== "string") {
        const buf = m.data as ArrayBuffer;
        if (buf.byteLength > 8) {
          useJobs.getState().setPreview(URL.createObjectURL(new Blob([buf.slice(8)], { type: previewMime(buf) })));
        }
        return;
      }
      const msg = JSON.parse(m.data);
      if (msg.type === "snapshot") void resync(msg.jobs as Job[]);
      else if (msg.type === "job") useJobs.getState().upsert([msg.job as Job]);
    };
    ws.onclose = () => {
      useJobs.getState().setConnected(false);
      // A refused socket may mean the session ended: ask the server before retrying, and stop if we are signed out.
      void useAuth
        .getState()
        .refresh()
        .then(() => {
          if (useAuth.getState().status?.authenticated === false) {
            started = false;
            return;
          }
          setTimeout(connect, delay);
          delay = Math.min(delay * 2, 10000);
        });
    };
    ws.onerror = () => ws.close();
  };
  connect();
}
