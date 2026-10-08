/** Flux2 Klein (GGUF) edit models run a separate workflow: Multi-edit only, up to 3 images, no Qwen-only extras. Mirrors engine.is_klein. */
export const isKleinModel = (model: string | undefined): boolean => !!model && /klein/i.test(model) && /\.gguf$/i.test(model);

export const KLEIN_MAX_IMAGES = 3;
