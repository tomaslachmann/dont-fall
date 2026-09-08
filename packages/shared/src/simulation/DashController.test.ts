import { describe, expect, it } from "vitest";
import { DashController } from "./DashController.js";

describe("DashController.cancelBurst (M6 tickets 03/04 — Hit and Grab both cancel an in-progress Dash on connect)", () => {
  it("stops an active burst immediately, without touching the cooldown", () => {
    const dash = new DashController();
    dash.beginTick({ x: 0, y: 0, z: -1 }, true); // start a burst
    expect(dash.isActive).toBe(true);
    const cooldownBefore = dash.cooldownMs;

    dash.cancelBurst();

    expect(dash.isActive).toBe(false);
    expect(dash.cooldownMs).toBe(cooldownBefore); // still has to wait it out — no free early re-dash
  });

  it("is a harmless no-op when no burst is active", () => {
    const dash = new DashController();
    expect(() => dash.cancelBurst()).not.toThrow();
    expect(dash.isActive).toBe(false);
  });
});
