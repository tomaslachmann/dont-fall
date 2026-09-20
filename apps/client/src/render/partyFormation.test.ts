import { describe, expect, it } from "vitest";
import { PARTY_MAX_SIZE } from "@dont-fall/shared";
import { formationHalfSpan, partyFormation } from "./partyFormation.js";

describe("the menu hero's Party formation (ADR 0112)", () => {
  it("stands one spot per other member, up to a full Party, all behind yours", () => {
    for (let companions = 0; companions < PARTY_MAX_SIZE; companions++) {
      const slots = partyFormation(companions);
      expect(slots).toHaveLength(companions);
      for (const slot of slots) expect(slot.z).toBeLessThan(0);
    }
  });

  it("flanks you right and left before going further out, each turned toward the middle", () => {
    const [first, second, third] = partyFormation(PARTY_MAX_SIZE - 1);
    expect(first!.x).toBeGreaterThan(0);
    expect(second!.x).toBe(-first!.x);
    expect(third!.x).toBeGreaterThan(first!.x);
    expect(third!.z).toBeLessThan(first!.z);
    expect(Math.sign(first!.yaw)).toBe(-1);
    expect(Math.sign(second!.yaw)).toBe(1);
  });

  it("no two beans share a spot, and the camera's span is the widest one", () => {
    const slots = partyFormation(PARTY_MAX_SIZE - 1);
    expect(new Set(slots.map((slot) => `${slot.x},${slot.z}`)).size).toBe(slots.length);
    expect(formationHalfSpan(slots)).toBe(Math.max(...slots.map((slot) => Math.abs(slot.x))));
    expect(formationHalfSpan([])).toBe(0);
  });
});
