import { describe, expect, it } from "vitest";
import { BombCues } from "./bombSounds.js";

const lit = (secondsLeft: number, fast = false) => ({ kind: "lit" as const, fast, secondsLeft });
const spent = (secondsSince: number, blasted = true) => ({ kind: "spent" as const, blasted, secondsSince });

describe("a Bomb's sound cues (ADR 0126)", () => {
  it("lights once, hurries once at the warning, and blasts once on its Tick", () => {
    const cues = new BombCues();
    const heard = [
      cues.update(0, { kind: "lying" }),
      cues.update(0, lit(5)),
      cues.update(0, lit(4)),
      cues.update(0, lit(1.4, true)),
      cues.update(0, lit(1, true)),
      cues.update(0, spent(-0.1)), // the clip leads the blast: still burning
      cues.update(0, spent(0.02)),
      cues.update(0, spent(0.5)),
    ];

    expect(heard).toEqual([null, "light", null, "warn", null, null, "blast", null]);
  });

  it("goes quiet without a boom when it falls off and goes out", () => {
    const cues = new BombCues();
    cues.update(0, lit(3));

    expect(cues.update(0, spent(0, false))).toBe("out");
  });

  it("does not boom for an explosion that was already over when it was first seen", () => {
    const cues = new BombCues();

    expect(cues.update(0, spent(1.5))).toBeNull();
  });
});
