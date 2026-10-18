import { isActive, useJobs } from "../store/jobs";
import { useUi } from "../store/ui";
import { findSound } from "./sounds";

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    return ctx;
  } catch {
    return null;
  }
}

/** Browsers only allow sound after a user gesture: prepare the audio context on the first tap or click. */
export function watchNotifyUnlock() {
  const unlock = () => {
    void audio()?.resume();
    removeEventListener("pointerdown", unlock);
  };
  addEventListener("pointerdown", unlock);
}

let keep: { osc: OscillatorNode; gain: GainNode } | null = null;

function setKeepAlive(on: boolean) {
  if (on && !keep) {
    const c = audio();
    if (!c) return;
    void c.resume();
    // An inaudible but non-silent tone keeps the audio session open, so the browser does not freeze or mute a background tab mid-generation.
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.frequency.value = 40;
    gain.gain.value = 0.0005;
    osc.connect(gain).connect(c.destination);
    osc.start();
    keep = { osc, gain };
  } else if (!on && keep) {
    keep.osc.stop();
    keep.osc.disconnect();
    keep.gain.disconnect();
    keep = null;
  }
}

/** Hold the audio session open while a job runs, so the finish chime can sound from a background tab. Call once at startup. */
export function watchNotifyKeepAlive() {
  const sync = () => setKeepAlive(useUi.getState().notifyOnDone && Object.values(useJobs.getState().jobs).some(isActive));
  useJobs.subscribe((s, prev) => {
    sync();
    // Any path that moves a job from active to done counts, including a resync after the socket dropped in the background.
    if (Object.values(s.jobs).some((j) => j.status === "done" && isActive(prev.jobs[j.id]))) notifyDone();
  });
  useUi.subscribe(sync);
}

/** Play one of the finish sounds now (the settings picker uses this to preview). */
export function playSound(id: string) {
  const c = audio();
  if (!c) return;
  void c.resume().then(() => findSound(id).play(c, c.currentTime + 0.02));
}

/** A generation finished: play the chosen sound (works in a background tab once the page has been clicked). */
export function notifyDone() {
  if (useUi.getState().notifyOnDone) playSound(useUi.getState().notifySound);
}
