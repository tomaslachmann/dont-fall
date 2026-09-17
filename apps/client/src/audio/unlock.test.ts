import { describe, expect, it, vi } from "vitest";
import { resumeOnFirstGesture } from "./unlock.js";

describe("resumeOnFirstGesture (M14 ticket 02)", () => {
  it("resumes a suspended context on the first gesture, then stops listening", async () => {
    const target = new EventTarget();
    const context = { state: "suspended", resume: vi.fn(async () => { context.state = "running"; }) };
    resumeOnFirstGesture(context, target);
    expect(context.resume).not.toHaveBeenCalled();
    target.dispatchEvent(new Event("pointerdown"));
    await Promise.resolve();
    await Promise.resolve();
    target.dispatchEvent(new Event("keydown"));
    expect(context.resume).toHaveBeenCalledTimes(1);
  });

  it("does nothing for a context already running", () => {
    const target = new EventTarget();
    const add = vi.spyOn(target, "addEventListener");
    resumeOnFirstGesture({ state: "running", resume: vi.fn() }, target);
    expect(add).not.toHaveBeenCalled();
  });

  it("keeps listening when the browser refuses a resume", async () => {
    const target = new EventTarget();
    const context = { state: "suspended", resume: vi.fn(async () => { throw new Error("not allowed"); }) };
    resumeOnFirstGesture(context, target);
    target.dispatchEvent(new Event("pointerdown"));
    await Promise.resolve();
    await Promise.resolve();
    target.dispatchEvent(new Event("pointerdown"));
    expect(context.resume).toHaveBeenCalledTimes(2);
  });
});
