import { describe, expect, it } from "vitest";
import { attachmentConflictReason } from "./Attachment.js";

describe("attachmentConflictReason (ADR 0099)", () => {
  it("lets a Prop stand alone, and names every Attachment beside it in registry order", () => {
    expect(attachmentConflictReason({ prop: true })).toBeUndefined();
    expect(attachmentConflictReason({ prop: true, launch: { height: 6 }, conveyor: { preset: "slow", angle: 0 } })).toMatch(
      /^prop cannot be combined with a Conveyor, a launch height — a Prop is a body physics owns/,
    );
    expect(attachmentConflictReason({ prop: true, start: true, checkpoint: { order: 1 } })).toMatch(/the Start, a Checkpoint/);
  });

  it("allows one Surface per deck and names a stack bottom sheet first", () => {
    expect(attachmentConflictReason({ bounce: true, conveyor: { preset: "fast", angle: 0 } })).toBeUndefined();
    expect(attachmentConflictReason({ bounce: true, ice: true })).toMatch(/^ice and bounce are mutually exclusive/);
  });

  it("lets paint ride on a Prop — visual-only — while everything behavioral stays refused", () => {
    expect(attachmentConflictReason({ prop: true, color: "red" })).toBeUndefined();
    expect(attachmentConflictReason({ prop: true, color: "blue", conveyor: { preset: "slow", angle: 0 } })).toMatch(
      /^prop cannot be combined with a Conveyor — /,
    );
  });
});
