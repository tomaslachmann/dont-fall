import { describe, expect, it } from "vitest";
import { RiseLatch } from "./riseLatch.js";

describe("RiseLatch (M14 ticket 05)", () => {
  it("takes the first sight of an id as history, then fires once per rise", () => {
    const latch = new RiseLatch();
    expect(latch.rose("a", 4, 0)).toBe(false);
    expect(latch.rose("a", 4, 16)).toBe(false);
    expect(latch.rose("a", 5, 32)).toBe(true);
    expect(latch.rose("a", 5, 48)).toBe(false);
  });

  it("stays silent for a value already applied, the way a replay re-produces it", () => {
    const latch = new RiseLatch();
    latch.rose("a", 0, 0);
    expect(latch.rose("a", 1, 16)).toBe(true);
    expect(latch.rose("a", 1, 32)).toBe(false);
  });

  it("adopts a second rise inside the refractory window without firing", () => {
    const latch = new RiseLatch(400);
    latch.rose("a", 0, 0);
    expect(latch.rose("a", 1, 100)).toBe(true);
    // A replay across the launch tick raised the counter again.
    expect(latch.rose("a", 2, 250)).toBe(false);
    expect(latch.rose("a", 2, 600)).toBe(false);
    expect(latch.rose("a", 3, 1000)).toBe(true);
  });

  it("takes a lower value as a fresh simulation: adopted silently, and the next rise fires", () => {
    const latch = new RiseLatch(400);
    latch.rose("a", 0, 0);
    latch.rose("a", 7, 100);
    expect(latch.rose("a", 0, 150)).toBe(false);
    expect(latch.rose("a", 1, 200)).toBe(true);
  });

  it("keeps ids apart, and forgets one", () => {
    const latch = new RiseLatch();
    latch.rose("a", 0, 0);
    latch.rose("b", 0, 0);
    expect(latch.rose("b", 1, 16)).toBe(true);
    expect(latch.rose("a", 0, 16)).toBe(false);
    latch.forget("a");
    expect(latch.rose("a", 3, 32)).toBe(false);
  });
});
