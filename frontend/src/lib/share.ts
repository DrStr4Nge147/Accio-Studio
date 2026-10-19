export const canShareFiles = () => typeof navigator !== "undefined" && "share" in navigator && "canShare" in navigator;

/** Web Share with the image file; falls back silently when the browser can't share files. */
export async function shareImage(url: string, filename: string): Promise<void> {
  await shareImages([{ url, filename }]);
}

/** Web Share with several image files at once; returns false when the browser refuses that many files. */
export async function shareImages(images: { url: string; filename: string }[]): Promise<boolean> {
  const files = await Promise.all(
    images.map(async ({ url, filename }) => {
      const blob = await (await fetch(url)).blob();
      return new File([blob], filename, { type: blob.type || "image/png" });
    }),
  );
  if (!navigator.canShare?.({ files })) return false;
  await navigator.share({ files });
  return true;
}

/** Saves each image through a temporary link; browsers may ask once to allow multiple downloads. */
export async function downloadImages(images: { url: string; filename: string }[]): Promise<void> {
  for (const { url, filename } of images) {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    await new Promise((r) => setTimeout(r, 250)); // spaced out so the browser doesn't drop them
  }
}
