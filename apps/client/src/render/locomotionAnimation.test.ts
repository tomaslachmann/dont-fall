import { describe, expect, it } from "vitest";
import { selectLocomotion } from "./locomotionAnimation.js";

describe("selectLocomotion", () => {
  it("is idle when grounded, not moving, not dashing", () => {
    expect(selectLocomotion(false, true, false)).toBe("idle");
  });

  it("is walk when grounded and moving, not dashing", () => {
    expect(selectLocomotion(true, true, false)).toBe("walk");
  });

  it("is run while dashing and grounded, even with no direction held — a stationary dash still needs a locomotion clip", () => {
    expect(selectLocomotion(false, true, true)).toBe("run");
    expect(selectLocomotion(true, true, true)).toBe("run");
  });

  it("is jump whenever not grounded, regardless of moving or dashing", () => {
    expect(selectLocomotion(false, false, false)).toBe("jump");
    expect(selectLocomotion(true, false, false)).toBe("jump");
    expect(selectLocomotion(true, false, true)).toBe("jump");
  });

  it("wobbles on the ground and jumps in the air — the slowed tell beats the walk, not the fall (ADR 0072)", () => {
    expect(selectLocomotion(false, true, false, true)).toBe("wobble");
    // Moving, the wobble walks: the tell stays, and the legs step.
    expect(selectLocomotion(true, true, false, true)).toBe("wobbleWalk");
    // Even mid-Dash — with or without a direction held, the Character is moving.
    expect(selectLocomotion(true, true, true, true)).toBe("wobbleWalk");
    expect(selectLocomotion(false, true, true, true)).toBe("wobbleWalk");
    // Airborne, it is still a jump — a wobble reads as feet under you.
    expect(selectLocomotion(true, false, false, true)).toBe("jump");
  });

  it("leaves every existing caller alone — wobbling defaults off", () => {
    expect(selectLocomotion(true, true, false)).toBe("walk");
    expect(selectLocomotion(false, true, false)).toBe("idle");
  });
});
