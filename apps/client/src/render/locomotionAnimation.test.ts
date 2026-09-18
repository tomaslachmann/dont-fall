import { SURFACES, slopeSpeedMultiplier, WALK_SPEED, WALKABLE_SLOPE_MAX_ANGLE } from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import { RUN_FROM_SPEED, selectLocomotion, WALK_BELOW_SPEED, type LocomotionInput } from "./locomotionAnimation.js";

/** A Character on the ground at full walking pace, doing nothing else. */
const at = (overrides: Partial<LocomotionInput>): LocomotionInput => ({
  moving: true,
  grounded: true,
  dashing: false,
  speed: WALK_SPEED,
  ...overrides,
});

describe("selectLocomotion", () => {
  it("is idle when grounded, not moving, not dashing", () => {
    expect(selectLocomotion(at({ moving: false, speed: 0 }))).toBe("idle");
  });

  it("runs at full walking pace — a race's ordinary gait is the Run (ADR 0081)", () => {
    expect(selectLocomotion(at({}))).toBe("run");
  });

  // ADR 0081 had mud running everywhere, including up the steepest walkable
  // slope, on the arithmetic of a 0.5 multiplier. ADR 0094 cut mud to 0.4 to
  // make it the harshest floor in the game, which moves that corner: flat mud
  // still runs, and mud up a 35° slope is now slow enough to trudge — which is
  // what the penalty should look like.
  it("runs on flat mud, and trudges up the steepest walkable slope of it", () => {
    const flatMud = WALK_SPEED * SURFACES.mud!.topSpeedMultiplier;
    expect(selectLocomotion(at({ speed: flatMud }))).toBe("run");
    expect(selectLocomotion(at({ speed: flatMud, walking: true }))).toBe("run");

    // Uphill along +Z: the ground's normal leans back toward −Z.
    const steepest = WALKABLE_SLOPE_MAX_ANGLE;
    const uphill = slopeSpeedMultiplier(
      { x: 0, y: 0, z: 1 },
      { x: 0, y: Math.cos(steepest), z: -Math.sin(steepest) },
    );
    expect(uphill).toBeLessThan(1);
    const mudUphill = flatMud * uphill;
    // Already running, it keeps the run — the hysteresis gap is what stops a
    // Character flickering between clips as the slope steepens under it.
    expect(selectLocomotion(at({ speed: mudUphill }))).toBe("run");
    // From a standstill it never gets going: the walking threshold decides.
    expect(selectLocomotion(at({ speed: mudUphill, walking: true }))).toBe("walk");
  });

  it("walks only at the slow end — the first steps on ice, or pushing against a wall", () => {
    expect(selectLocomotion(at({ speed: 0 }))).toBe("walk");
    expect(selectLocomotion(at({ speed: 0.5 }))).toBe("walk");
  });

  it("keeps its gait between the two thresholds, so a speed sitting on the boundary doesn't flicker", () => {
    const between = (RUN_FROM_SPEED + WALK_BELOW_SPEED) / 2;
    expect(selectLocomotion(at({ speed: between, walking: true }))).toBe("walk");
    expect(selectLocomotion(at({ speed: between, walking: false }))).toBe("run");
  });

  it("walks up to RUN_FROM_SPEED and runs from it; running, it walks again only below WALK_BELOW_SPEED", () => {
    expect(WALK_BELOW_SPEED).toBeLessThan(RUN_FROM_SPEED);
    expect(selectLocomotion(at({ speed: RUN_FROM_SPEED - 0.01, walking: true }))).toBe("walk");
    expect(selectLocomotion(at({ speed: RUN_FROM_SPEED, walking: true }))).toBe("run");
    expect(selectLocomotion(at({ speed: WALK_BELOW_SPEED, walking: false }))).toBe("run");
    expect(selectLocomotion(at({ speed: WALK_BELOW_SPEED - 0.01, walking: false }))).toBe("walk");
  });

  it("sprints for the whole Dash, even with no direction held and before its build-up has any speed", () => {
    expect(selectLocomotion(at({ dashing: true }))).toBe("sprint");
    expect(selectLocomotion(at({ dashing: true, moving: false, speed: 0 }))).toBe("sprint");
    expect(selectLocomotion(at({ dashing: true, speed: 0.5, walking: true }))).toBe("sprint");
  });

  it("is jump whenever not grounded, regardless of moving or dashing", () => {
    expect(selectLocomotion(at({ grounded: false, moving: false, speed: 0 }))).toBe("jump");
    expect(selectLocomotion(at({ grounded: false }))).toBe("jump");
    expect(selectLocomotion(at({ grounded: false, dashing: true }))).toBe("jump");
  });

  it("wobbles on the ground and jumps in the air — the slowed tell beats the run, not the fall (ADR 0072)", () => {
    expect(selectLocomotion(at({ moving: false, speed: 0, wobbling: true }))).toBe("wobble");
    // Moving, the wobble walks: the tell stays, and the legs step.
    expect(selectLocomotion(at({ wobbling: true }))).toBe("wobbleWalk");
    // Even mid-Dash — with or without a direction held, the Character is moving.
    expect(selectLocomotion(at({ wobbling: true, dashing: true }))).toBe("wobbleWalk");
    expect(selectLocomotion(at({ wobbling: true, dashing: true, moving: false }))).toBe("wobbleWalk");
    // Airborne, it is still a jump — a wobble reads as feet under you.
    expect(selectLocomotion(at({ wobbling: true, grounded: false }))).toBe("jump");
  });

  it("wobbles on ice, standing or moving, Dash included — and still jumps off it (ADR 0082)", () => {
    expect(selectLocomotion(at({ onIce: true, moving: false, speed: 0 }))).toBe("wobble");
    // Sliding with nothing held is still standing on it.
    expect(selectLocomotion(at({ onIce: true, moving: false, speed: 4 }))).toBe("wobble");
    expect(selectLocomotion(at({ onIce: true }))).toBe("wobbleWalk");
    // The first slow steps too, which off the ice would walk.
    expect(selectLocomotion(at({ onIce: true, speed: 0.5, walking: true }))).toBe("wobbleWalk");
    expect(selectLocomotion(at({ onIce: true, dashing: true }))).toBe("wobbleWalk");
    expect(selectLocomotion(at({ onIce: true, grounded: false }))).toBe("jump");
  });
});
