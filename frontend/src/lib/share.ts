export const canShareFiles = () => typeof navigator !== "undefined" && "share" in navigator && "canShare" in navigator;

/** Web Share with the image file; falls back silently when the browser can't share files. */
export async function shareImage(url: string, filename: string): Promise<void> {
  const blob = await (await fetch(url)).blob();
  const file = new File([blob], filename, { type: blob.type || "image/png" });
  if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file] });
}
