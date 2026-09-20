import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { RUBBER_BODY, RubberBody, squashScale } from "./rubberBody.js";

const model = (scale = 1): THREE.Object3D => {
  const o = new THREE.Object3D();
  o.scale.setScalar(scale);
  return o;
};

/** Runs `frames` frames of 1/60 s from `t0`, holding the body at a steady height. */
const run = (body: RubberBody, t0: number, frames: number, height = 1): number => {
  let t = t0;
  for (let i = 0; i < frames; i += 1) {
    body.follow(height, 1 / 60);
    body.apply(t);
    t += 1000 / 60;
  }
  return t;
};

describe("squashScale", () => {
  it("keeps the volume: what it loses in height it gains around the middle", () => {
    const base = new THREE.Vector3(1, 1, 1);
    for (const amount of [-0.3, -0.1, 0, 0.15, 0.4]) {
      const s = squashScale(base, amount, new THREE.Vector3());
      expect(s.x * s.y * s.z, `amount ${amount}`).toBeCloseTo(1, 9);
    }
  });

  it("squashes wide and stretches narrow", () => {
    const base = new THREE.Vector3(1, 1, 1);
    const squashed = squashScale(base, -0.2, new THREE.Vector3());
    expect(squashed.y).toBeLessThan(1);
    expect(squashed.x).toBeGreaterThan(1);
    const stretched = squashScale(base, 0.2, new THREE.Vector3());
    expect(stretched.y).toBeGreaterThan(1);
    expect(stretched.x).toBeLessThan(1);
  });

  it("carries the model's own size through", () => {
    const s = squashScale(new THREE.Vector3(2, 2, 2), 0, new THREE.Vector3());
    expect(s.toArray()).toEqual([2, 2, 2]);
  });

  it("never inverts the body, however hard it is pushed", () => {
    expect(squashScale(new THREE.Vector3(1, 1, 1), -5, new THREE.Vector3()).y).toBeGreaterThan(0);
  });
});

describe("RubberBody", () => {
  it("sits at exactly the model's own scale until something moves it", () => {
    const m = model(0.7);
    const body = new RubberBody(m);
    run(body, 0, 60);
    expect(body.ringing).toBe(false);
    expect(m.scale.toArray()).toEqual([0.7, 0.7, 0.7]);
  });

  it("compresses on an Impact and rings back out through a stretch", () => {
    const m = model();
    const body = new RubberBody(m);
    run(body, 0, 2);
    body.impact(1, 1000);
    let t = 1000;
    let lowest = 0;
    let highest = 0;
    for (let i = 0; i < 90; i += 1) {
      t = run(body, t, 1);
      lowest = Math.min(lowest, body.squash);
      highest = Math.max(highest, body.squash);
    }
    expect(lowest, "squashes first").toBeLessThan(-0.05);
    expect(highest, "overshoots into a stretch").toBeGreaterThan(0);
  });

  it("settles back to the model's own scale", () => {
    const m = model();
    const body = new RubberBody(m);
    run(body, 0, 2);
    body.impact(1, 1000);
    run(body, 1000, 600);
    expect(body.ringing).toBe(false);
    expect(m.scale.x).toBeCloseTo(1, 9);
    expect(m.scale.y).toBeCloseTo(1, 9);
  });

  it("never squashes past its clamp, however many Impacts land at once", () => {
    const m = model();
    const body = new RubberBody(m);
    run(body, 0, 2);
    for (let i = 0; i < 20; i += 1) body.impact(1, 1000 + i);
    let t = 1000;
    for (let i = 0; i < 240; i += 1) {
      t = run(body, t, 1);
      expect(Math.abs(m.scale.y - 1)).toBeLessThanOrEqual(RUBBER_BODY.maxSquash + 1e-9);
    }
  });

  // The half the bones do not have: soft all the time, not only when hit.
  it("gives when the body is accelerated upward, with no Impact at all", () => {
    const m = model();
    const body = new RubberBody(m);
    let t = 0;
    let height = 1;
    let rise = 0;
    let lowest = 0;
    for (let i = 0; i < 40; i += 1) {
      rise += 30 * (1 / 60); // a landing's worth of upward acceleration, above one GRAVITY_Y
      height += rise * (1 / 60);
      body.follow(height, 1 / 60);
      body.apply(t);
      t += 1000 / 60;
      lowest = Math.min(lowest, body.squash);
    }
    // `softness` is the squash it settles at under one GRAVITY_Y (22), so 30
    // has to be visibly more than that.
    expect(lowest).toBeLessThan(-RUBBER_BODY.softness);
  });

  it("stays still while the body rises at a steady rate — speed alone is not softness", () => {
    const m = model();
    const body = new RubberBody(m);
    let t = 0;
    let height = 1;
    for (let i = 0; i < 120; i += 1) {
      height += 2 * (1 / 60);
      body.follow(height, 1 / 60);
      body.apply(t);
      t += 1000 / 60;
    }
    expect(Math.abs(body.squash)).toBeLessThan(1e-3);
  });

  it("skips a cut instead of reading it as a violent acceleration", () => {
    const m = model();
    const body = new RubberBody(m);
    run(body, 0, 10);
    body.follow(1 + RUBBER_BODY.cutDistance * 2, 1 / 60); // a clip restarting
    body.apply(1000);
    expect(Math.abs(body.squash)).toBeLessThan(1e-6);
  });

  it("writes nothing at scale 0 but keeps its wobble underneath", () => {
    const m = model();
    const body = new RubberBody(m);
    run(body, 0, 2);
    body.impact(1, 1000);
    let t = 1000;
    for (let i = 0; i < 10; i += 1) {
      body.follow(1, 1 / 60);
      body.apply(t, 0);
      t += 1000 / 60;
    }
    expect(m.scale.y).toBeCloseTo(1, 9);
    expect(body.ringing).toBe(true);
  });

  it("drops everything on reset", () => {
    const m = model();
    const body = new RubberBody(m);
    run(body, 0, 2);
    body.impact(1, 1000);
    run(body, 1000, 6);
    expect(body.ringing).toBe(true);
    body.reset();
    expect(body.ringing).toBe(false);
    expect(m.scale.toArray()).toEqual([1, 1, 1]);
  });
});
