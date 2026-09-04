import { describe, expect, it } from "vitest";
import { dotQuat, eulerQuat, IDENTITY_QUAT } from "../math/quat.js";
import type { Module } from "./Module.js";
import { chainTrack, placeAfter, resolveTrack, segmentOrientation } from "./Track.js";
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
    trigger: { center: { x: 0, y: 1, z: 0 }, halfExtents: { x: 2, y: 2, z: 2 } },
  },
  speedPads: [{ trigger: { center: { x: 0, y: 0.5, z: 2 }, halfExtents: { x: 1, y: 1, z: 1 } }, capMultiplier: 2 }],
  launchPads: [{ trigger: { center: { x: 0, y: 0.5, z: -2 }, halfExtents: { x: 1, y: 1, z: 1 } }, velocity: { x: 0, y: 16, z: -6 } }],
  volumes: [{ bounds: { center: { x: 2, y: 0.5, z: 0 }, halfExtents: { x: 1, y: 1, z: 1 } }, force: { x: 0, y: 30, z: -5 }, maxInducedSpeed: 10, priority: 1 }],
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

  it("accepts a world rotation that isn't a multiple of 90° — the whole point of ADR 0034", () => {
    const crooked: Module = {
      ...TURN_RIGHT,
      sockets: [TURN_RIGHT.sockets[0]!, { ...TURN_RIGHT.sockets[1]!, yaw: -Math.PI / 4 }],
    };
    const prev = { moduleId: "crooked", position: { x: 0, y: 0, z: 10 }, rotation: 0 };
    const next = placeAfter(prev, crooked, "straight", STRAIGHT);
    expect(next.rotation).toBeCloseTo(-Math.PI / 4, 10);
  });

  it("carries a tilted predecessor's pitch/roll through so the next Segment still faces the exit Socket correctly", () => {
    const tiltedPrev = { moduleId: "straight", position: { x: 0, y: 0, z: 10 }, rotation: 0, pitch: 0.2, roll: 0.1 };
    const next = placeAfter(tiltedPrev, STRAIGHT, "straight", STRAIGHT);
    // The exit Socket's world orientation (tiltedPrev's tilt, since the exit
    // Socket itself has no local tilt) composed with a 180° flip is what the
    // next Segment's own orientation must equal.
    const expectedOrientation = eulerQuat(0, 0.2, 0.1);
    const actualOrientation = segmentOrientation(next);
    expect(Math.abs(dotQuat(expectedOrientation, actualOrientation))).toBeCloseTo(1, 6);
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

    expect(resolved.statics).toEqual([
      { center: { x: 5, y: -1.5, z: 20 }, halfExtents: { x: 3, y: 0.5, z: 3 }, rotation: IDENTITY_QUAT },
    ]);
    expect(resolved.spinners[0]!.center).toEqual({ x: 5, y: -1, z: 20 });
    expect(resolved.spinners[0]!.armLength).toBe(2); // tuning passes through untouched
    expect(resolved.spinners[0]!.initialAngle).toBe(0); // no rotation added at 0 rad
    expect(resolved.props[0]!.center).toEqual({ x: 6, y: -1, z: 20 });
    expect(resolved.checkpoints[0]!.respawn).toEqual({ x: 5, y: 0, z: 20 });
    expect(resolved.checkpoints[0]!.trigger.halfExtents).toEqual({ x: 2, y: 2, z: 2 });
    expect(resolved.speedPads[0]!.capMultiplier).toBe(2);
    expect(resolved.speedPads[0]!.trigger.center).toEqual({ x: 5, y: -0.5, z: 22 });
    expect(resolved.launchPads[0]!.trigger.center).toEqual({ x: 5, y: -0.5, z: 18 });
    expect(resolved.launchPads[0]!.velocity).toEqual({ x: 0, y: 16, z: -6 }); // untouched at 0 rad
    expect(resolved.volumes[0]!.bounds.center).toEqual({ x: 7, y: -0.5, z: 20 });
    expect(resolved.volumes[0]!.force).toEqual({ x: 0, y: 30, z: -5 }); // untouched at 0 rad
    expect(resolved.volumes[0]!.maxInducedSpeed).toBe(10);
    expect(resolved.volumes[0]!.priority).toBe(1);
  });

  it("rotates a launch pad's velocity by the Segment's own orientation — a direction, not a point, so it's never translated", () => {
    const track = [{ moduleId: "spinner-module", position: { x: 5, y: 0, z: 5 }, rotation: Math.PI / 2 }];
    const resolved = resolveTrack({ "spinner-module": SPINNER_MODULE }, track);
    // A 90° yaw rotates local (0, 16, -6) to world (-6, 16, 0) — Y (a
    // vertical launch component) is untouched by a pure yaw; X and Z swap
    // and flip sign the same way `placeAfter`'s own yaw rotation does.
    expect(resolved.launchPads[0]!.velocity.x).toBeCloseTo(-6, 6);
    expect(resolved.launchPads[0]!.velocity.y).toBeCloseTo(16, 6);
    expect(resolved.launchPads[0]!.velocity.z).toBeCloseTo(0, 6);
    // The trigger's own centre, by contrast, IS translated by the Segment's
    // position (5,0,5) — confirming velocity and trigger get different
    // treatment from the same `orientation`/`segment.position` inputs.
    expect(resolved.launchPads[0]!.trigger.center.x).not.toBeCloseTo(-6, 1);
  });

  it("rotates a Volume's force by the Segment's own orientation, the same treatment as a launch pad's velocity", () => {
    const track = [{ moduleId: "spinner-module", position: { x: 5, y: 0, z: 5 }, rotation: Math.PI / 2 }];
    const resolved = resolveTrack({ "spinner-module": SPINNER_MODULE }, track);
    // Same 90° yaw as the launch pad test above: local (0, 30, -5) rotates to
    // world (-5, 30, 0) — Y (vertical) untouched, X/Z swap and flip sign.
    expect(resolved.volumes[0]!.force.x).toBeCloseTo(-5, 6);
    expect(resolved.volumes[0]!.force.y).toBeCloseTo(30, 6);
    expect(resolved.volumes[0]!.force.z).toBeCloseTo(0, 6);
    // The bounds' own centre, by contrast, IS translated.
    expect(resolved.volumes[0]!.bounds.center.x).not.toBeCloseTo(-5, 1);
  });

  it("never swaps a static Box's half-extents (ADR 0034) — carries its rotation instead, for a real rotated collider", () => {
    const track = [{ moduleId: "straight", position: { x: 0, y: 0, z: 0 }, rotation: Math.PI / 2 }];
    const resolved = resolveTrack({ straight: STRAIGHT }, track);
    // halfExtents are exactly as authored — no more axis-swap trick.
    expect(resolved.statics[0]!.halfExtents).toEqual({ x: 3, y: 0.5, z: 3 });
    const dot = dotQuat(resolved.statics[0]!.rotation!, eulerQuat(Math.PI / 2, 0, 0));
    expect(Math.abs(dot)).toBeCloseTo(1, 6);
  });

  it("carries a tilted Segment's rotation into a static Box's OrientedBox, not just its centre", () => {
    const track = [{ moduleId: "straight", position: { x: 0, y: 0, z: 0 }, rotation: 0, pitch: 0.3, roll: 0.2 }];
    const resolved = resolveTrack({ straight: STRAIGHT }, track);
    const dot = dotQuat(resolved.statics[0]!.rotation!, eulerQuat(0, 0.3, 0.2));
    expect(Math.abs(dot)).toBeCloseTo(1, 6);
  });

  it("adds the Segment's rotation into a Spinner's initialAngle instead of swapping its shape", () => {
    const track = [{ moduleId: "spinner-module", position: { x: 0, y: 0, z: 0 }, rotation: Math.PI / 2 }];
    const resolved = resolveTrack({ "spinner-module": SPINNER_MODULE }, track);
    expect(resolved.spinners[0]!.initialAngle).toBeCloseTo(Math.PI / 2, 10);
    expect(resolved.spinners[0]!.armLength).toBe(2);
    expect(resolved.spinners[0]!.armRadius).toBe(0.3);
  });

  it("a Spinner's spin axis doesn't tilt with a pitched/rolled Segment — only its position and initialAngle do (known limitation, ADR 0034)", () => {
    const track = [{ moduleId: "spinner-module", position: { x: 0, y: 0, z: 0 }, rotation: 0, pitch: 0.4, roll: 0.3 }];
    const resolved = resolveTrack({ "spinner-module": SPINNER_MODULE }, track);
    expect(resolved.spinners[0]!.initialAngle).toBeCloseTo(0, 10);
  });

  it("positions a Prop correctly under a tilted Segment but doesn't tilt its own shape (known limitation, ADR 0034 — Props have no spawn orientation yet)", () => {
    const oblongProp: Module = {
      ...SPINNER_MODULE,
      props: [{ shape: { kind: "box", halfExtents: { x: 0.4, y: 0.1, z: 0.9 } }, center: { x: 1, y: 0, z: 0 } }],
    };
    const track = [{ moduleId: "oblong-prop", position: { x: 0, y: 0, z: 0 }, rotation: Math.PI / 2, pitch: 0.3 }];
    const resolved = resolveTrack({ "oblong-prop": oblongProp }, track);
    // Position follows the full 3D rotation...
    expect(resolved.props[0]!.center).not.toEqual({ x: 1, y: 0, z: 0 });
    // ...but the shape is untouched, exactly as authored.
    expect(resolved.props[0]!.shape).toEqual({ kind: "box", halfExtents: { x: 0.4, y: 0.1, z: 0.9 } });
  });

  it("resolves an empty Track to empty arrays", () => {
    expect(resolveTrack({}, [])).toEqual({
      statics: [],
      staticSurfaces: [],
      props: [],
      spinners: [],
      checkpoints: [],
      speedPads: [],
      launchPads: [],
      volumes: [],
    });
  });

  it("throws if a Segment references an unknown Module", () => {
    const track = [{ moduleId: "ghost", position: { x: 0, y: 0, z: 0 }, rotation: 0 }];
    expect(() => resolveTrack({}, track)).toThrow(/unknown Module/);
  });
});

describe("resolveTrack — Surface collapse (ticket 01, ADR 0036: Box.surface ?? Module.surface ?? \"default\", once, not in the tick loop)", () => {
  it("a Module with no Surface anywhere resolves to \"default\" throughout", () => {
    const track = [{ moduleId: "straight", position: { x: 0, y: 0, z: 0 }, rotation: 0 }];
    const resolved = resolveTrack({ straight: STRAIGHT }, track);
    expect(resolved.staticSurfaces).toEqual(["default"]);
  });

  it("a Module's own Surface applies to every one of its floor Boxes that doesn't override it", () => {
    const muddy: Module = { ...STRAIGHT, id: "muddy", surface: "mud" };
    const track = [{ moduleId: "muddy", position: { x: 0, y: 0, z: 0 }, rotation: 0 }];
    const resolved = resolveTrack({ muddy }, track);
    expect(resolved.staticSurfaces).toEqual(["mud"]);
  });

  it("a Box's own Surface wins over its Module's", () => {
    const mixed: Module = {
      ...STRAIGHT,
      id: "mixed",
      surface: "mud",
      statics: [
        { center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 3, y: 0.5, z: 3 }, surface: "ice" },
        { center: { x: 6, y: -0.5, z: 0 }, halfExtents: { x: 3, y: 0.5, z: 3 } },
      ],
    };
    const track = [{ moduleId: "mixed", position: { x: 0, y: 0, z: 0 }, rotation: 0 }];
    const resolved = resolveTrack({ mixed }, track);
    // First Box overrides the Module's mud with its own ice; the second has
    // no Box-level override, so it falls through to the Module's mud.
    expect(resolved.staticSurfaces).toEqual(["ice", "mud"]);
  });

  it("staticSurfaces stays index-aligned with statics across multiple Segments", () => {
    const muddy: Module = { ...STRAIGHT, id: "muddy", surface: "mud" };
    const track = [
      { moduleId: "straight", position: { x: 0, y: 0, z: 0 }, rotation: 0 },
      { moduleId: "muddy", position: { x: 6, y: 0, z: 0 }, rotation: 0 },
    ];
    const resolved = resolveTrack({ straight: STRAIGHT, muddy }, track);
    expect(resolved.staticSurfaces).toEqual(["default", "mud"]);
    expect(resolved.statics).toHaveLength(2);
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
