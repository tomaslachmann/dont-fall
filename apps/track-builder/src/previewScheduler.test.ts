import { describe, expect, it } from "vitest";
import { PreviewScheduler, STILL_BUDGET_MS } from "./previewScheduler.js";

const countingPreview = () => {
  const calls = { draw: 0, spin: 0 };
  return { calls, preview: { draw: () => void calls.draw++, spin: () => void calls.spin++ } };
};

describe("PreviewScheduler", () => {
  it("never draws a preview that is off screen or on the hidden tab", () => {
    const scheduler = new PreviewScheduler(() => 0);
    const { calls, preview } = countingPreview();
    scheduler.add(preview);

    for (let i = 0; i < 10; i++) scheduler.frame();

    expect(calls).toEqual({ draw: 0, spin: 0 });
  });

  it("draws a visible preview once as a still, not every frame", () => {
    const scheduler = new PreviewScheduler(() => 0);
    const { calls, preview } = countingPreview();
    scheduler.add(preview).visible = true;

    for (let i = 0; i < 10; i++) scheduler.frame();

    expect(calls).toEqual({ draw: 1, spin: 0 });
  });

  it("keeps only the hovered preview spinning", () => {
    const scheduler = new PreviewScheduler(() => 0);
    const hovered = countingPreview();
    const still = countingPreview();
    const slot = scheduler.add(hovered.preview);
    slot.visible = true;
    slot.hovered = true;
    scheduler.add(still.preview).visible = true;

    for (let i = 0; i < 5; i++) scheduler.frame();
    slot.hovered = false;
    scheduler.frame();

    expect(hovered.calls).toEqual({ draw: 0, spin: 5 });
    expect(still.calls).toEqual({ draw: 1, spin: 0 });
  });

  it("spreads first draws across frames once the time budget is spent, at least one per frame", () => {
    let clock = 0;
    const scheduler = new PreviewScheduler(() => clock);
    const previews = Array.from({ length: 4 }, () => {
      const counting = countingPreview();
      // Every draw is heavier than the whole budget.
      counting.preview.draw = () => {
        counting.calls.draw++;
        clock += STILL_BUDGET_MS + 1;
      };
      scheduler.add(counting.preview).visible = true;
      return counting;
    });

    scheduler.frame();
    expect(previews.map((p) => p.calls.draw)).toEqual([1, 0, 0, 0]);
    scheduler.frame();
    scheduler.frame();
    scheduler.frame();
    expect(previews.map((p) => p.calls.draw)).toEqual([1, 1, 1, 1]);
  });

  it("stops drawing a removed preview, even one stuck visible", () => {
    const scheduler = new PreviewScheduler();
    const counting = countingPreview();
    const slot = scheduler.add(counting.preview);
    slot.visible = true;
    scheduler.remove(slot);

    scheduler.frame();
    expect(counting.calls).toEqual({ draw: 0, spin: 0 });
  });
});
