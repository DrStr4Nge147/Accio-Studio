import { describe, expect, it } from "vitest";
import { setupBlocker } from "./AuthScreen";

describe("setupBlocker", () => {
  it("wants a long enough password", () => expect(setupBlocker("short", "short", false, "")).toMatch(/at least 10/));
  it("wants both entries to match", () => expect(setupBlocker("long enough pw", "long enough pW", false, "")).toMatch(/match/));
  it("wants the setup code only from afar", () => {
    expect(setupBlocker("long enough pw", "long enough pw", true, " ")).toMatch(/setup code/);
    expect(setupBlocker("long enough pw", "long enough pw", true, "abc")).toBeNull();
    expect(setupBlocker("long enough pw", "long enough pw", false, "")).toBeNull();
  });
});
