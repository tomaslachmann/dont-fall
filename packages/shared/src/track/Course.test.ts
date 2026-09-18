import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { CAPSULE_BOTTOM_OFFSET } from "../tuning/character.js";
import { TICK_RATE_HZ } from "../tuning/clock.js";
import { initPhysics, RapierSimulation } from "../simulation/RapierSimulation.js";
import { IDLE_INPUTS } from "../simulation/SimInputs.js";
import { loadAssetModule } from "./asset.js";
import { ASSET_MODULE_DEFS, attachAssetGeometry } from "./assetModules.js";
import {
  floorBelow,
  invalidCheckpointReason,
  invalidStartReason,
  invalidTrackCourseReason,
  RESPAWN_ABOVE_FLOOR,
  RESPAWN_GATE_CLEARANCE,
} from "./Course.js";
import type { Module } from "./Module.js";
import { M1_MODULES } from "./modules.js";
import { resolveTrack } from "./resolveTrack.js";
import { countCheckpoints, trackHasFinishZone, trackSpawn, trackSpawnYaw, type Track } from "./Track.js";

beforeAll(async () => {
  await initPhysics();
});

const assetsRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "assets");
const asset = (id: string): Module => {
  const def = ASSET_MODULE_DEFS.find((d) => d.id === id)!;
  return attachAssetGeometry(def, loadAssetModule(new Uint8Array(readFileSync(join(assetsRoot, `${id}.glb`))), { footprint: def.footprint.bounds }));
};

/** A 16 × 1 × 30 slab, top face at y = 0. */
const GROUND: Module = {
  id: "ground",
  statics: [{ center: { x: 0, y: -0.5, z: -5 }, halfExtents: { x: 8, y: 0.5, z: 15 } }],
  sockets: [],
  footprint: { bounds: { center: { x: 0, y: -0.5, z: -5 }, halfExtents: { x: 8, y: 0.5, z: 15 } }, clearance: 0.5 },
};
const ARCH = asset("kaykit_arch_blue");
const HOOP = asset("kaykit_hoop_blue");
const FINISH = asset("kaykit_signage_finish");
const MODULES: Record<string, Module> = {
  ground: GROUND,
  kaykit_arch_blue: ARCH,
  kaykit_hoop_blue: HOOP,
  kaykit_signage_finish: FINISH,
  "checkpoint-spinner": M1_MODULES["checkpoint-spinner"]!,
};
const ground = { moduleId: "ground", position: { x: 0, y: 0, z: 0 }, rotation: 0 };

describe("course validation (ADR 0068)", () => {
  it("takes a Checkpoint as a whole number from 1 with an optional respawn spot", () => {
    expect(invalidCheckpointReason({ order: 1 })).toBeUndefined();
    expect(invalidCheckpointReason({ order: 3, respawn: { x: 0, y: 0, z: 2 } })).toBeUndefined();
    expect(invalidCheckpointReason({ order: 0 })).toMatch(/whole number/);
    expect(invalidCheckpointReason({ order: 1.5 })).toMatch(/whole number/);
    expect(invalidCheckpointReason({ order: 1, respawn: { x: 0, y: Number.NaN, z: 0 } })).toMatch(/respawn/);
    expect(invalidCheckpointReason({ order: 1, colour: "red" })).toMatch(/unknown field/);
    expect(invalidStartReason(true)).toBeUndefined();
    expect(invalidStartReason(false)).toMatch(/true/);
  });

  it("refuses two Starts, a moving Start, Checkpoint or finish, a Checkpoint off a hoop or arch, and a repeated number", () => {
    const slide = { slide: { offset: { x: 2, y: 0, z: 0 }, period: 4, easing: "linear" as const } };
    const arch = (z: number, order: number) => ({ moduleId: "kaykit_arch_blue", position: { x: 0, y: 0, z }, rotation: 0, checkpoint: { order } });
    expect(invalidTrackCourseReason([ground, arch(0, 1), arch(-6, 2)], MODULES)).toBeUndefined();
    expect(invalidTrackCourseReason([{ ...ground, start: true }, { ...arch(0, 1), start: true }], MODULES)).toMatch(/2 Starts/);
    expect(invalidTrackCourseReason([{ ...ground, start: true, motion: slide }], MODULES)).toMatch(/Start and moves/);
    expect(invalidTrackCourseReason([{ ...arch(0, 1), motion: slide }], MODULES)).toMatch(/Checkpoint and moves/);
    expect(invalidTrackCourseReason([{ moduleId: "kaykit_signage_finish", position: { x: 0, y: 0, z: 0 }, rotation: 0, motion: slide }], MODULES)).toMatch(/finish sign and moves/);
    expect(invalidTrackCourseReason([{ ...ground, checkpoint: { order: 1 } }], MODULES)).toMatch(/not a hoop or an arch/);
    expect(invalidTrackCourseReason([ground, arch(0, 2), arch(-6, 2)], MODULES)).toMatch(/both Checkpoint 2/);
  });
});

describe("resolving a course (ADR 0068)", () => {
  it("makes a switched-on arch a Checkpoint whose respawn stands on the floor just in front of it, the side a runner arrives from", () => {
    const resolved = resolveTrack(MODULES, [ground, { moduleId: "kaykit_arch_blue", position: { x: 1, y: 0, z: -2 }, rotation: 0, checkpoint: { order: 1 } }]);
    expect(resolved.warnings).toEqual([]);
    expect(resolved.checkpoints).toHaveLength(1);
    const [checkpoint] = resolved.checkpoints;
    expect(checkpoint!.gate).toBeDefined();
    // The spawn (on the ground, z ≈ 0.5) is on the arch's +Z side: clear of its 0.375-deep legs.
    const depth = ARCH.footprint.bounds.halfExtents.z;
    expect(checkpoint!.respawn.x).toBeCloseTo(1 + ARCH.gate!.opening.center.x, 5);
    expect(checkpoint!.respawn.y).toBeCloseTo(RESPAWN_ABOVE_FLOOR, 5);
    expect(checkpoint!.respawn.z).toBeCloseTo(-2 + depth + RESPAWN_GATE_CLEARANCE, 5);
  });

  it("stands the respawn in front of the next gate as seen from the previous one — behind it when that side is a drop", () => {
    const toward = (z: number, order: number) => ({ moduleId: "kaykit_hoop_blue", position: { x: 0, y: 0, z }, rotation: 0, checkpoint: { order } });
    const resolved = resolveTrack(MODULES, [ground, toward(-4, 2), toward(-12, 1)]);
    // 1 (z −12) is reached from the spawn on +Z; 2 (z −4) from 1, on −Z.
    expect(resolved.checkpoints.map((c) => Math.sign(c.respawn.z - (c.gate!.center.z)))).toEqual([1, -1]);
    // A hoop at the ground's far edge: nothing in front, so behind.
    const edge = resolveTrack(MODULES, [ground, { moduleId: "kaykit_hoop_blue", position: { x: 0, y: 0, z: 10.2 }, rotation: Math.PI, checkpoint: { order: 1 } }]);
    expect(edge.checkpoints[0]!.respawn.z).toBeLessThan(10.2);
  });

  it("leaves an arch that isn't switched on as art", () => {
    const resolved = resolveTrack(MODULES, [ground, { moduleId: "kaykit_arch_blue", position: { x: 0, y: 0, z: 0 }, rotation: 0 }]);
    expect(resolved.checkpoints).toEqual([]);
    expect(countCheckpoints([ground, { moduleId: "kaykit_arch_blue", position: { x: 0, y: 0, z: 0 }, rotation: 0 }], MODULES)).toBe(0);
  });

  it("never stands a hoop's respawn on its own ring or stand — a hoop over a drop is no Checkpoint until a spot is picked", () => {
    const overVoid: Track = [{ moduleId: "kaykit_hoop_blue", position: { x: 40, y: 5, z: 0 }, rotation: 0, checkpoint: { order: 1 } }];
    const lonely = resolveTrack(MODULES, [ground, ...overVoid]);
    expect(lonely.checkpoints).toEqual([]);
    expect(lonely.warnings.join()).toMatch(/Segment 1 \(Checkpoint 1\) has no floor in front of or behind it/);

    const picked = resolveTrack(MODULES, [ground, { ...overVoid[0]!, checkpoint: { order: 1, respawn: { x: -40, y: -5, z: 3 } } }]);
    expect(picked.warnings).toEqual([]);
    expect(picked.checkpoints[0]!.respawn).toEqual({ x: 0, y: RESPAWN_ABOVE_FLOOR, z: 3 });
  });

  it("orders gates by number, after any retired block's Checkpoint", () => {
    const track: Track = [
      ground,
      { moduleId: "kaykit_arch_blue", position: { x: 0, y: 0, z: -8 }, rotation: 0, checkpoint: { order: 2 } },
      { moduleId: "checkpoint-spinner", position: { x: 0, y: 0, z: 30 }, rotation: 0 },
      { moduleId: "kaykit_arch_blue", position: { x: 0, y: 0, z: -2 }, rotation: 0, checkpoint: { order: 1 } },
    ];
    const resolved = resolveTrack(MODULES, track);
    expect(resolved.checkpoints.map((c) => (c.gate ? `gate@${Math.round(c.gate.center.z)}` : "block"))).toEqual(["block", "gate@-2", "gate@-8"]);
    expect(countCheckpoints(track, MODULES)).toBe(3);
  });

  it("ignores a Checkpoint mark on anything but a hoop or an arch, and says so", () => {
    const resolved = resolveTrack(MODULES, [{ ...ground, checkpoint: { order: 1 } }]);
    expect(resolved.checkpoints).toEqual([]);
    expect(resolved.warnings.join()).toMatch(/not a hoop or an arch/);
  });

  it("makes every placed finish sign a Finish Zone", () => {
    const track: Track = [ground, { moduleId: "kaykit_signage_finish", position: { x: 0, y: 0, z: -10 }, rotation: 0 }];
    const resolved = resolveTrack(MODULES, track);
    expect(resolved.finishZones).toHaveLength(1);
    expect(resolved.finishZones[0]!.gate).toBeDefined();
    expect(trackHasFinishZone(track, MODULES)).toBe(true);
    expect(trackHasFinishZone([ground], MODULES)).toBe(false);
  });

  it("finds the floor straight down through boxes and trimeshes, nearest first", () => {
    const resolved = resolveTrack(MODULES, [ground, { moduleId: "kaykit_arch_blue", position: { x: 0, y: 0, z: 0 }, rotation: 0 }]);
    expect(floorBelow({ x: 0, y: 10, z: 0 }, resolved.statics, [])).toEqual({ x: 0, y: 0, z: 0 });
    // The arch's beam is the first thing under a point above it.
    expect(floorBelow({ x: 0, y: 10, z: 0 }, resolved.statics, resolved.staticTrimeshes)!.y).toBeGreaterThan(3);
    expect(floorBelow({ x: 30, y: 10, z: 0 }, resolved.statics, resolved.staticTrimeshes)).toBeUndefined();
  });
});

describe("the retired course blocks (ADR 0068)", () => {
  it("still resolve their Checkpoint and Finish Zone, with a warning naming the replacement", () => {
    const track = [
      { moduleId: "start", position: { x: 0, y: 0, z: 0 }, rotation: 0 },
      { moduleId: "checkpoint-spinner", position: { x: 0, y: 0, z: -6 }, rotation: 0 },
      { moduleId: "finish", position: { x: 0, y: 0, z: -12 }, rotation: 0 },
    ];
    const resolved = resolveTrack(M1_MODULES, track);
    expect(resolved.checkpoints).toHaveLength(1);
    expect(resolved.checkpoints[0]!.trigger).toBeDefined();
    expect(resolved.finishZones[0]!.trigger).toBeDefined();
    expect(resolved.warnings).toEqual([
      expect.stringMatching(/Segment 0 .*"start": mark any Segment as the Start instead/),
      expect.stringMatching(/Segment 1 .*"checkpoint-spinner": switch a hoop or an arch on as a Checkpoint/),
      expect.stringMatching(/Segment 2 .*"finish": place a finish sign instead/),
    ]);
  });
});

describe("the Start (ADR 0068)", () => {
  it("spawns on the Start's deck, facing its forward, the grid turned with it", () => {
    const deck: Module = { ...GROUND, id: "deck", statics: [{ center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 8, y: 0.5, z: 8 } }], footprint: { bounds: { center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 8, y: 0.5, z: 8 } }, clearance: 0.5 } };
    const track: Track = [
      { moduleId: "kaykit_arch_blue", position: { x: 0, y: 0, z: 0 }, rotation: 0 },
      { moduleId: "deck", position: { x: 20, y: 3, z: 0 }, rotation: Math.PI / 2, start: true },
    ];
    const spots = Array.from({ length: 12 }, (_, i) => trackSpawn(track, i, { ...MODULES, deck }));
    for (const spot of spots) {
      expect(spot.y).toBeCloseTo(3 + 1.2, 5);
      // A quarter turn lays the grid's rows along world X, its columns along Z.
      expect(Math.abs(spot.x - 20)).toBeLessThanOrEqual(1.5 + 1e-9);
    }
    expect(new Set(spots.map((s) => `${s.x.toFixed(3)},${s.z.toFixed(3)}`)).size).toBe(12);
    expect(trackSpawnYaw(track)).toBe(-Math.PI / 2); // the camera's own yaw convention
  });

  it("squeezes the grid onto a small Start, never closer than a Player's width", () => {
    const small: Module = { ...GROUND, id: "small", statics: [], footprint: { bounds: { center: { x: 0, y: -0.25, z: 0 }, halfExtents: { x: 1, y: 0.25, z: 1 } }, clearance: 0.5 } };
    const track: Track = [{ moduleId: "small", position: { x: 0, y: 0, z: 0 }, rotation: 0, start: true }];
    const a = trackSpawn(track, 0, { small });
    const b = trackSpawn(track, 1, { small });
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeCloseTo(0.8, 5);
  });

  it("without a Start, spawns on the first Segment exactly as before", () => {
    const track: Track = [{ ...ground, position: { x: 5, y: 1, z: 2 } }];
    expect(trackSpawn(track, 0, MODULES)).toEqual(trackSpawn(track, 0));
    expect(trackSpawnYaw(track)).toBeUndefined();
  });
});

describe("passing through Gates in the simulation (ADR 0068)", () => {
  const walk = (sim: RapierSimulation, id: string, direction: { x: number; z: number }, seconds: number, each?: () => void): void => {
    for (let n = 0; n < seconds * TICK_RATE_HZ; n += 1) {
      sim.tick({ [id]: { ...IDLE_INPUTS, moveDirection: { x: direction.x, y: 0, z: direction.z } } });
      each?.();
    }
  };
  const archAt = (z: number, order: number) => ({ moduleId: "kaykit_arch_blue", position: { x: 0, y: 0, z }, rotation: 0, checkpoint: { order } });
  const simFor = (track: Track, start: { x: number; z: number }) => {
    const sim = new RapierSimulation({ ...resolveTrack(MODULES, track), withDefaultCharacter: false, killPlaneY: -4 });
    sim.addCharacter("me", { x: start.x, y: CAPSULE_BOTTOM_OFFSET + 0.1, z: start.z });
    return sim;
  };
  const me = (sim: RapierSimulation) => sim.snapshot().characters.me!;

  it("counts walking under a Checkpoint arch, and a Fall afterwards respawns just in front of it", () => {
    const track = [ground, archAt(0, 1)];
    const sim = simFor(track, { x: 0, z: 3 });
    const spot = resolveTrack(MODULES, track).checkpoints[0]!.respawn;
    walk(sim, "me", { x: 0, z: -1 }, 2);
    expect(me(sim).checkpointIndex).toBe(0);
    // Off the far end, into the drop.
    let respawned = false;
    walk(sim, "me", { x: 0, z: -1 }, 12, () => {
      const p = me(sim).position;
      if (!respawned && me(sim).fallCount > 0 && Math.hypot(p.x - spot.x, p.z - spot.z) < 1 && p.y > -1) respawned = true;
    });
    expect(me(sim).fallCount).toBeGreaterThan(0);
    expect(respawned, "respawned at the arch").toBe(true);
    sim.dispose();
  });

  it("never counts walking past beside it", () => {
    const sim = simFor([ground, archAt(0, 1)], { x: 4, z: 3 });
    walk(sim, "me", { x: 0, z: -1 }, 2);
    expect(me(sim).position.z).toBeLessThan(-3);
    expect(me(sim).checkpointIndex).toBeNull();
    sim.dispose();
  });

  it("counts either way through, and only a higher number moves the Respawn", () => {
    const sim = simFor([ground, archAt(0, 1), archAt(-6, 2)], { x: 0, z: -9 });
    walk(sim, "me", { x: 0, z: 1 }, 1.5); // backwards through 2
    expect(me(sim).checkpointIndex).toBe(1);
    walk(sim, "me", { x: 0, z: 1 }, 2); // on through 1
    expect(me(sim).position.z).toBeGreaterThan(1);
    expect(me(sim).checkpointIndex).toBe(1);
    sim.dispose();
  });

  it("Qualifies passing under a finish sign, not standing in front of it", () => {
    const sim = simFor([ground, { moduleId: "kaykit_signage_finish", position: { x: 0, y: 0, z: 0 }, rotation: 0 }], { x: 0, z: 3 });
    walk(sim, "me", { x: 0, z: -1 }, 0.3);
    expect(me(sim).finishTick).toBeNull();
    walk(sim, "me", { x: 0, z: -1 }, 2);
    expect(me(sim).finishTick).not.toBeNull();
    sim.dispose();
  });
});
