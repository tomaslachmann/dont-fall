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
});
