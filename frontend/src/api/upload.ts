import { ApiError } from "./http";

export type UploadKind = "media" | "image" | "mask";

/** Raw image upload with progress (fetch has no upload progress). Resolves with the server's file name. */
export function uploadImage(kind: UploadKind, body: Blob, onProgress?: (fraction: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/upload?kind=${kind}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onerror = () => reject(new ApiError("Can't reach the Accio server. Check that it is running.", 0, "network"));
    xhr.onload = () => {
      let json: any = null;
      try {
        json = JSON.parse(xhr.responseText);
      } catch {
        /* non-JSON body */
      }
      if (xhr.status >= 200 && xhr.status < 300 && json?.file) resolve(String(json.file));
      else reject(new ApiError(json?.error?.message ?? "Couldn't upload the image.", xhr.status, json?.error?.code ?? "http"));
    };
    xhr.send(body);
  });
}

/** Where an image this app uploaded can be fetched back from (preview, compare, reuse). */
export const inputUrl = (kind: "media" | "image", file: string) => `/api/input/${kind}/${file}`;
