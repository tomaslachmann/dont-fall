import { afterEach, describe, expect, it, vi } from "vitest";
import { PERF_COPY_HINT, createPerfOverlay } from "./perfOverlay.js";

describe("createPerfOverlay (M13 ticket 01)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows its text in the mount and leaves nothing behind on dispose", () => {
    const mount = document.createElement("div");
    const overlay = createPerfOverlay(mount, () => {});
    overlay.setText("frame p95 16.7");
    expect(mount.textContent).toContain("frame p95 16.7");
    overlay.dispose();
    expect(mount.childElementCount).toBe(0);
  });

  it("copies on F8 once per press, and stops listening once disposed", () => {
    const onCopy = vi.fn();
    const overlay = createPerfOverlay(document.createElement("div"), onCopy);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "F8" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "F8", repeat: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyF" }));
    expect(onCopy).toHaveBeenCalledTimes(1);
    overlay.dispose();
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "F8" }));
    expect(onCopy).toHaveBeenCalledTimes(1);
  });

  it("copies on its button — the way that works on a Mac, where F8 is a media key", () => {
    const onCopy = vi.fn();
    const mount = document.createElement("div");
    const overlay = createPerfOverlay(mount, onCopy);
    const button = mount.querySelector("button")!;
    expect(button.textContent).toBe("copy run");
    expect(button.style.pointerEvents).toBe("auto");
    expect(mount.textContent).toContain(PERF_COPY_HINT);
    button.click();
    expect(onCopy).toHaveBeenCalledTimes(1);
    overlay.dispose();
  });

  it("shows a flash for a moment", () => {
    vi.useFakeTimers();
    const mount = document.createElement("div");
    const overlay = createPerfOverlay(mount, () => {});
    overlay.flash("run copied");
    expect(mount.textContent).toContain("run copied");
    vi.advanceTimersByTime(3000);
    expect(mount.textContent).not.toContain("run copied");
    overlay.dispose();
  });
});
