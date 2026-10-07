import { buildInpaintPng, type ExportArgs } from "./inpaintExport";

self.onmessage = async (e: MessageEvent<ExportArgs>) => {
  try {
    const bytes = await buildInpaintPng(e.data);
    (self as unknown as Worker).postMessage({ ok: true, bytes }, [bytes.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: err instanceof Error ? err.message : "export failed" });
  }
};
