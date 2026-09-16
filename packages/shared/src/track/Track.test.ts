import { describe, expect, it } from "vitest";
import { dotQuat, eulerQuat, IDENTITY_QUAT } from "../math/quat.js";
import type { Module } from "./Module.js";
import { chainTrack, countCheckpoints, placeAfter, resolveTrack, segmentOrientation, trackHasFinishZone, trackSpawn } from "./Track.js";
import type { Track } from "./Track.js";
import { M1_MODULES, M1_TRACK } from "./modules.js";
import { GRAVITY_Y } from "../tuning.js";

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
  launchPads: [{ trigger: { center: { x: 0, y: 0.5, z: -2 }, halfExtents: { x: 1, y: 1, z: 1 } }, velocity: { x: 0, y: 16, z: -6 } }],
  volumes: [{ bounds: { center: { x: 2, y: 0.5, z: 0 }, halfExtents: { x: 1, y: 1, z: 1 } }, force: { x: 0, y: 30, z: -5 }, maxInducedSpeed: 10, priority: 1 }],
  finishZone: { trigger: { center: { x: -2, y: 1, z: 0 }, halfExtents: { x: 1, y: 2, z: 1 } } },
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
    expect(resolved.checkpoints[0]!.trigger!.halfExtents).toEqual({ x: 2, y: 2, z: 2 });
    expect(resolved.launchPads[0]!.trigger.center).toEqual({ x: 5, y: -0.5, z: 18 });
    expect(resolved.launchPads[0]!.velocity).toEqual({ x: 0, y: 16, z: -6 }); // untouched at 0 rad
    expect(resolved.volumes[0]!.bounds.center).toEqual({ x: 7, y: -0.5, z: 20 });
    expect(resolved.volumes[0]!.force).toEqual({ x: 0, y: 30, z: -5 }); // untouched at 0 rad
    expect(resolved.volumes[0]!.maxInducedSpeed).toBe(10);
    expect(resolved.volumes[0]!.priority).toBe(1);
    expect(resolved.finishZones[0]!.trigger!.center).toEqual({ x: 3, y: 0, z: 20 });
    expect(resolved.finishZones[0]!.trigger!.halfExtents).toEqual({ x: 1, y: 2, z: 1 });
  });

  it("places a Finish Zone through the same rotation-safe pipeline as a Checkpoint's trigger (ADR 0039)", () => {
    const track = [{ moduleId: "spinner-module", position: { x: 0, y: 0, z: 0 }, rotation: Math.PI / 2 }];
    const resolved = resolveTrack({ "spinner-module": SPINNER_MODULE }, track);

    // A 90° yaw takes the local (-2, 1, 0) trigger centre to world (0, 1, 2) —
    // and the box carries the Segment's rotation rather than being flattened
    // to an axis-aligned approximation, exactly like the Checkpoint above it.
    const zone = resolved.finishZones[0]!;
    expect(zone.trigger!.center.x).toBeCloseTo(0, 6);
    expect(zone.trigger!.center.y).toBeCloseTo(1, 6);
    expect(zone.trigger!.center.z).toBeCloseTo(2, 6);
    expect(zone.trigger!.rotation).toEqual(resolved.checkpoints[0]!.trigger!.rotation);
    // Detection-only: a Finish Zone never carries a respawn point (ADR 0039).
    expect(zone).not.toHaveProperty("respawn");
  });

  it("resolves a Module with no Finish Zone to none — every pre-M4 Module is unchanged", () => {
    const resolved = resolveTrack({ straight: STRAIGHT }, [{ moduleId: "straight", position: { x: 0, y: 0, z: 0 }, rotation: 0 }]);

    expect(resolved.finishZones).toEqual([]);
  });

  it("collects a Finish Zone from whichever Segments carry one, in Track order", () => {
    const modules = { "spinner-module": SPINNER_MODULE, straight: STRAIGHT };
    const resolved = resolveTrack(modules, [
      { moduleId: "straight", position: { x: 0, y: 0, z: 0 }, rotation: 0 },
      { moduleId: "spinner-module", position: { x: 0, y: 0, z: 6 }, rotation: 0 },
    ]);

    expect(resolved.finishZones).toHaveLength(1);
    expect(resolved.finishZones[0]!.trigger!.center).toEqual({ x: -2, y: 1, z: 6 });
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
      staticConveyors: [],
      staticTrimeshes: [],
      props: [],
      spinners: [],
      checkpoints: [],
      finishZones: [],
      launchPads: [],
      launchPadOwners: [],
      volumes: [],
      movingSegments: [],
      conveyors: [],
      iceDecks: [],
      mudDecks: [],
      bounceDecks: [],
      warnings: [],
    });
  });

  it("makes the M1 seed Track raceable — the finish is authored on its last Segment (M4 ticket 02)", () => {
    const resolved = resolveTrack(M1_MODULES, M1_TRACK);

    expect(resolved.finishZones).toHaveLength(1);
    // On `sandbox`, the last Segment — so a Revision already published as
    // `Segment[]` becomes raceable without being rewritten (ADR 0032).
    const last = M1_TRACK[M1_TRACK.length - 1]!;
    expect(last.moduleId).toBe("sandbox");
    expect(resolved.finishZones[0]!.trigger!.center.z).toBeCloseTo(last.position.z - 6, 6);
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

  it("preserves the same beats as the original playground: 4 stops, 1 Spinner, 3 Props, 2 Checkpoints", () => {
    const resolved = resolveTrack(M1_MODULES, M1_TRACK);
    // Four, not six, since ADR 0073 deleted the plain `bridge` connectors —
    // the Spinner, the Props and both Checkpoints all survive the cut.
    expect(M1_TRACK).toHaveLength(4);
    expect(M1_TRACK.map((s) => s.moduleId)).toEqual(["start", "checkpoint-spinner", "checkpoint-end-props", "sandbox"]);
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

  it("chains every surviving stop one Socket-step down the run", () => {
    // Every stop shares STRAIGHT_SOCKETS, so each step is the same drop:
    // -0.5 in Y, -6 in Z. The `bridge` slots ADR 0073 deleted simply close
    // up — everything after them moves two steps up the run.
    expect(M1_TRACK.map((s) => s.position)).toEqual([
      { x: 0, y: 0, z: 10 },
      { x: 0, y: -0.5, z: 4 },
      { x: 0, y: -1, z: -2 },
      { x: 0, y: -1.5, z: -8 },
    ]);
  });
});

describe("countCheckpoints", () => {
  const seg = (moduleId: string): Track[number] => ({ moduleId, position: { x: 0, y: 0, z: 0 }, rotation: 0 });
  const library: Record<string, Module> = { straight: STRAIGHT, spinner: SPINNER_MODULE };

  it("counts one per Segment whose Module authors a checkpoint, ignoring the rest", () => {
    const track: Track = [seg("straight"), seg("spinner"), seg("spinner"), seg("straight")];
    expect(countCheckpoints(track, library)).toBe(2);
  });

  it("counts zero for an empty Track and for Segments referencing unknown Modules", () => {
    expect(countCheckpoints([], library)).toBe(0);
    expect(countCheckpoints([seg("straight"), seg("nope")], library)).toBe(0);
  });
});

describe("trackHasFinishZone", () => {
  const seg = (moduleId: string): Track[number] => ({ moduleId, position: { x: 0, y: 0, z: 0 }, rotation: 0 });
  const FINISH: Module = {
    ...STRAIGHT,
    id: "finish",
    finishZone: { trigger: { center: { x: 0, y: 1, z: 0 }, halfExtents: { x: 4, y: 2, z: 2 } } },
  };
  const library: Record<string, Module> = { straight: STRAIGHT, finish: FINISH };

  it("is true when any placed Segment's Module authors a Finish Zone", () => {
    expect(trackHasFinishZone([seg("straight"), seg("finish"), seg("straight")], library)).toBe(true);
  });

  it("is false when no placed Module carries one, and for an empty Track", () => {
    expect(trackHasFinishZone([seg("straight"), seg("straight")], library)).toBe(false);
    expect(trackHasFinishZone([], library)).toBe(false);
  });

  it("ignores Segments referencing unknown Modules rather than throwing — a label, not a load", () => {
    expect(trackHasFinishZone([seg("straight"), seg("nope")], library)).toBe(false);
    expect(trackHasFinishZone([seg("nope"), seg("finish")], library)).toBe(true);
  });
});

describe("a scaled Segment (ADR 0062)", () => {
  it("places its geometry, triggers, Props and Spinners at its scale about its own origin", () => {
    const resolved = resolveTrack({ "spinner-module": SPINNER_MODULE }, [
      { moduleId: "spinner-module", position: { x: 10, y: 0, z: 0 }, rotation: 0, scale: 2 },
    ]);

    expect(resolved.statics[0]!.center).toEqual({ x: 10, y: -1, z: 0 });
    expect(resolved.statics[0]!.halfExtents).toEqual({ x: 6, y: 1, z: 6 });
    expect(resolved.checkpoints[0]!.trigger!.halfExtents).toEqual({ x: 4, y: 4, z: 4 });
    expect(resolved.checkpoints[0]!.respawn).toEqual({ x: 10, y: 2, z: 0 });
    expect(resolved.props[0]!.center).toEqual({ x: 12, y: 0, z: 0 });
    expect(resolved.props[0]!.shape).toEqual({ kind: "box", halfExtents: { x: 0.8, y: 0.8, z: 0.8 } });
    expect(resolved.spinners[0]!.armLength).toBe(4);
    // Physics feel is not size: a launch pad launches exactly as hard.
    expect(resolved.launchPads[0]!.velocity).toEqual({ x: 0, y: 16, z: -6 });
  });

  it("chains flush through scaled Sockets, and carries the placed Segment's scale", () => {
    const big = { moduleId: "straight", position: { x: 0, y: 0, z: 0 }, rotation: 0, scale: 2 };
    const next = placeAfter(big, STRAIGHT, "straight", STRAIGHT, "exit", "entry", 0.5);

    // The big one's exit is at 2·(0, -0.5, -3); the small one's entry sits 0.5·(0, 0, 3) behind its origin.
    expect(next.position).toEqual({ x: 0, y: -1, z: -7.5 });
    expect(next.scale).toBe(0.5);
    const { scale: _scale, ...unscaled } = big;
    expect(placeAfter(unscaled, STRAIGHT, "straight", STRAIGHT).scale).toBeUndefined();
  });

  it("raises the spawn with a scaled first piece but keeps Players a Player's width apart", () => {
    const at = (scale: number) => trackSpawn([{ moduleId: "straight", position: { x: 0, y: 0, z: 0 }, rotation: 0, scale }], 1);
    expect(at(2).y).toBeCloseTo(at(1).y * 2);
    expect(at(2).x).toBeCloseTo(at(1).x);
  });
});

describe("a Segment Conveyor (ADR 0064)", () => {
  const library = { straight: STRAIGHT };

  it("bakes the belt flow index-aligned with statics — belted boxes carry it, still floor reads undefined", () => {
    const resolved = resolveTrack(library, [
      { moduleId: "straight", position: { x: 0, y: 0, z: 0 }, rotation: 0 },
      { moduleId: "straight", position: { x: 0, y: 0, z: -6 }, rotation: 0, conveyor: { preset: "medium", angle: 0 } },
    ]);

    expect(resolved.staticConveyors).toHaveLength(resolved.statics.length);
    expect(resolved.staticConveyors[0]).toBeUndefined();
    expect(resolved.staticConveyors[1]).toEqual({ x: 0, y: 0, z: -4 });
  });

  it("rotates the local angle by the Segment's own yaw, never its pitch", () => {
    const yawed = resolveTrack(library, [
      { moduleId: "straight", position: { x: 0, y: 0, z: 0 }, rotation: Math.PI / 2, conveyor: { preset: "slow", angle: 0 } },
    ]);
    expect(yawed.staticConveyors[0]!.x).toBeCloseTo(-2, 10);
    expect(yawed.staticConveyors[0]!.y).toBe(0);
    expect(yawed.staticConveyors[0]!.z).toBeCloseTo(0, 10);

    const tilted = resolveTrack(library, [
      {
        moduleId: "straight",
        position: { x: 0, y: 0, z: 0 },
        rotation: 0,
        pitch: 0.5,
        conveyor: { preset: "slow", angle: 0 },
      },
    ]);
    expect(tilted.staticConveyors[0]).toEqual({ x: 0, y: 0, z: -2 });
  });

  it("a belt's speed is physics, not size — scale grows the deck frame, never the flow", () => {
    const resolved = resolveTrack(library, [
      { moduleId: "straight", position: { x: 0, y: 0, z: 0 }, rotation: 0, scale: 2, conveyor: { preset: "fast", angle: 0 } },
    ]);

    expect(resolved.staticConveyors[0]).toEqual({ x: 0, y: 0, z: -8 });
    expect(resolved.conveyors[0]!.velocity).toEqual({ x: 0, y: 0, z: -8 });
    expect(resolved.conveyors[0]!.deck.halfX).toBe(6);
    expect(resolved.conveyors[0]!.deck.halfZ).toBe(6);
  });

  it("frames the chevron strip on the Segment's own deck top, not the footprint's floating top", () => {
    const resolved = resolveTrack(library, [
      { moduleId: "straight", position: { x: 10, y: 5, z: 0 }, rotation: 0, conveyor: { preset: "medium", angle: 0 } },
    ]);

    const [belt] = resolved.conveyors;
    expect(resolved.conveyors).toHaveLength(1);
    expect(belt!.segmentIndex).toBe(0);
    // The straight Module's deck top: box centre y −0.5 + half-height 0.5 = 0, plus the Segment's y 5.
    // (The shared test footprint's own top sits a full unit above that — the bug this pins.)
    expect(belt!.deck.center).toEqual({ x: 10, y: 5, z: 0 });
    expect(belt!.deck.yaw).toBe(0);
  });

  it("lays a pitched deck's frame in the deck's own plane — mid-slope and tilted with it, not flat at its high edge", () => {
    const segment = { moduleId: "straight", position: { x: 10, y: 5, z: 0 }, rotation: 0.4, pitch: 0.3, conveyor: { preset: "medium", angle: 0 } } as const;
    const [belt] = resolveTrack(library, [segment]).conveyors;

    // The deck top's centre sits on the Segment's origin here (footprint XZ
    // centre 0, top at local y 0) whatever the tilt — a world-highest point
    // would sit well above it, at the ramp's raised end.
    expect(belt!.deck.center.x).toBeCloseTo(10, 9);
    expect(belt!.deck.center.y).toBeCloseTo(5, 9);
    expect(belt!.deck.center.z).toBeCloseTo(0, 9);
    expect(Math.abs(dotQuat(belt!.deck.orientation, segmentOrientation(segment)))).toBeCloseTo(1, 9);
  });

  it("bakes the belt onto a Moving Segment's own parts too — a belt rides its carrier", () => {
    const resolved = resolveTrack(library, [
      {
        moduleId: "straight",
        position: { x: 0, y: 0, z: 0 },
        rotation: 0,
        motion: { slide: { offset: { x: 4, y: 0, z: 0 }, period: 16, easing: "linear" } },
        conveyor: { preset: "medium", angle: 0 },
      },
    ]);

    expect(resolved.statics).toHaveLength(0); // moving collision lives on the kinematic body, not in statics
    expect(resolved.movingSegments[0]!.boxes[0]!.conveyor).toEqual({ x: 0, y: 0, z: -4 });
    expect(resolved.conveyors).toHaveLength(1); // the strip resolves at the rest pose like everything else
  });

  it("reports no belts and no warnings for an ordinary Track", () => {
    const resolved = resolveTrack(library, [{ moduleId: "straight", position: { x: 0, y: 0, z: 0 }, rotation: 0 }]);
    expect(resolved.conveyors).toEqual([]);
    expect(resolved.warnings).toEqual([]);
  });
});

describe("Segment ice (ADR 0066)", () => {
  const library = { straight: STRAIGHT };

  it("ices a Segment's own colliders and sheets its deck top — the same frame a belt would run on", () => {
    const resolved = resolveTrack(library, [
      { moduleId: "straight", position: { x: 0, y: 0, z: 0 }, rotation: 0 },
      { moduleId: "straight", position: { x: 10, y: 5, z: 0 }, rotation: 0, ice: true },
    ]);

    expect(resolved.staticSurfaces).toEqual(["default", "ice"]);
    expect(resolved.iceDecks).toHaveLength(1);
    const [sheet] = resolved.iceDecks;
    expect(sheet!.segmentIndex).toBe(1);
    // The straight Module's deck top: box centre y −0.5 + half-height 0.5 = 0, plus the Segment's y 5.
    expect(sheet!.deck.center).toEqual({ x: 10, y: 5, z: 0 });
    expect(sheet!.deck.yaw).toBe(0);
    expect(sheet!.deck.halfX).toBe(3);
    expect(sheet!.deck.halfZ).toBe(3);
  });

  it("attached ice wins over every authored Surface on its Segment — the whole deck skates", () => {
    const muddy: Module = { ...STRAIGHT, id: "muddy", surface: "mud" };
    const resolved = resolveTrack(
      { muddy },
      [{ moduleId: "muddy", position: { x: 0, y: 0, z: 0 }, rotation: 0, ice: true }],
    );

    expect(resolved.staticSurfaces).toEqual(["ice"]);
    expect(resolved.iceDecks).toHaveLength(1);
  });

  it("ices a Moving Segment's own parts and sheets it at the rest pose", () => {
    const resolved = resolveTrack(library, [
      {
        moduleId: "straight",
        position: { x: 0, y: 0, z: 0 },
        rotation: 0,
        motion: { slide: { offset: { x: 4, y: 0, z: 0 }, period: 16, easing: "linear" } },
        ice: true,
      },
    ]);

    expect(resolved.movingSegments[0]!.boxes[0]!.surface).toBe("ice");
    expect(resolved.iceDecks).toHaveLength(1);
    expect(resolved.iceDecks[0]!.segmentIndex).toBe(0);
  });

  it("scales the sheet with the Segment — a doubled deck wears a doubled sheet", () => {
    const resolved = resolveTrack(library, [
      { moduleId: "straight", position: { x: 0, y: 0, z: 0 }, rotation: 0, scale: 2, ice: true },
    ]);

    expect(resolved.iceDecks).toHaveLength(1);
    expect(resolved.iceDecks[0]!.deck.halfX).toBe(6);
    expect(resolved.iceDecks[0]!.deck.halfZ).toBe(6);
  });

  it("reports no sheets for a Track with no ice", () => {
    const resolved = resolveTrack(library, [{ moduleId: "straight", position: { x: 0, y: 0, z: 0 }, rotation: 0 }]);
    expect(resolved.iceDecks).toEqual([]);
  });
});

describe("module-authored ice (ADR 0066 — the retired Module keeps working)", () => {
  // Not the retired id itself: this pins the module rule, not the deprecation.
  const FROST: Module = { ...STRAIGHT, id: "frost", surface: "ice" };

  it("still sheets a Module whose own Surface is ice", () => {
    const resolved = resolveTrack({ frost: FROST }, [
      { moduleId: "frost", position: { x: 0, y: 0, z: 0 }, rotation: 0 },
    ]);

    expect(resolved.staticSurfaces).toEqual(["ice"]);
    expect(resolved.iceDecks).toHaveLength(1);
    expect(resolved.warnings).toEqual([]);
  });

  it("the retired ice Module loads with its ice and a warning to re-attach it", () => {
    const retired: Module = { ...STRAIGHT, id: "ice", surface: "ice" };
    const resolved = resolveTrack({ ice: retired }, [
      { moduleId: "ice", position: { x: 0, y: 0, z: 0 }, rotation: 0 },
    ]);

    expect(resolved.staticSurfaces).toEqual(["ice"]);
    expect(resolved.iceDecks).toHaveLength(1);
    expect(resolved.warnings).toHaveLength(1);
    expect(resolved.warnings[0]).toMatch(/Segment 0.*retired Module "ice".*attach ice/);
  });
});

describe("Segment mud (ADR 0067)", () => {
  const library = { straight: STRAIGHT };

  it("muds a Segment's own colliders and sheets its deck top — the same frame a belt would run on", () => {
    const resolved = resolveTrack(library, [
      { moduleId: "straight", position: { x: 0, y: 0, z: 0 }, rotation: 0 },
      { moduleId: "straight", position: { x: 10, y: 5, z: 0 }, rotation: 0, mud: true },
    ]);

    expect(resolved.staticSurfaces).toEqual(["default", "mud"]);
    expect(resolved.mudDecks).toHaveLength(1);
    const [sheet] = resolved.mudDecks;
    expect(sheet!.segmentIndex).toBe(1);
    // The straight Module's deck top: box centre y −0.5 + half-height 0.5 = 0, plus the Segment's y 5.
    expect(sheet!.deck.center).toEqual({ x: 10, y: 5, z: 0 });
    expect(sheet!.deck.yaw).toBe(0);
    expect(sheet!.deck.halfX).toBe(3);
    expect(sheet!.deck.halfZ).toBe(3);
  });

  it("attached mud wins over every authored Surface on its Segment — the whole deck drags", () => {
    const icy: Module = { ...STRAIGHT, id: "icy", surface: "ice" };
    const resolved = resolveTrack(
      { icy },
      [{ moduleId: "icy", position: { x: 0, y: 0, z: 0 }, rotation: 0, mud: true }],
    );

    expect(resolved.staticSurfaces).toEqual(["mud"]);
    expect(resolved.mudDecks).toHaveLength(1);
  });

  it("muds a Moving Segment's own parts and sheets it at the rest pose", () => {
    const resolved = resolveTrack(library, [
      {
        moduleId: "straight",
        position: { x: 0, y: 0, z: 0 },
        rotation: 0,
        motion: { slide: { offset: { x: 4, y: 0, z: 0 }, period: 16, easing: "linear" } },
        mud: true,
      },
    ]);

    expect(resolved.movingSegments[0]!.boxes[0]!.surface).toBe("mud");
    expect(resolved.mudDecks).toHaveLength(1);
    expect(resolved.mudDecks[0]!.segmentIndex).toBe(0);
  });

  it("on an unvalidated Track carrying both attachments, mud wins — physics matches the visible top layer", () => {
    const resolved = resolveTrack(library, [
      { moduleId: "straight", position: { x: 0, y: 0, z: 0 }, rotation: 0, ice: true, mud: true },
    ]);

    expect(resolved.staticSurfaces).toEqual(["mud"]);
  });

  it("reports no sheets for a Track with no mud", () => {
    const resolved = resolveTrack(library, [{ moduleId: "straight", position: { x: 0, y: 0, z: 0 }, rotation: 0 }]);
    expect(resolved.mudDecks).toEqual([]);
  });
});

describe("module-authored mud (ADR 0067 — the retired Module keeps working)", () => {
  // Not the retired id itself: this pins the module rule, not the deprecation.
  const SLOP: Module = { ...STRAIGHT, id: "slop", surface: "mud" };

  it("still sheets a Module whose own Surface is mud", () => {
    const resolved = resolveTrack({ slop: SLOP }, [
      { moduleId: "slop", position: { x: 0, y: 0, z: 0 }, rotation: 0 },
    ]);

    expect(resolved.staticSurfaces).toEqual(["mud"]);
    expect(resolved.mudDecks).toHaveLength(1);
    expect(resolved.warnings).toEqual([]);
  });

  it("the retired mud Module loads with its mud and a warning to re-attach it", () => {
    const retired: Module = { ...STRAIGHT, id: "mud", surface: "mud" };
    const resolved = resolveTrack({ mud: retired }, [
      { moduleId: "mud", position: { x: 0, y: 0, z: 0 }, rotation: 0 },
    ]);

    expect(resolved.staticSurfaces).toEqual(["mud"]);
    expect(resolved.mudDecks).toHaveLength(1);
    expect(resolved.warnings).toHaveLength(1);
    expect(resolved.warnings[0]).toMatch(/Segment 0.*retired Module "mud".*attach mud/);
  });
});

describe("Segment bounce (ADR 0070)", () => {
  const library = { straight: STRAIGHT };
  const bouncy = (extra: Record<string, unknown> = {}) => [
    { moduleId: "straight", position: { x: 0, y: 0, z: 0 }, rotation: 0, bounce: true, ...extra },
  ];

  it("turns the whole deck bouncy and hands the renderers a sheet", () => {
    const resolved = resolveTrack(library, bouncy());
    expect(resolved.staticSurfaces.every((surface) => surface === "bounce")).toBe(true);
    expect(resolved.bounceDecks).toHaveLength(1);
    expect(resolved.bounceDecks[0]!.segmentIndex).toBe(0);
  });

  it("sheets nothing on a plain Segment", () => {
    const resolved = resolveTrack(library, [{ moduleId: "straight", position: { x: 0, y: 0, z: 0 }, rotation: 0 }]);
    expect(resolved.bounceDecks).toHaveLength(0);
    expect(resolved.staticSurfaces.every((surface) => surface === "bounce")).toBe(false);
  });

  it("wins over ice and mud if an unvalidated Track arrives carrying a pair — the visible top layer is the one you feel", () => {
    // Publish refuses the pair outright (one deck, one Surface); this is only
    // the tie-break for a Track that reached the simulation another way.
    const resolved = resolveTrack(library, bouncy({ ice: true, mud: true }));
    expect(resolved.staticSurfaces.every((surface) => surface === "bounce")).toBe(true);
  });
});

describe("a Spring (ADR 0069)", () => {
  const SPRING: Module = {
    id: "spring",
    statics: [{ center: { x: 0, y: 0.25, z: 0 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } }],
    launch: { trigger: { center: { x: 0, y: 1, z: 0 }, halfExtents: { x: 0.5, y: 0.5, z: 0.5 } }, height: 6 },
    sockets: STRAIGHT_SOCKETS,
    footprint: FOOTPRINT,
  };
  const library = { spring: SPRING, straight: STRAIGHT };
  const apexOf = (speed: number): number => (speed * speed) / (2 * Math.abs(GRAVITY_Y));

  it("launches at its Asset's default height with nothing authored on the Segment", () => {
    const resolved = resolveTrack(library, [{ moduleId: "spring", position: { x: 0, y: 0, z: 0 }, rotation: 0 }]);
    expect(resolved.launchPads).toHaveLength(1);
    expect(apexOf(resolved.launchPads[0]!.velocity.y)).toBeCloseTo(6, 6);
    expect(resolved.launchPads[0]!.velocity.x).toBeCloseTo(0, 10);
    expect(resolved.launchPads[0]!.velocity.z).toBeCloseTo(0, 10);
  });

  it("launches at the Segment's own height when it overrides", () => {
    const resolved = resolveTrack(library, [
      { moduleId: "spring", position: { x: 0, y: 0, z: 0 }, rotation: 0, launch: { height: 12 } },
    ]);
    expect(apexOf(resolved.launchPads[0]!.velocity.y)).toBeCloseTo(12, 6);
  });

  it("is aimed by tilting the Segment — a pitched Spring throws sideways, the visual can't lie", () => {
    const upright = resolveTrack(library, [{ moduleId: "spring", position: { x: 0, y: 0, z: 0 }, rotation: 0 }]);
    const tilted = resolveTrack(library, [
      { moduleId: "spring", position: { x: 0, y: 0, z: 0 }, rotation: 0, pitch: Math.PI / 6 },
    ]);
    const straightUp = upright.launchPads[0]!.velocity.y;
    expect(tilted.launchPads[0]!.velocity.y).toBeCloseTo(straightUp * Math.cos(Math.PI / 6), 6);
    expect(Math.hypot(tilted.launchPads[0]!.velocity.x, tilted.launchPads[0]!.velocity.z)).toBeCloseTo(
      straightUp * Math.sin(Math.PI / 6),
      6,
    );
  });

  it("scales its trigger with the Segment but never its throw — a bigger Spring is a bigger target, not a stronger one", () => {
    const [plain] = [resolveTrack(library, [{ moduleId: "spring", position: { x: 0, y: 0, z: 0 }, rotation: 0 }])];
    const big = resolveTrack(library, [{ moduleId: "spring", position: { x: 0, y: 0, z: 0 }, rotation: 0, scale: 2 }]);
    expect(big.launchPads[0]!.trigger.halfExtents.y).toBeCloseTo(plain!.launchPads[0]!.trigger.halfExtents.y * 2, 10);
    expect(big.launchPads[0]!.velocity.y).toBeCloseTo(plain!.launchPads[0]!.velocity.y, 10);
  });

  it("reports which Segment every launch pad came from, Module-authored pads included", () => {
    const resolved = resolveTrack({ ...library, spinner: SPINNER_MODULE }, [
      { moduleId: "straight", position: { x: 0, y: 0, z: 0 }, rotation: 0 },
      { moduleId: "spring", position: { x: 0, y: 0, z: -6 }, rotation: 0 },
      { moduleId: "spinner", position: { x: 0, y: 0, z: -12 }, rotation: 0 },
      { moduleId: "spring", position: { x: 0, y: 0, z: -18 }, rotation: 0 },
    ]);
    expect(resolved.launchPadOwners).toHaveLength(resolved.launchPads.length);
    expect(resolved.launchPadOwners).toEqual([1, 2, 3]);
  });

  it("warns that a moving Spring launches from where it rests, and still resolves", () => {
    const resolved = resolveTrack(library, [
      {
        moduleId: "spring",
        position: { x: 0, y: 0, z: 0 },
        rotation: 0,
        motion: { slide: { offset: { x: 0, y: 0, z: 6 }, period: 4, easing: "linear" } },
      },
    ]);
    expect(resolved.launchPads).toHaveLength(1);
    expect(resolved.warnings.some((w) => /Spring on a Moving Segment/.test(w))).toBe(true);
  });
});

describe("retired pad Modules (ADR 0064)", () => {
  it("loads a speed-pad/slow-pad Segment as plain geometry, with one warning naming each", () => {
    const track: Track = [
      { moduleId: "speed-pad", position: { x: 0, y: 0, z: 0 }, rotation: 0 },
      { moduleId: "slow-pad", position: { x: 0, y: 0, z: -6 }, rotation: 0 },
    ];
    const resolved = resolveTrack(M1_MODULES, track);

    expect(resolved.statics).toHaveLength(2);
    expect(resolved.conveyors).toEqual([]);
    expect(resolved.warnings).toHaveLength(2);
    expect(resolved.warnings[0]).toMatch(/Segment 0.*speed-pad/);
    expect(resolved.warnings[1]).toMatch(/Segment 1.*slow-pad/);
  });
});
