import type { PropSnapshot, ShooterConfig } from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import { ShooterEffects } from "./shooterEffects.js";

const ball = (live: boolean): PropSnapshot => ({ position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, atRest: false, live });
const shooter = { segmentIndex: 0, propIndices: [1, 2] } as unknown as ShooterConfig;

describe("ShooterEffects — what a shot is heard from", () => {
  it("names each ball on the frame it leaves the barrel, and never again while it flies", () => {
    const effects = new ShooterEffects([shooter], () => []);
    const other = ball(true);

    expect(effects.update([other, ball(false), ball(false)], 0)).toEqual([]);
    expect(effects.update([other, ball(true), ball(false)], 16)).toEqual([1]);
    expect(effects.update([other, ball(true), ball(false)], 32)).toEqual([]);
    expect(effects.update([other, ball(false), ball(true)], 48)).toEqual([2]);
  });
});
