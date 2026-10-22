import { describe, expect, it } from "vitest";
import { mergeDocs, type UserDoc } from "./userdataSync";

const t = (id: string, name: string, target: "create" | "edit" = "create") => ({ id, name, text: `text of ${name}`, target });

describe("mergeDocs", () => {
  it("keeps the server's lists and adds what only this device has", () => {
    const remote: UserDoc = { templates: [t("1", "Portrait")], trigger_words: { "a.safetensors": ["one"] } };
    const mine: UserDoc = { templates: [t("2", "Landscape")], trigger_words: { "b.safetensors": ["two"] } };
    expect(mergeDocs(remote, mine)).toEqual({
      templates: [t("1", "Portrait"), t("2", "Landscape")],
      trigger_words: { "a.safetensors": ["one"], "b.safetensors": ["two"] },
    });
  });
  it("does not duplicate a template with the same name for the same target, whatever the case", () => {
    const remote: UserDoc = { templates: [t("1", "Portrait")], trigger_words: {} };
    const mine: UserDoc = { templates: [t("9", "portrait"), t("8", "Portrait", "edit")], trigger_words: {} };
    expect(mergeDocs(remote, mine).templates.map((x) => x.id)).toEqual(["1", "8"]);
  });
  it("unions the trigger words of the same LoRA without repeats", () => {
    const remote: UserDoc = { templates: [], trigger_words: { "a.safetensors": ["one", "two"] } };
    const mine: UserDoc = { templates: [], trigger_words: { "a.safetensors": ["two", "three"] } };
    expect(mergeDocs(remote, mine).trigger_words).toEqual({ "a.safetensors": ["one", "two", "three"] });
  });
});
