import type { PropSnapshot } from "@dont-fall/shared";
import {
  PROP_ERR_HALFLIFE_FAR_MS,
  PROP_ERR_ROT_HARDSNAP_DOT,
  decayPositionOffset,
  dotQuat,
  yawQuat,
} from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import {
  PropPredictionController,
  decayPropError,
  graceTicksForRtt,
  zeroPropError,
} from "./propPrediction.js";

/**
 * Ticket 11.8 / ADR 0022 — pushed-Prop prediction as a decaying render-time
 * error offset. The reverted first attempt (ADR 0016's predecessor) hard-swapped
 * the rendered pose from "advanced local prediction" to "stale server pose" in
 * one frame, so a pushed box visibly jumped backward on release. These tests pin
 * the Fiedler smoothing math and the property that broke: the rendered pose is
 * continuous across every state transition.
 */

const TICK_MS = 1000 / 30;

const pose = (x: number, opts: Partial<PropSnapshot> = {}): PropSnapshot => ({
  position: { x, y: 0.4, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  atRest: false,
  ...opts,
});

describe("decayPropError", () => {
  it("decays a small position error with a ~200 ms half-life (Fiedler ≈0.95/frame@60)", () => {
    const e = { position: { x: 0.1, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
    const after = decayPropError(e, 200);
    expect(after.position.x).toBeCloseTo(0.05, 3);
  });

  it("decays a large position error faster — a ~70 ms half-life (Fiedler ≈0.85/frame@60)", () => {
    const e = { position: { x: 1.5, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
    const after = decayPropError(e, 70);
    expect(after.position.x).toBeCloseTo(0.75, 2);
  });

  it("drops the offset outright past the 2 m hard-snap threshold", () => {
    const e = { position: { x: 2.5, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
    expect(decayPropError(e, TICK_MS).position).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("snaps the rotation offset past a genuine-desync angle (~150°+)", () => {
    const e = { position: { x: 0, y: 0, z: 0 }, rotation: yawQuat((8 / 9) * Math.PI) }; // 160°
    expect(decayPropError(e, TICK_MS).rotation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });

  it("uses the far half-life for the worst *reachable* rotation error — just above the hard-snap boundary", () => {
    // PROP_ERR_ROT_HARDSNAP_DOT (0.26) sits above PROP_ERR_ROT_DOT_LO (0.1), so
    // the blend's low end used to be unreachable: every rotDot below 0.26 was
    // claimed by the hard-snap branch first, and the far half-life (fast decay
    // for a big error) was never actually used. A rotDot just above that
    // boundary is the worst error the blend ever sees, so it should decay at
    // (very close to) PROP_ERR_HALFLIFE_FAR_MS, not some slower blended value.
    const w0 = PROP_ERR_ROT_HARDSNAP_DOT + 0.0001;
    const angle = 2 * Math.acos(w0);
    const e = { position: { x: 0, y: 0, z: 0 }, rotation: yawQuat(angle) };
    const after = decayPropError(e, PROP_ERR_HALFLIFE_FAR_MS);
    const expectedW = Math.cos(angle / 4); // slerp halfway toward identity over one far half-life
    expect(Math.abs(after.rotation.w)).toBeCloseTo(expectedW, 2);
  });

  it("blends the rotation offset toward identity", () => {
    const e = { position: { x: 0, y: 0, z: 0 }, rotation: yawQuat(0.6) };
    const before = Math.abs(dotQuat(e.rotation, { x: 0, y: 0, z: 0, w: 1 }));
    const after = decayPropError(e, 200);
    const dotAfter = Math.abs(dotQuat(after.rotation, { x: 0, y: 0, z: 0, w: 1 }));
    expect(dotAfter).toBeGreaterThan(before); // closer to identity
    expect(dotAfter).toBeLessThan(1); // but not snapped
  });

  it("is frame-rate independent — two 8 ms steps ≈ one 16 ms step", () => {
    const e = { position: { x: 0.2, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
    const oneStep = decayPropError(e, 16).position.x;
    const twoSteps = decayPropError(decayPropError(e, 8), 8).position.x;
    expect(twoSteps).toBeCloseTo(oneStep, 4);
  });

  it("its position decay is the shared, configurable-half-life helper the local Character reuses (ADR 0026)", () => {
    // A small error decays with the near half-life — same number `decayPositionOffset`
    // would produce called directly with that half-life explicit.
    const small = { position: { x: 0.1, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
    expect(decayPropError(small, 200).position.x).toBeCloseTo(
      decayPositionOffset(small.position, 200, 200, Number.POSITIVE_INFINITY).x,
      5,
    );
  });
});

describe("graceTicksForRtt", () => {
  it("falls back to the fixed default before RTT is known", () => {
    expect(graceTicksForRtt(0)).toBe(4);
    expect(graceTicksForRtt(Number.NaN)).toBe(4);
  });

  it("is ceil(RTT / TICK_MS), clamped to [2, 8]", () => {
    expect(graceTicksForRtt(10)).toBe(2); // ceil(0.3) = 1 → clamped up to 2
    expect(graceTicksForRtt(80)).toBe(3); // ceil(2.4) = 3
    expect(graceTicksForRtt(400)).toBe(8); // ceil(12) = 12 → clamped down to 8
  });
});

describe("PropPredictionController", () => {
  const frame = (
    c: PropPredictionController,
    over: Partial<Parameters<PropPredictionController["frame"]>[0]> = {},
  ): void =>
    c.frame({
      contacted: [],
      predictionTick: 0,
      graceTicks: 4,
      dtMs: TICK_MS,
      simProps: [pose(0)],
      serverProps: [pose(0)],
      ...over,
    });

  it("leaves every Prop pinned until the local Character contacts one", () => {
    const c = new PropPredictionController();
    frame(c, { serverProps: [pose(3)] });
    expect(c.predictedIndices).toEqual([]);
    expect(c.renderPoses([pose(0)], [pose(3)])[0]!.position.x).toBe(3);
  });

  it("starts predicting a Prop on contact and renders it from the local sim pose", () => {
    const c = new PropPredictionController();
    frame(c, { contacted: [0], predictionTick: 10 });
    expect(c.predictedIndices).toEqual([0]);
    expect(c.stateOf(0)).toBe("predicted");
    // local sim has pushed the box to x=1.2; server snapshot still lags at x=0.
    expect(c.renderPoses([pose(1.2)], [pose(0)])[0]!.position.x).toBeCloseTo(1.2, 5);
  });

  it("hands back to interpolation when grace lapses — without jumping the rendered pose", () => {
    const c = new PropPredictionController();
    // Contact at tick 10, box predicted forward to x≈2, server lags at x≈1.4.
    frame(c, { contacted: [0], predictionTick: 10, simProps: [pose(2)], serverProps: [pose(1.4)] });
    const renderedWhilePredicted = c.renderPoses([pose(2)], [pose(1.4)])[0]!.position.x;

    // 5 ticks later, no contact — grace (4) has lapsed.
    frame(c, { contacted: [], predictionTick: 15, simProps: [pose(2)], serverProps: [pose(1.4)] });
    expect(c.stateOf(0)).toBe("server-moving");
    expect(c.predictedIndices).toEqual([]);

    const renderedAfterHandback = c.renderPoses([pose(2)], [pose(1.4)])[0]!.position.x;
    // The rendered pose barely moves across the switch (one frame of decay only) —
    // no snap-back to the stale server pose. This is the ADR 0016 regression.
    expect(Math.abs(renderedAfterHandback - renderedWhilePredicted)).toBeLessThan(0.15);
    expect(renderedAfterHandback).toBeGreaterThan(1.8);
  });

  it("settles back to PINNED once the server Prop is at rest and the offset is spent", () => {
    const c = new PropPredictionController();
    frame(c, { contacted: [0], predictionTick: 10, simProps: [pose(0.5)], serverProps: [pose(0.5)] });
    frame(c, { predictionTick: 20, simProps: [pose(0.5)], serverProps: [pose(0.5, { atRest: true })] });
    expect(c.stateOf(0)).toBe("pinned");
    expect(c.renderPoses([pose(0.5)], [pose(0.5, { atRest: true })])[0]!.position.x).toBe(0.5);
  });

  it("does NOT re-pin while a rotation residual remains, even with the position offset spent", () => {
    const c = new PropPredictionController();
    // Predicted pose is rotated ~35° from where the server settles it.
    const simRot = pose(0.5, { rotation: yawQuat(0.6) });
    frame(c, { contacted: [0], predictionTick: 10, simProps: [simRot], serverProps: [pose(0.5)] });
    // Grace lapses; server says at rest, position matches, but orientation is still off.
    frame(c, { predictionTick: 20, simProps: [simRot], serverProps: [pose(0.5, { atRest: true })] });
    expect(c.stateOf(0)).toBe("server-moving"); // held open by the rotation offset
    // ...and once the rotation offset has decayed too, it re-pins.
    for (let i = 0; i < 120; i += 1) {
      frame(c, { predictionTick: 20, simProps: [simRot], serverProps: [pose(0.5, { atRest: true })] });
    }
    expect(c.stateOf(0)).toBe("pinned");
  });

  it("reset() drops all prediction state back to pinned", () => {
    const c = new PropPredictionController();
    frame(c, { contacted: [0], predictionTick: 5 });
    expect(c.predictedIndices).toEqual([0]);
    c.reset();
    expect(c.predictedIndices).toEqual([]);
    expect(c.stateOf(0)).toBe("pinned");
  });

  it("keeps the rendered pose continuous across a reconcile correction", () => {
    const c = new PropPredictionController();
    frame(c, { contacted: [0], predictionTick: 10, simProps: [pose(2)], serverProps: [pose(2)] });

    // Local sim believes the box is at x=2; reconcile snaps the body to the
    // server's x=1.5 and replays.
    const before = c.captureBeforeReconcile([pose(2)]);
    expect(before.get(0)!.position.x).toBeCloseTo(2, 5);
    c.reseedAfterReconcile(before, [pose(1.5)]);

    // Rendered pose immediately after the correction is still ~2, not 1.5.
    expect(c.renderPoses([pose(1.5)], [pose(1.5)])[0]!.position.x).toBeCloseTo(2, 5);

    // ...then it eases toward the server pose over the next second.
    for (let i = 0; i < 60; i += 1) frame(c, { predictionTick: 10, simProps: [pose(1.5)], serverProps: [pose(1.5)] });
    expect(c.renderPoses([pose(1.5)], [pose(1.5)])[0]!.position.x).toBeCloseTo(1.5, 1);
  });

  it("zeroPropError is the identity offset", () => {
    const z = zeroPropError();
    expect(z.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(z.rotation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });
});
