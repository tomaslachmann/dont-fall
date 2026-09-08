import { describe, expect, it } from "vitest";
import { HIT_COOLDOWN_MS, TICK_MS } from "../tuning.js";
import { HitController } from "./HitController.js";

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
