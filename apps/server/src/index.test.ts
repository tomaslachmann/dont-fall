import { describe, expect, it } from "vitest";
import { stepHeadless } from "./index.js";

describe("stepHeadless", () => {
  it("runs the shared simulation step headlessly on the server", () => {
    const state = stepHeadless(10);
    expect(state.tick).toBe(10);
  });

  it("advances nothing for an idle sim (no inputs, no initial velocity)", () => {
    const state = stepHeadless(30);
    expect(state.demo.position).toEqual({ x: 0, y: 0, z: 0 });
  });
});
