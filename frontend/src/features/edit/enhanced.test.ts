import { beforeEach, describe, expect, it } from "vitest";
import { showEnhanced, showOwn, useEnhancedView } from "./enhanced";
import { useEdit } from "./store";

const ed = () => useEdit.getState();
const latest = { id: "job1", text: "Rewritten: change the red circle to a blue square, keep everything else." };

beforeEach(() => {
  ed().reset("multiedit");
  ed().reset("inpaint");
  ed().setPrompt("multiedit", "make it blue");
  ed().patch({ enhancer: { multiedit: true, inpaint: true } });
  useEnhancedView.setState({ active: {}, saved: {}, draft: {} });
});

describe("showing the enhanced prompt in the prompt box", () => {
  it("puts the rewrite in the box and switches the enhancer off, so Generate sends it as it is", () => {
    showEnhanced("multiedit", latest);
    expect(ed().prompts.multiedit).toBe(latest.text);
    expect(ed().enhancer.multiedit).toBe(false);
    expect(useEnhancedView.getState().active.multiedit).toBe(true);
  });

  it("switching back restores the user's prompt and the enhancer setting they had", () => {
    showEnhanced("multiedit", latest);
    showOwn("multiedit", latest);
    expect(ed().prompts.multiedit).toBe("make it blue");
    expect(ed().enhancer.multiedit).toBe(true);
    expect(useEnhancedView.getState().active.multiedit).toBeUndefined();
  });

  it("an edit to the rewrite is kept when going back and forth", () => {
    showEnhanced("multiedit", latest);
    ed().setPrompt("multiedit", latest.text + " Make the square a bit smaller.");
    showOwn("multiedit", latest);
    showEnhanced("multiedit", latest);
    expect(ed().prompts.multiedit).toBe(latest.text + " Make the square a bit smaller.");
  });

  it("a newer rewrite replaces an old edited draft", () => {
    showEnhanced("multiedit", latest);
    ed().setPrompt("multiedit", "old edit");
    showOwn("multiedit", latest);
    showEnhanced("multiedit", { id: "job2", text: "Newer rewrite" });
    expect(ed().prompts.multiedit).toBe("Newer rewrite");
  });

  it("calling it twice does not overwrite the saved original prompt", () => {
    showEnhanced("multiedit", latest);
    showEnhanced("multiedit", latest);
    showOwn("multiedit", latest);
    expect(ed().prompts.multiedit).toBe("make it blue");
  });

  it("modes are independent", () => {
    ed().setPrompt("inpaint", "add a hat");
    showEnhanced("multiedit", latest);
    expect(ed().prompts.inpaint).toBe("add a hat");
    expect(ed().enhancer.inpaint).toBe(true);
  });
});
