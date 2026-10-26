import { describe, expect, it } from "vitest";
import { loraGroup, loraLabel, lorasForMode } from "./loras";

describe("loras", () => {
  it("groups by folder with either path separator", () => {
    expect(loraGroup("krea2/a.safetensors")).toBe("create");
    expect(loraGroup("krea2\\a.safetensors")).toBe("create");
    expect(loraGroup("qwen/b.safetensors")).toBe("edit");
    expect(loraGroup("c.safetensors")).toBe("shared");
    expect(loraGroup("other/d.safetensors")).toBe("shared");
    expect(loraGroup("krea2.safetensors")).toBe("shared"); // a file, not the folder
    expect(loraGroup("moss/m.safetensors")).toBe("create");
    expect(loraGroup("qwen2.1-edit\\e.safetensors")).toBe("edit");
    expect(loraGroup("flux-klein9b-edit/f.safetensors")).toBe("edit");
  });

  it("labels without folder or extension", () => {
    expect(loraLabel("krea2\\sub\\my_lora.safetensors")).toBe("my_lora");
  });

  it("offers a mode's own folder, never the other family's, and sorts recently used shared ones up", () => {
    const all = ["qwen/q.safetensors", "krea2/k.safetensors", "b.safetensors", "a.safetensors"];
    const r = lorasForMode(all, "create", { "b.safetensors": "create", "a.safetensors": "edit" });
    expect(r.own).toEqual(["krea2/k.safetensors"]);
    expect(r.shared).toEqual(["b.safetensors", "a.safetensors"]);
  });

  it("splits a mode's own LoRAs by folder", () => {
    const all = ["qwen2.1-edit/q.safetensors", "flux-klein9b-edit/f.safetensors", "krea2/k.safetensors"];
    const r = lorasForMode(all, "edit", {});
    expect(r.folders.map((f) => f.folder)).toEqual(["flux-klein9b-edit", "qwen2.1-edit"]);
  });
});
