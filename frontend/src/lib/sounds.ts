/** Synthesized "finished" sounds (no audio files to ship). Each one schedules itself on the context at time `t`. */

type Wave = OscillatorType;

/** One note: fast attack, exponential decay to silence over `dur` seconds. */
function note(c: AudioContext, freq: number, t: number, dur: number, vol = 0.22, type: Wave = "sine") {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(c.destination);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

/** A struck bell: inharmonic partials, the higher ones dying faster. */
function bell(c: AudioContext, freq: number, t: number, dur: number, vol = 0.2) {
  [[1, 1], [2.76, 0.5], [5.4, 0.25], [8.93, 0.12]].forEach(([ratio, amp], i) => note(c, freq * ratio, t, dur / (1 + i * 0.6), vol * amp));
}

const C5 = 523.25, D5 = 587.33, E5 = 659.25, F5 = 698.46, G5 = 783.99, A5 = 880, B5 = 987.77, C6 = 1046.5, E6 = 1318.5, G6 = 1568;

export interface Sound {
  id: string;
  label: string;
  /** Approximate length in seconds, shown in the picker. */
  length: number;
  play: (c: AudioContext, t: number) => void;
}

export const SOUNDS: Sound[] = [
  { id: "chime", label: "Chime", length: 0.7, play: (c, t) => [660, 880].forEach((f, i) => note(c, f, t + i * 0.16, 0.5)) },
  { id: "ding", label: "Ding", length: 1.2, play: (c, t) => bell(c, 1318.5, t, 1.2, 0.25) },
  { id: "pluck", label: "Marimba", length: 1.0, play: (c, t) => [C5, E5, G5, C6].forEach((f, i) => note(c, f, t + i * 0.1, 0.45, 0.28, "triangle")) },
  { id: "dingdong", label: "Ding dong", length: 2.2, play: (c, t) => { bell(c, 784, t, 1.2); bell(c, 587.33, t + 0.55, 1.6); } },
  { id: "harp", label: "Harp", length: 2.0, play: (c, t) => [C5, E5, G5, C6, E6, G6].forEach((f, i) => note(c, f, t + i * 0.13, 1.2 - i * 0.05, 0.18, "triangle")) },
  { id: "sparkle", label: "Sparkle", length: 1.6, play: (c, t) => [C6, E6, G6, C6 * 2, G6, E6, C6 * 2, G6 * 1.26].forEach((f, i) => note(c, f, t + i * 0.08, 0.7, 0.1)) },
  { id: "levelup", label: "Level up", length: 1.5, play: (c, t) => [C5, E5, G5, C6, G5, C6, E6].forEach((f, i) => note(c, f, t + i * 0.1, i === 6 ? 0.7 : 0.18, 0.12, "square")) },
  { id: "fanfare", label: "Fanfare", length: 3.0, play: (c, t) => {
      [[G5, 0], [G5, 0.2], [G5, 0.4], [C6, 0.6]].forEach(([f, d]) => note(c, f, t + d, 0.35, 0.14, "sawtooth"));
      [[C5, 0.6], [E5, 0.6], [G5, 0.6]].forEach(([f, d]) => note(c, f, t + d, 2.2, 0.1, "sawtooth"));
      note(c, E6, t + 1.2, 1.8, 0.14, "sawtooth");
    } },
  { id: "musicbox", label: "Music box", length: 3.4, play: (c, t) => {
      const tune = [G5, E5, G5, C6, B5, G5, A5, F5, E5, D5, E5, C5];
      tune.forEach((f, i) => bell(c, f, t + i * 0.24, 0.9, 0.1));
    } },
  { id: "bowl", label: "Singing bowl", length: 4.5, play: (c, t) => { note(c, 261.6, t, 4.5, 0.3); note(c, 523.3, t, 3.5, 0.12); note(c, 785.5, t + 0.05, 2.5, 0.05); note(c, 264, t, 4.5, 0.2); } },
  { id: "arrival", label: "Arrival", length: 3.2, play: (c, t) => {
      [[C5, 0], [E5, 0.35], [G5, 0.7], [C6, 1.05]].forEach(([f, d]) => bell(c, f, t + d, 1.4, 0.14));
      [C5, E5, G5, C6].forEach((f) => note(c, f, t + 1.5, 1.7, 0.08, "triangle"));
    } },
];

export const DEFAULT_SOUND = "chime";

export function findSound(id: string): Sound {
  return SOUNDS.find((s) => s.id === id) ?? SOUNDS[0];
}
