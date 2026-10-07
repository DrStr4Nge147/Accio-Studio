/** The server returns { error: { code, message } } with already-friendly text; show it as is. */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
  }
}

let authLost: (() => void) | null = null;
/** Called when the server says the session is gone (expired, signed out elsewhere, password changed). */
export const setAuthLostHandler = (fn: () => void) => {
  authLost = fn;
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiError("Can't reach the Accio server. Check that it is running.", 0, "network");
  }
  if (!res.ok) {
    let message = "Something went wrong.";
    let code = "http";
    try {
      const body = await res.json();
      if (body?.error?.message) {
        message = body.error.message;
        code = body.error.code ?? code;
      } else if (Array.isArray(body?.detail)) {
        message = "Some settings were not accepted. Check the values and try again.";
        code = "invalid";
      }
    } catch {
      /* non-JSON error body */
    }
    if (res.status === 401 && (code === "auth" || code === "setup_required") && !url.startsWith("/api/auth/")) authLost?.();
    throw new ApiError(message, res.status, code);
  }
  return (await res.json()) as T;
}

export const get = <T,>(url: string) => request<T>(url);
export const post = <T,>(url: string, body?: unknown) =>
  request<T>(url, {
    method: "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

export const del = <T,>(url: string) => request<T>(url, { method: "DELETE" });

/** Full-size result, or a cached WebP thumbnail (longest side 384 or 1024 px) for lists. */
export const imageUrl = (jobId: string, index: number, size?: 384 | 1024) =>
  `/api/jobs/${jobId}/image/${index}${size ? `?size=${size}` : ""}`;
