import { describe, expect, it } from "vitest";
import { maskFromUploadPixels } from "./maskFromUpload";

describe("maskFromUploadPixels", () => {
  it("turns transparent (painted) into opaque white and opaque (untouched) into transparent", () => {
    const px = new Uint8Array([10, 20, 30, 0, 40, 50, 60, 255, 70, 80, 90, 128]);
    maskFromUploadPixels(px);
    expect([...px]).toEqual([255, 255, 255, 255, 255, 255, 255, 0, 255, 255, 255, 127]);
  });
});
