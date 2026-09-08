import { describe, expect, it } from "vitest";
import { GRAB_COOLDOWN_MS } from "../tuning.js";
import { GrabController } from "./GrabController.js";

describe("GrabController (M6 ticket 04 — cooldown starts on release, not on press, unlike Dash/Hit's own idiom)", () => {
  it("is ready (no cooldown) before ever grabbed", () => {
    const grab = new GrabController();
    expect(grab.cooldownMs).toBe(0);
  });

  it("may fire on a press while ready — but pressing alone starts no cooldown", () => {
    const grab = new GrabController();
    expect(grab.beginTick(true)).toBe(true);
    expect(grab.cooldownMs).toBe(0);
  });

  it("release() is what actually starts the cooldown, whenever it's called", () => {
    const grab = new GrabController();
    grab.beginTick(true);
    grab.release();
    expect(grab.cooldownMs).toBeCloseTo(GRAB_COOLDOWN_MS, 0);
  });

  it("does not offer to fire again while on cooldown after a release, even pressed every tick", () => {
    const grab = new GrabController();
    grab.beginTick(true);
    grab.release();
    expect(grab.beginTick(true)).toBe(false);
    expect(grab.beginTick(true)).toBe(false);
  });

  it("does not offer to fire on a tick with no press", () => {
    const grab = new GrabController();
    expect(grab.beginTick(false)).toBe(false);
  });

  it("may fire again once a released cooldown has fully ticked down", () => {
    const grab = new GrabController();
    grab.beginTick(true);
    grab.release();
    const ticks = Math.ceil(GRAB_COOLDOWN_MS / 33.333);
    for (let i = 0; i < ticks; i += 1) grab.beginTick(false);
    expect(grab.cooldownMs).toBe(0);
    expect(grab.beginTick(true)).toBe(true);
  });

  it("restoreCooldownMs reconstructs the cooldown a reconciling client restores from the server's report", () => {
    const grab = new GrabController();
    grab.restoreCooldownMs(GRAB_COOLDOWN_MS / 2);
    expect(grab.cooldownMs).toBeCloseTo(GRAB_COOLDOWN_MS / 2, 0);
  });

  it("restoreCooldownMs clamps a negative value to 0 rather than leaving stale state", () => {
    const grab = new GrabController();
    grab.restoreCooldownMs(-50);
    expect(grab.cooldownMs).toBe(0);
  });

  it("reset clears an in-progress cooldown", () => {
    const grab = new GrabController();
    grab.beginTick(true);
    grab.release();
    grab.reset();
    expect(grab.cooldownMs).toBe(0);
  });
});
