import { describe, expect, it } from "vitest";
import {
  DASH_SPEED,
  HIT_COOLDOWN_MS,
  HIT_IMPACT_MAGNITUDE,
  HIT_IMPACT_MAX,
  IMPACT_RAGDOLL_MIN,
  IMPACT_STAGGER_MIN,
  TICK_MS,
  WALK_SPEED,
} from "../tuning.js";
import { HitController, hitImpactMagnitude } from "./HitController.js";

describe("HitController (M6 ticket 03 — CooldownController with no burst/duration of its own)", () => {
  it("is ready (no cooldown) before ever swung", () => {
    const hit = new HitController();
    expect(hit.cooldownMs).toBe(0);
  });

  it("fires on a press while ready, and starts the cooldown", () => {
    const hit = new HitController();
    expect(hit.beginTick(true)).toBe(true);
    expect(hit.cooldownMs).toBeCloseTo(HIT_COOLDOWN_MS, 0);
  });

  it("does not fire again while on cooldown, even held/pressed every tick", () => {
    const hit = new HitController();
    hit.beginTick(true);
    expect(hit.beginTick(true)).toBe(false);
    expect(hit.beginTick(true)).toBe(false);
  });

  it("does not fire on a tick with no press, and ticking with no press does not itself start a cooldown", () => {
    const hit = new HitController();
    expect(hit.beginTick(false)).toBe(false);
    expect(hit.cooldownMs).toBe(0);
  });

  it("fires again once the cooldown has fully ticked down", () => {
    const hit = new HitController();
    hit.beginTick(true);
    const ticks = Math.ceil(HIT_COOLDOWN_MS / TICK_MS);
    for (let i = 0; i < ticks - 1; i += 1) hit.beginTick(false);
    expect(hit.cooldownMs).toBeCloseTo(TICK_MS, 0); // one tick of cooldown left
    hit.beginTick(false); // the tick that ticks it to exactly 0
    expect(hit.cooldownMs).toBe(0);
    expect(hit.beginTick(true)).toBe(true);
  });

  it("restoreCooldownMs reconstructs the cooldown a reconciling client restores from the server's report", () => {
    const hit = new HitController();
    hit.restoreCooldownMs(HIT_COOLDOWN_MS / 2);
    expect(hit.cooldownMs).toBeCloseTo(HIT_COOLDOWN_MS / 2, 0);
  });

  it("restoreCooldownMs clamps a negative value to 0 rather than leaving stale state", () => {
    const hit = new HitController();
    hit.restoreCooldownMs(-50);
    expect(hit.cooldownMs).toBe(0);
  });

  it("reset clears an in-progress cooldown", () => {
    const hit = new HitController();
    hit.beginTick(true);
    hit.reset();
    expect(hit.cooldownMs).toBe(0);
  });
});

describe("hitImpactMagnitude (M6.1 ticket 01)", () => {
  it("a swing thrown standing still is exactly the Hit M6 already shipped", () => {
    // The base is unchanged, so every M6 ticket 03 expectation still holds:
    // a stationary connect Staggers and does not knock down.
    expect(hitImpactMagnitude(0)).toBe(HIT_IMPACT_MAGNITUDE);
    expect(hitImpactMagnitude(0)).toBeGreaterThanOrEqual(IMPACT_STAGGER_MIN);
    expect(hitImpactMagnitude(0)).toBeLessThan(IMPACT_RAGDOLL_MIN);
  });

  it("still only Staggers at a full walk — a knockdown has to cost something more than walking", () => {
    // Otherwise Hit is strictly better than a Bump and Dash stops being worth
    // its cooldown, which is the failure the ticket names.
    expect(hitImpactMagnitude(WALK_SPEED)).toBeLessThan(IMPACT_RAGDOLL_MIN);
  });

  it("knocks down when thrown out of a Dash", () => {
    expect(hitImpactMagnitude(DASH_SPEED)).toBeGreaterThanOrEqual(IMPACT_RAGDOLL_MIN);
  });

  it("rises with commitment rather than switching at a threshold of its own", () => {
    expect(hitImpactMagnitude(WALK_SPEED)).toBeGreaterThan(hitImpactMagnitude(0));
    expect(hitImpactMagnitude(DASH_SPEED)).toBeGreaterThan(hitImpactMagnitude(WALK_SPEED));
  });

  it("ignores retreating and glancing motion rather than going negative", () => {
    // A striker backing away swings with the base force, never less.
    expect(hitImpactMagnitude(-10)).toBe(HIT_IMPACT_MAGNITUDE);
  });

  it("is capped, so a speed-pad Dash lands a knockdown and not a launch", () => {
    expect(hitImpactMagnitude(1000)).toBe(HIT_IMPACT_MAX);
    expect(hitImpactMagnitude(DASH_SPEED * 1.5)).toBeLessThanOrEqual(HIT_IMPACT_MAX);
  });
});
