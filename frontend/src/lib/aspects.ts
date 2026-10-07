/**
 * Aspect presets for Create (~2.07 MP, multiples of 16; APP_SPEC 6.3). 16:9 and 9:16 are the workflow's own sizes.
 * 1:1, 4:3 and 3:2 are marked tested from community reports (Krea 2 Turbo): each sits inside the megapixel range where
 * that ratio stayed stable (1:1 up to 6.0 MP, 4:3 up to 3.2 MP, 3:2 up to 2.5 MP) and every side is within the model's
 * 1024-2048 px range. No report covers 2:3 or 3:4 directly, so those keep the hint.
 */
export interface Aspect {
  key: string;
  w: number;
  h: number;
  /** No test report found for this exact ratio: surfaced as a non-blocking hint. */
  untested: boolean;
}

export const ASPECTS: Aspect[] = [
  { key: "9:16", w: 1080, h: 1920, untested: false },
  { key: "2:3", w: 1176, h: 1760, untested: true },
  { key: "3:4", w: 1248, h: 1664, untested: true },
  { key: "1:1", w: 1440, h: 1440, untested: false },
  { key: "4:3", w: 1664, h: 1248, untested: false },
  { key: "3:2", w: 1760, h: 1176, untested: false },
  { key: "16:9", w: 1920, h: 1080, untested: false },
];

export const CUSTOM = "custom";
export const MIN_DIM = 64;
export const MAX_DIM = 8192;

export const aspectFor = (w: number, h: number) => ASPECTS.find((a) => a.w === w && a.h === h);
export const snap8 = (n: number) => Math.min(MAX_DIM, Math.max(MIN_DIM, Math.round(n / 8) * 8));
