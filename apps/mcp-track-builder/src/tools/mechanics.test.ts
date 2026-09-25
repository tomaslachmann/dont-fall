import { DASH_SPEED, JUMP_VELOCITY, SURFACES, WALK_SPEED } from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import { characterMechanics } from "./mechanics.js";

/**
 * The point of the tool is that nothing here is a copy: every number is read
 * or derived from `tuning/` when it is called, so a retune reaches an LLM
 * authoring a Track without a second edit. These tests assert that link, not
 * the values themselves — asserting a feel value would be the copy again.
 */
describe("get_character_mechanics", () => {
  it("reads the live tuning rather than a copy of it", () => {
    const m = characterMechanics() as {
      walk: { speed: number };
      dash: { speed: number };
      surfaces: Record<string, { topSpeed: number; topSpeedMultiplier: number }>;
    };
    expect(m.walk.speed).toBe(WALK_SPEED);
    expect(m.dash.speed).toBe(DASH_SPEED);
    // Every Surface the simulation knows is described, at its own cost.
    expect(Object.keys(m.surfaces).sort()).toEqual(Object.keys(SURFACES).sort());
    for (const [id, row] of Object.entries(m.surfaces)) {
      expect(row.topSpeedMultiplier).toBe(SURFACES[id as keyof typeof SURFACES].topSpeedMultiplier ?? 1);
      expect(row.topSpeed).toBeCloseTo(WALK_SPEED * row.topSpeedMultiplier, 2);
    }
  });

  it("derives reach by integrating the jump, so holding it and dashing both go further", () => {
    const m = characterMechanics() as {
      jump: { tap: { apex: number; gap: number }; held: { apex: number; gap: number }; dashing: { gap: number } };
      budget: { rise: number; gap: number };
    };
    // A real arc: it rises, and the hold buys height the tap does not.
    expect(m.jump.tap.apex).toBeGreaterThan(0);
    expect(m.jump.held.apex).toBeGreaterThan(m.jump.tap.apex);
    expect(m.jump.held.gap).toBeGreaterThan(m.jump.tap.gap);
    // Dash carries further than walking over the same airtime (it is faster).
    expect(DASH_SPEED).toBeGreaterThan(WALK_SPEED);
    expect(m.jump.dashing.gap).toBeGreaterThan(m.jump.held.gap);
    // The authoring budget is the conservative jump, never the generous one.
    expect(m.budget.rise).toBe(m.jump.tap.apex);
    expect(m.budget.gap).toBe(m.jump.tap.gap);
    // Sanity against the closed form: the discrete apex sits near v²/2g.
    expect(m.jump.tap.apex).toBeCloseTo((JUMP_VELOCITY * JUMP_VELOCITY) / (2 * 22), 0);
  });

  it("says plainly what the Character cannot do, because geometry depends on it", () => {
    const m = characterMechanics() as { capsule: { autostep: boolean; crouch: boolean }; jump: { doubleJump: boolean } };
    expect(m.capsule.autostep).toBe(false);
    expect(m.capsule.crouch).toBe(false);
    expect(m.jump.doubleJump).toBe(false);
  });
});
