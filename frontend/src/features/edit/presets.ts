import type { EditMode } from "./store";

export type PresetId = "head" | "body" | "remove" | "move";

export interface Preset {
  id: PresetId;
  mode: EditMode;
  label: string;
  prompt: string;
  tip: string;
}

/** One tap = enable the preset's LoRA and fill the prompt (texts from the user's workflow notes, APP_SPEC 6.4). */
export const PRESETS: Record<PresetId, Preset> = {
  head: {
    id: "head",
    mode: "multiedit",
    label: "Head swap",
    prompt:
      "head_swap: start with <image1> as the base image, keeping its lighting, environment, and background. remove the head from <image1> completely and replace it with the head from <image2>, strictly preserving the hair, eye color, nose structure from <image2>. copy the direction of the eye, head rotation, micro expressions from <image1>, high quality, sharp details, 4k",
    tip: "Puts the head from image 2 onto image 1. Needs two images.",
  },
  body: {
    id: "body",
    mode: "multiedit",
    label: "Body swap",
    prompt:
      "body_swap: start with <image1> as the base image, keeping its lighting, environment, and background. replace the body from <image1> with the body from <image2>, strictly preserving the clothing, body shape and proportions from <image2>. strictly replicate the exact pose, arm positions, leg positions, hand gestures, head rotation, eye direction and micro expressions from <image1>",
    tip: "Puts the body from image 2 onto image 1. Needs two images.",
  },
  remove: {
    id: "remove",
    mode: "inpaint",
    label: "Remove object",
    prompt: "Remove the red highlighted object from the scene",
    tip: "Draw a red box around the object to remove.",
  },
  move: {
    id: "move",
    mode: "inpaint",
    label: "Move object",
    prompt: "Move the object highlighted in the red box to the location indicated by the other red box in the scene.",
    tip: "Draw one red box around the object, then a second where it should go.",
  },
};

export const MULTI_PRESETS: PresetId[] = ["head", "body"];
export const INPAINT_PRESETS: PresetId[] = ["remove", "move"];

/** Boxes a preset needs: Remove at least 1, Move exactly 2. */
export const BOX_RULE: Partial<Record<PresetId, { min: number; max: number; hint: string }>> = {
  remove: { min: 1, max: 8, hint: "Draw a box around the object to remove." },
  move: { min: 2, max: 2, hint: "Draw two boxes: first around the object, then where it should go." },
};
