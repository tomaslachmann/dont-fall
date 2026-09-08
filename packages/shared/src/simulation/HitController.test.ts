import { describe, expect, it } from "vitest";
import {
  HIT_CHARGE_IMPACT_BONUS,
  HIT_CHARGE_MAX_MS,
  HIT_CHARGE_MAX_TICKS,
  HIT_COOLDOWN_MS,
  HIT_IMPACT_MAGNITUDE,
  HIT_IMPACT_MAX,
  IMPACT_RAGDOLL_MIN,
  IMPACT_STAGGER_MIN,
  TICK_MS,
} from "../tuning.js";
import { HitController, hitImpactMagnitude } from "./HitController.js";

describe("HitController (M6 ticket 03; hold-to-charge added M6.1)", () => {
  it("is ready (no cooldown) before ever swung", () => {
    const hit = new HitController();
    expect(hit.cooldownMs).toBe(0);
  });

  it("does not fire on a tap-and-release within one tick's own gap — a single held tick then release still swings, weakly", () => {
    const hit = new HitController();
    expect(hit.beginTick(true, true)).toBe(null); // charging, not yet released
    const result = hit.beginTick(false, true); // released the very next tick
    expect(result).not.toBe(null);
    expect(result).toBeCloseTo(1 / HIT_CHARGE_MAX_TICKS, 5);
    expect(hit.cooldownMs).toBeCloseTo(HIT_COOLDOWN_MS, 0);
  });

  it("charges while held, and reports the full fraction once held for the whole charge window", () => {
    const hit = new HitController();
    const ticks = Math.round(HIT_CHARGE_MAX_MS / TICK_MS);
    for (let i = 0; i < ticks; i += 1) expect(hit.beginTick(true, true)).toBe(null);
    expect(hit.beginTick(false, true)).toBeCloseTo(1, 5);
  });

  it("does not charge further once at the max — holding longer never helps more", () => {
    const hit = new HitController();
    const ticks = Math.round(HIT_CHARGE_MAX_MS / TICK_MS);
    for (let i = 0; i < ticks + 20; i += 1) hit.beginTick(true, true); // way past full charge
    expect(hit.beginTick(false, true)).toBeCloseTo(1, 5);
  });

  it("does not fire on a tick with no press ever having happened, and ticking with no press does not itself start a cooldown", () => {
    const hit = new HitController();
    expect(hit.beginTick(false, true)).toBe(null);
    expect(hit.cooldownMs).toBe(0);
  });

  it("does not fire again while on cooldown, even held every tick", () => {
    const hit = new HitController();
    hit.beginTick(true, true);
    hit.beginTick(false, true); // fires, starts cooldown
    expect(hit.beginTick(true, true)).toBe(null);
    expect(hit.beginTick(false, true)).toBe(null);
  });

  it("fires again once the cooldown has fully ticked down", () => {
    const hit = new HitController();
    hit.beginTick(true, true);
    hit.beginTick(false, true);
    const ticks = Math.ceil(HIT_COOLDOWN_MS / TICK_MS);
    for (let i = 0; i < ticks - 1; i += 1) hit.beginTick(false, true);
    hit.beginTick(true, true); // held right as the cooldown clears — starts a fresh charge
    expect(hit.beginTick(false, true)).not.toBe(null);
  });

  it(
    "discards an in-progress charge outright when `allowed` drops out from under it (a forced Stagger, Dash starting) " +
      "rather than swinging on an involuntary release",
    () => {
      const hit = new HitController();
      const ticks = Math.round(HIT_CHARGE_MAX_MS / TICK_MS);
      for (let i = 0; i < ticks; i += 1) hit.beginTick(true, true); // fully charged
      hit.beginTick(true, false); // still held, but no longer allowed — e.g. a Dash just started
      // The button is still physically held, but nothing fires even once
      // `allowed` returns, because the charge was discarded, not paused.
      expect(hit.beginTick(true, true)).toBe(null);
    },
  );

  it("charging never starts while on cooldown, even if held the whole time", () => {
    const hit = new HitController();
    hit.beginTick(true, true);
    hit.beginTick(false, true); // fires, starts cooldown
    // Held continuously through the cooldown — must not accumulate a charge
    // until the cooldown genuinely clears.
    const ticks = Math.ceil(HIT_COOLDOWN_MS / TICK_MS);
    for (let i = 0; i < ticks - 2; i += 1) expect(hit.beginTick(true, true)).toBe(null);
    expect(hit.cooldownMs).toBeGreaterThan(0);
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

  it("restoreCharge reconstructs an in-progress charge a reconciling client restores from the server's report", () => {
    const hit = new HitController();
    hit.restoreCharge(HIT_CHARGE_MAX_MS / 2);
    expect(hit.chargeMs).toBeCloseTo(HIT_CHARGE_MAX_MS / 2, 0);
    // The restored charge keeps accumulating on replay, exactly like a charge
    // that had been building natively.
    expect(hit.beginTick(true, true)).toBe(null);
    expect(hit.chargeMs).toBeGreaterThan(HIT_CHARGE_MAX_MS / 2);
  });

  it("reset clears an in-progress cooldown and an in-progress charge", () => {
    const hit = new HitController();
    hit.beginTick(true, true);
    hit.reset();
    expect(hit.cooldownMs).toBe(0);
    expect(hit.chargeMs).toBe(0);
    // A release right after reset fires nothing — the charge is genuinely gone.
    expect(hit.beginTick(false, true)).toBe(null);
  });
});

describe("hitImpactMagnitude (M6.1: hold-to-charge)", () => {
  it("an unreleased/zero charge is exactly the Hit M6 already shipped", () => {
    expect(hitImpactMagnitude(0)).toBe(HIT_IMPACT_MAGNITUDE);
    expect(hitImpactMagnitude(0)).toBeGreaterThanOrEqual(IMPACT_STAGGER_MIN);
    expect(hitImpactMagnitude(0)).toBeLessThan(IMPACT_RAGDOLL_MIN);
  });

  it("still only Staggers at a half charge — right at, not past, the Ragdoll threshold's own margin", () => {
    expect(hitImpactMagnitude(0.5)).toBeCloseTo(IMPACT_RAGDOLL_MIN, 5);
  });

  it("knocks down at a full charge", () => {
    expect(hitImpactMagnitude(1)).toBe(HIT_IMPACT_MAGNITUDE + HIT_CHARGE_IMPACT_BONUS);
    expect(hitImpactMagnitude(1)).toBeGreaterThanOrEqual(IMPACT_RAGDOLL_MIN);
  });

  it("rises with charge rather than switching at a threshold of its own", () => {
    expect(hitImpactMagnitude(0.5)).toBeGreaterThan(hitImpactMagnitude(0));
    expect(hitImpactMagnitude(1)).toBeGreaterThan(hitImpactMagnitude(0.5));
  });

  it("clamps an out-of-range fraction rather than trusting the caller", () => {
    expect(hitImpactMagnitude(-1)).toBe(HIT_IMPACT_MAGNITUDE);
    expect(hitImpactMagnitude(2)).toBe(HIT_IMPACT_MAGNITUDE + HIT_CHARGE_IMPACT_BONUS);
  });

  it("is capped, so a future retune cannot turn a full charge into a launch", () => {
    expect(hitImpactMagnitude(1)).toBeLessThanOrEqual(HIT_IMPACT_MAX);
  });
});
