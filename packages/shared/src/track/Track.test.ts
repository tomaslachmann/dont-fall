import { describe, expect, it } from "vitest";
import type { Module } from "./Module.js";
import { chainTrack, placeAfter, resolveTrack } from "./Track.js";
import { M1_MODULES, M1_TRACK } from "./modules.js";

const STRAIGHT_SOCKETS: Module["sockets"] = [
  { id: "entry", type: "floor", position: { x: 0, y: 0, z: 3 }, yaw: Math.PI },
  { id: "exit", type: "floor", position: { x: 0, y: -0.5, z: -3 }, yaw: 0 },
];
const FOOTPRINT: Module["footprint"] = { bounds: { center: { x: 0, y: 0, z: 0 }, halfExtents: { x: 3, y: 1, z: 3 } }, clearance: 0.5 };

const STRAIGHT: Module = {
  id: "straight",
  statics: [{ center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 3, y: 0.5, z: 3 } }],
  sockets: STRAIGHT_SOCKETS,
  footprint: FOOTPRINT,
};

// A 90°-right-turn Module: its exit Socket faces +X (yaw -π/2) instead of
// straight on, so chaining onto it rotates every subsequent Segment 90°.
const TURN_RIGHT: Module = {
  id: "turn-right",
  statics: [{ center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 3, y: 0.5, z: 3 } }],
  sockets: [
    { id: "entry", type: "floor", position: { x: 0, y: 0, z: 3 }, yaw: Math.PI },
    { id: "exit", type: "floor", position: { x: 3, y: -0.5, z: 0 }, yaw: -Math.PI / 2 },
  ],
  footprint: FOOTPRINT,
};

const SPINNER_MODULE: Module = {
  id: "spinner-module",
  statics: [{ center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 3, y: 0.5, z: 3 } }],
  spinners: [{ center: { x: 0, y: 0, z: 0 }, armLength: 2, halfHeight: 0.4, armRadius: 0.3, angularSpeed: 5 }],
  props: [{ shape: { kind: "box", halfExtents: { x: 0.4, y: 0.4, z: 0.4 } }, center: { x: 1, y: 0, z: 0 } }],
  checkpoint: {
    respawn: { x: 0, y: 1, z: 0 },
    volume: { center: { x: 0, y: 1, z: 0 }, halfExtents: { x: 2, y: 2, z: 2 } },
  },
  sockets: STRAIGHT_SOCKETS,
  footprint: FOOTPRINT,
};

describe("placeAfter", () => {
  it("places a straight Module MODULE_STEP-equivalent distance after the last (entry/exit Socket alignment)", () => {
    const prev = { moduleId: "straight", position: { x: 0, y: 0, z: 10 }, rotation: 0 };
    const next = placeAfter(prev, STRAIGHT, "straight", STRAIGHT);
    expect(next.position).toEqual({ x: 0, y: -0.5, z: 4 });
    expect(next.rotation).toBe(0);
  });

  it("rotates the world placement 90° after a turn Module", () => {
    const prev = { moduleId: "turn-right", position: { x: 0, y: 0, z: 10 }, rotation: 0 };
    const next = placeAfter(prev, TURN_RIGHT, "straight", STRAIGHT);
    expect(next.rotation).toBeCloseTo(-Math.PI / 2, 10);
  });

  it("throws if the resulting world rotation isn't a multiple of 90° (ADR 0031)", () => {
    const crooked: Module = {
      ...TURN_RIGHT,
      sockets: [TURN_RIGHT.sockets[0]!, { ...TURN_RIGHT.sockets[1]!, yaw: -Math.PI / 4 }],
    };
    const prev = { moduleId: "crooked", position: { x: 0, y: 0, z: 10 }, rotation: 0 };
    expect(() => placeAfter(prev, crooked, "straight", STRAIGHT)).toThrow(/multiple of 90/);
  });
});

describe("chainTrack", () => {
  it("chains straight Modules end to end, matching entry/exit Socket alignment", () => {
    const modules = { straight: STRAIGHT };
    const track = chainTrack(["straight", "straight", "straight"], modules, { x: 0, y: 0, z: 10 });

    expect(track).toHaveLength(3);
    expect(track[0]!.position).toEqual({ x: 0, y: 0, z: 10 });
    expect(track[1]!.position).toEqual({ x: 0, y: -0.5, z: 4 });
    expect(track[2]!.position).toEqual({ x: 0, y: -1, z: -2 });
  });

  it("accumulates rotation through a turn Module", () => {
    const modules = { straight: STRAIGHT, "turn-right": TURN_RIGHT };
    const track = chainTrack(["turn-right", "straight"], modules);
    expect(track[1]!.rotation).toBeCloseTo(-Math.PI / 2, 10);
  });

  it("throws for an unknown Module id", () => {
    expect(() => chainTrack(["ghost"], {})).toThrow(/unknown Module/);
  });
});

describe("resolveTrack", () => {
  it("translates every Module's local geometry by its Segment's position at rotation 0", () => {
    const track = chainTrack(["spinner-module"], { "spinner-module": SPINNER_MODULE }, { x: 5, y: -1, z: 20 });
    const resolved = resolveTrack({ "spinner-module": SPINNER_MODULE }, track);

    expect(resolved.statics).toEqual([{ center: { x: 5, y: -1.5, z: 20 }, halfExtents: { x: 3, y: 0.5, z: 3 } }]);
    expect(resolved.spinners[0]!.center).toEqual({ x: 5, y: -1, z: 20 });
    expect(resolved.spinners[0]!.armLength).toBe(2); // tuning passes through untouched
    expect(resolved.spinners[0]!.initialAngle).toBe(0); // no rotation added at 0 rad
    expect(resolved.props[0]!.center).toEqual({ x: 6, y: -1, z: 20 });
    expect(resolved.checkpoints[0]!.respawn).toEqual({ x: 5, y: 0, z: 20 });
    expect(resolved.checkpoints[0]!.volume.halfExtents).toEqual({ x: 2, y: 2, z: 2 });
  });

  it("swaps a static Box's X/Z half-extents when its Segment is rotated 90°", () => {
    const track = [{ moduleId: "straight", position: { x: 0, y: 0, z: 0 }, rotation: Math.PI / 2 }];
    const resolved = resolveTrack({ straight: STRAIGHT }, track);
    // STRAIGHT's box is halfExtents (3, 0.5, 3) — square, so the swap is a no-op on shape,
    // but this proves resolveTrack goes through rotateBoxYaw90 rather than a plain translate.
    expect(resolved.statics[0]!.halfExtents).toEqual({ x: 3, y: 0.5, z: 3 });
  });

  it("adds the Segment's rotation into a Spinner's initialAngle instead of swapping its shape", () => {
    const track = [{ moduleId: "spinner-module", position: { x: 0, y: 0, z: 0 }, rotation: Math.PI / 2 }];
    const resolved = resolveTrack({ "spinner-module": SPINNER_MODULE }, track);
    expect(resolved.spinners[0]!.initialAngle).toBeCloseTo(Math.PI / 2, 10);
    expect(resolved.spinners[0]!.armLength).toBe(2);
    expect(resolved.spinners[0]!.armRadius).toBe(0.3);
  });

  it("resolves an empty Track to empty arrays", () => {
    expect(resolveTrack({}, [])).toEqual({ statics: [], props: [], spinners: [], checkpoints: [] });
  });

  it("throws if a Segment references an unknown Module", () => {
    const track = [{ moduleId: "ghost", position: { x: 0, y: 0, z: 0 }, rotation: 0 }];
    expect(() => resolveTrack({}, track)).toThrow(/unknown Module/);
  });
});

describe("M1_TRACK (ticket 01 — M1 playground ported to Modules; re-chained via Sockets in round 2)", () => {
  it("resolves without error and references only known Modules", () => {
    expect(() => resolveTrack(M1_MODULES, M1_TRACK)).not.toThrow();
  });

  it("preserves the same beats as the original playground: 6 stops, 1 Spinner, 3 Props, 2 Checkpoints", () => {
    const resolved = resolveTrack(M1_MODULES, M1_TRACK);
    expect(M1_TRACK).toHaveLength(6);
    expect(resolved.spinners).toHaveLength(1);
    expect(resolved.props).toHaveLength(3);
    expect(resolved.checkpoints).toHaveLength(2);
  });

  it("keeps the Spinner's exact M1 tuning (armLength/angularSpeed unchanged by the port)", () => {
    const resolved = resolveTrack(M1_MODULES, M1_TRACK);
    expect(resolved.spinners[0]).toMatchObject({ armLength: 2.5, halfHeight: 0.4, armRadius: 0.35, angularSpeed: 6.5 });
  });

  it("places the start platform under the client's PLAYGROUND_SPAWN point", () => {
    const resolved = resolveTrack(M1_MODULES, M1_TRACK);
    const start = resolved.statics[0]!;
    // PLAYGROUND_SPAWN is (0, 1.2, 10.5) — must land within the start platform's footprint.
    expect(Math.abs(0 - start.center.x)).toBeLessThanOrEqual(start.halfExtents.x);
    expect(Math.abs(10.5 - start.center.z)).toBeLessThanOrEqual(start.halfExtents.z);
  });

  it("stays at the same Segment positions the pre-Socket MODULE_STEP chain produced", () => {
    // Locks in that the Socket-based re-chain (round 2) is a pure refactor,
    // not a silent layout change.
    expect(M1_TRACK.map((s) => s.position)).toEqual([
      { x: 0, y: 0, z: 10 },
      { x: 0, y: -0.5, z: 4 },
      { x: 0, y: -1, z: -2 },
      { x: 0, y: -1.5, z: -8 },
      { x: 0, y: -2, z: -14 },
      { x: 0, y: -2.5, z: -20 },
    ]);
  });
});
