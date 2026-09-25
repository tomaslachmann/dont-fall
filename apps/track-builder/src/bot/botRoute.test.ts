import type { Checkpoint, PlacedGate, ResolvedTrack, Track, TrackNav, Vec3 } from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import { botRouteTargets, buildBotLegs } from "./botRoute.js";

/** Just enough of a `ResolvedTrack` for `botRouteTargets` — it only ever reads `checkpoints` and `finishZones`. */
const resolvedOf = (parts: Partial<ResolvedTrack>): ResolvedTrack => ({
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
  shooters: [],
  conveyors: [],
  iceDecks: [],
  mudDecks: [],
  bounceDecks: [],
  warnings: [],
  ...parts,
});

const TRACK: Track = [{ moduleId: "deck", position: { x: 0, y: 0, z: 0 }, rotation: 0 }];

const checkpointAt = (respawn: Vec3): Checkpoint => ({ respawn, trigger: { center: respawn, halfExtents: { x: 1, y: 1, z: 1 } } });

/** A minimal but type-correct `PlacedGate` — only `center` matters to `botRouteTargets`. */
const gateAt = (center: Vec3): PlacedGate => ({
  origin: center,
  u: { x: 1, y: 0, z: 0 },
  v: { x: 0, y: 1, z: 0 },
  n: { x: 0, y: 0, z: 1 },
  cell: 1,
  cols: 1,
  rows: 1,
  open: new Uint8Array([1]),
  center,
});

describe("botRouteTargets", () => {
  it("is the spawn alone when the Track has neither Checkpoints nor a Finish Zone", () => {
    const targets = botRouteTargets(resolvedOf({}), TRACK, {});
    expect(targets).toHaveLength(1);
  });

  it("runs spawn, then every Checkpoint's Respawn in resolveTrack's own order, then the Finish Zone", () => {
    const cp1 = { x: 1, y: 0, z: -10 };
    const cp2 = { x: 2, y: 0, z: -20 };
    const finish = { x: 3, y: 0, z: -30 };
    const targets = botRouteTargets(
      resolvedOf({ checkpoints: [checkpointAt(cp1), checkpointAt(cp2)], finishZones: [{ trigger: { center: finish, halfExtents: { x: 1, y: 1, z: 1 } } }] }),
      TRACK,
      {},
    );
    expect(targets.slice(1)).toEqual([cp1, cp2, finish]);
  });

  it("ends at the last Checkpoint on a Survival arena, which has no Finish Zone", () => {
    const cp1 = { x: 1, y: 0, z: -10 };
    const targets = botRouteTargets(resolvedOf({ checkpoints: [checkpointAt(cp1)] }), TRACK, {});
    expect(targets.at(-1)).toEqual(cp1);
  });

  it("reads a gate Finish Zone's centre, not just a trigger's", () => {
    const finish = { x: 5, y: 0, z: -40 };
    const targets = botRouteTargets(resolvedOf({ finishZones: [{ gate: gateAt(finish) }] }), TRACK, {});
    expect(targets.at(-1)).toEqual(finish);
  });
});

/** A `TrackNav` stand-in — `navPath` only ever calls `query.computePath`. */
const navWith = (computePath: TrackNav["query"]["computePath"]): TrackNav =>
  ({ navMesh: {}, query: { computePath } }) as unknown as TrackNav;

describe("buildBotLegs", () => {
  it("builds one leg per consecutive pair of targets", () => {
    const targets: Vec3[] = [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }];
    const nav = navWith((start, end) => ({ success: true, path: [start, end] }));
    const legs = buildBotLegs(nav, targets);
    expect(legs).toHaveLength(2);
    expect(legs[0]).toMatchObject({ from: targets[0], to: targets[1] });
    expect(legs[1]).toMatchObject({ from: targets[1], to: targets[2] });
  });

  it("is complete when the path's last corner lands on the target", () => {
    const from = { x: 0, y: 0, z: 0 };
    const to = { x: 10, y: 0, z: 0 };
    const nav = navWith(() => ({ success: true, path: [from, to] }));
    const [leg] = buildBotLegs(nav, [from, to]);
    expect(leg!.complete).toBe(true);
    expect(leg!.points).toEqual([from, to]);
  });

  it("stops short when the query finds no path at all — a bare `[from]`, incomplete", () => {
    const from = { x: 0, y: 0, z: 0 };
    const to = { x: 10, y: 0, z: 0 };
    const nav = navWith(() => ({ success: false, path: [] }));
    const [leg] = buildBotLegs(nav, [from, to]);
    expect(leg!.complete).toBe(false);
    expect(leg!.points).toEqual([from]);
  });

  it("stops short when Detour's own partial path lands well clear of the target (M17 ticket 01's finding)", () => {
    const from = { x: 0, y: 0, z: 0 };
    const to = { x: 100, y: 0, z: 0 };
    const stoppedAt = { x: 40, y: 0, z: 0 };
    const nav = navWith(() => ({ success: true, path: [from, stoppedAt] }));
    const [leg] = buildBotLegs(nav, [from, to]);
    expect(leg!.complete).toBe(false);
    expect(leg!.points).toEqual([from, stoppedAt]);
  });

  it("stays complete for the small mismatch between a floor-height corner and a Respawn's own clearance", () => {
    const from = { x: 0, y: 0, z: 0 };
    const to = { x: 10, y: 0.6, z: 0 }; // a Checkpoint's Respawn sits RESPAWN_ABOVE_FLOOR above the corner navPath returns
    const nav = navWith(() => ({ success: true, path: [from, { x: 10, y: 0, z: 0 }] }));
    const [leg] = buildBotLegs(nav, [from, to]);
    expect(leg!.complete).toBe(true);
  });
});
