import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { CAPSULE_BOTTOM_OFFSET } from "../tuning/character.js";
import { initPhysics, RapierSimulation } from "../simulation/RapierSimulation.js";
import { TICK_RATE_HZ } from "../tuning/clock.js";
import { loadAssetModule, readAssetModel } from "./asset.js";
import { hasParts, partFor } from "./AssetPart.js";
import { ASSET_MODULE_DEFS, attachAssetGeometry } from "./assetModules.js";
import { DF_MODULE_DEFS, SWEEPER_3ARMS_SPIN, SWEEPER_ROTOR_SPIN } from "./dfAssetDefs.js";
import type { Module } from "./Module.js";
import { applyMotionPose, type MotionClock, type SegmentMotion } from "./Motion.js";
import { invalidPartMotionsTargetReason } from "./PartMotions.js";
import { movingSegmentPose } from "../simulation/MovingSegment.js";
import { resolveTrack, segmentBodies, segmentMotionOf } from "./resolveTrack.js";
import { findOverlaps, type SegmentOverlap } from "./trackOverlaps.js";
import type { Segment } from "./Track.js";

const assets = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "assets");
const modelOf = (id: string) => readAssetModel(new Uint8Array(readFileSync(join(assets, `${id}.glb`))));

/**
 * The def and the bytes have to agree about Parts (ADR 0116): the converter
 * stamps `part` extras from its own table, and the def names the same Parts
 * with the roles that decide what each one becomes. Neither half can be read
 * off the other at runtime, so this is where they meet.
 */
describe("an Asset's Parts", () => {
  const parted = ASSET_MODULE_DEFS.filter((def) => hasParts(def.parts));

  it("is declared by the DF traps that are built from more than one body, and nothing else", () => {
    // A DF Asset that is one rigid piece (the belt) declares none, and no
    // Asset outside the pack declares any.
    expect(parted.map((def) => def.id)).toEqual(DF_MODULE_DEFS.filter((def) => hasParts(def.parts)).map((def) => def.id));
  });

  it.each(parted.map((def) => def.id))("%s: every stamped Part is a declared one", (id) => {
    const def = ASSET_MODULE_DEFS.find((entry) => entry.id === id)!;
    const declared = new Set(def.parts!.map((part) => part.name));
    const stamped = new Set(
      [...modelOf(id).collision, ...modelOf(id).visual].flatMap((mesh) => (mesh.part === undefined ? [] : [mesh.part])),
    );

    expect([...stamped].filter((name) => !declared.has(name))).toEqual([]);
  });

  it.each(parted.map((def) => def.id))("%s: every declared Part has geometry, and every mesh names one", (id) => {
    const def = ASSET_MODULE_DEFS.find((entry) => entry.id === id)!;
    const model = modelOf(id);
    const meshes = [...model.collision, ...model.visual];

    // A Part nothing is stamped with is a renamed node in Blender the
    // converter no longer finds — the failure this whole table guards.
    for (const part of def.parts!) {
      expect(meshes.some((mesh) => mesh.part === part.name), `${id}: part "${part.name}"`).toBe(true);
    }
    expect(meshes.filter((mesh) => mesh.part === undefined)).toEqual([]);
  });

  it.each(parted.map((def) => def.id))("%s: a Part that can be touched has solid shapes of its own", (id) => {
    const def = ASSET_MODULE_DEFS.find((entry) => entry.id === id)!;
    const model = modelOf(id);

    // A Part that moves needs them (a hollow trimesh on a body that moves
    // traps whatever gets inside it, ADR 0065); a still Part gets them too,
    // because a still Asset is still one an author may make a Prop. Which of
    // the two a Part actually collides as at rest is `resolveTrack`'s answer,
    // not the file's. A Part with no collision at all is one that is only
    // ever drawn — a glove's bellows (ADR 0121) — and it has no solids either.
    for (const part of def.parts!) {
      const collides = model.collision.some((mesh) => mesh.part === part.name);
      const solids = model.solid.some((shape) => shape.part === part.name);
      expect(solids, `${id}: part "${part.name}"`).toBe(collides);
    }
    expect(model.solid.filter((shape) => shape.part === undefined)).toEqual([]);
  });

  it("gives the sweeper's rotor the spin its clip was authored with", () => {
    const rotor = partFor(DF_MODULE_DEFS.find((def) => def.id === "sweeper_2arms")!.parts!, "rotor")!;

    expect(rotor.role).toBe("moving");
    // 5.04 s per turn, read off the clip by `pnpm convert:df`.
    expect(rotor.motion?.spin?.speed).toBeCloseTo((2 * Math.PI) / 5.04, 2);
  });

  it("answers for geometry that names no Part with the Asset's still Part", () => {
    const parts = [
      { name: "rotor", role: "moving" as const },
      { name: "base", role: "still" as const },
    ];

    expect(partFor(parts, undefined)?.name).toBe("base");
    expect(partFor(parts, "rotor")?.name).toBe("rotor");
    expect(partFor(parts, "nothing")).toBeUndefined();
    expect(hasParts([])).toBe(false);
    expect(hasParts(undefined)).toBe(false);
  });
});

describe("a Segment with Parts resolves into one body per Part (ADR 0116)", () => {
  const library = (): Record<string, Module> => {
    const bytes = (id: string) => new Uint8Array(readFileSync(join(assets, `${id}.glb`)));
    const entries: Record<string, Module> = {};
    for (const def of DF_MODULE_DEFS) {
      entries[def.id] = attachAssetGeometry(def, loadAssetModule(bytes(def.id), { footprint: def.footprint.bounds }));
    }
    return entries;
  };

  const at = (moduleId: string, extra: Partial<Segment> = {}): Segment => ({
    moduleId,
    position: { x: 0, y: 0, z: 0 },
    rotation: 0,
    ...extra,
  });

  it("gives the sweeper a still base and a turning rotor, from one placed Segment", () => {
    const resolved = resolveTrack(library(), [at("sweeper_2arms")]);

    expect(resolved.movingSegments).toHaveLength(1);
    expect(resolved.movingSegments[0]!.part).toBe("rotor");
    expect(resolved.movingSegments[0]!.motion.spin?.speed).toBeCloseTo(SWEEPER_ROTOR_SPIN, 3);
    // The base is baked into the world like any still Asset, and the rotor is
    // not — a body's collision is in exactly one of the two places.
    expect(resolved.staticTrimeshes.length).toBeGreaterThan(0);
    expect(resolved.movingSegments[0]!.solids.length).toBeGreaterThan(0);
    expect(resolved.warnings).toEqual([]);
  });

  it("splits the Asset's collision between them, with nothing counted twice", () => {
    const modules = library();
    const resolved = resolveTrack(modules, [at("sweeper_2arms")]);
    const asset = modules["sweeper_2arms"]!.asset!;

    const rotorMeshes = asset.meshes.filter((mesh) => mesh.part === "rotor").length;
    expect(resolved.staticTrimeshes).toHaveLength(asset.meshes.length - rotorMeshes);
    expect(resolved.movingSegments[0]!.solids).toHaveLength(asset.solid!.filter((part) => part.part === "rotor").length);
  });

  it("lets the author's own Motion replace the rotor's authored one", () => {
    const motion = { spin: { axis: { x: 0, y: 1, z: 0 }, pivot: { x: 0, y: 0, z: 0 }, speed: 4 } };
    const resolved = resolveTrack(library(), [at("sweeper_2arms", { motion })]);

    expect(resolved.movingSegments).toHaveLength(1);
    expect(resolved.movingSegments[0]!.motion.spin?.speed).toBe(4);
    // The base still does not move: a Motion addresses the Parts that move.
    expect(resolved.staticTrimeshes.length).toBeGreaterThan(0);
  });

  it("gives the three-arm sweeper a still tower and three rotors, each on its own clip's rate and direction", () => {
    const resolved = resolveTrack(library(), [at("sweeper_3arms")]);

    expect(resolved.movingSegments.map((body) => body.part)).toEqual(["low", "mid", "high"]);
    expect(resolved.movingSegments.map((body) => body.motion.spin?.speed)).toEqual([
      SWEEPER_3ARMS_SPIN.low,
      SWEEPER_3ARMS_SPIN.mid,
      SWEEPER_3ARMS_SPIN.high,
    ]);
    expect(resolved.staticTrimeshes.length).toBeGreaterThan(0);
    expect(resolved.warnings).toEqual([]);
  });

  it("starts each arm where its clip starts, and turns it by its own rate", () => {
    // Rested along ±X so the Asset balances on its pivot; the clips start at
    // 15°, 140° and −100° about +Y, and no two arms line up.
    const resolved = resolveTrack(library(), [at("sweeper_3arms")]);
    const tips = { low: { x: 5, y: 0.89, z: 0 }, mid: { x: -5, y: 1.51, z: 0 }, high: { x: 5, y: 2.13, z: 0 } };
    const yaw = (body: (typeof resolved.movingSegments)[number], tick: number): number => {
      const tip = applyMotionPose(movingSegmentPose(body, tick), tips[body.part as keyof typeof tips]);
      return (Math.atan2(-tip.z, tip.x) * 180) / Math.PI;
    };
    const [low, mid, high] = resolved.movingSegments;

    expect(yaw(low!, 0)).toBeCloseTo(15, 3);
    expect(yaw(mid!, 0)).toBeCloseTo(140, 3);
    expect(yaw(high!, 0)).toBeCloseTo(-100, 3);
    // A quarter of a second later: −9°, +18° and −36° on.
    const quarter = TICK_RATE_HZ / 4;
    expect(yaw(low!, quarter)).toBeCloseTo(6, 3);
    expect(yaw(mid!, quarter)).toBeCloseTo(158, 3);
    expect(yaw(high!, quarter)).toBeCloseTo(-136, 3);
  });

  it("retunes one arm through partMotions and leaves the other two as their Asset runs them (ADR 0124)", () => {
    const own = { spin: { axis: { x: 0, y: 1, z: 0 }, pivot: { x: 0, y: 0, z: 0 }, speed: 3 }, ramp: { multiplier: 2, seconds: 30 } };
    const segment = at("sweeper_3arms", { partMotions: { mid: own } });
    const resolved = resolveTrack(library(), [segment]);

    expect(resolved.movingSegments.map((body) => body.motion)).toEqual([
      library()["sweeper_3arms"]!.parts![1]!.motion,
      own,
      library()["sweeper_3arms"]!.parts![3]!.motion,
    ]);
    expect(segmentMotionOf(segment, library()["sweeper_3arms"]!, "mid")).toEqual(own);
    expect(segmentMotionOf(segment, library()["sweeper_3arms"]!, "low")?.spin?.speed).toBe(SWEEPER_3ARMS_SPIN.low);
  });

  it("puts a Part's own Motion above the Segment's, and the Segment's above the Asset's", () => {
    const whole = { spin: { axis: { x: 0, y: 1, z: 0 }, pivot: { x: 0, y: 0, z: 0 }, speed: 1 } };
    const own = { spin: { axis: { x: 0, y: 1, z: 0 }, pivot: { x: 0, y: 0, z: 0 }, speed: -2 } };
    const resolved = resolveTrack(library(), [at("sweeper_3arms", { motion: whole, partMotions: { high: own } })]);

    expect(resolved.movingSegments.map((body) => body.motion)).toEqual([whole, whole, own]);
  });

  it("refuses at publish a partMotions entry naming no moving Part", () => {
    const spin = { spin: { axis: { x: 0, y: 1, z: 0 }, pivot: { x: 0, y: 0, z: 0 }, speed: 1 } };
    const modules = library();

    expect(invalidPartMotionsTargetReason([at("sweeper_3arms", { partMotions: { mid: spin } })], modules)).toBeUndefined();
    expect(invalidPartMotionsTargetReason([at("sweeper_3arms", { partMotions: { tower: spin } })], modules)).toMatch(
      /track\[0\]\.partMotions\.tower names no moving Part of "sweeper_3arms" — its moving Parts are low, mid, high/,
    );
    // A Shooter's aiming Parts are its own sweep's (ADR 0119), not a Motion's.
    expect(invalidPartMotionsTargetReason([at("shooter", { partMotions: { barrel: spin } })], modules)).toMatch(/no moving Parts/);
  });

  it("poses a nested Part under the one it hangs from", () => {
    // The shooter's barrel pitches inside a carriage that is itself turning
    // (ADR 0116): its body carries the carriage's Motion as well as its own,
    // so it is drawn and collided where the model has it.
    const resolved = resolveTrack(library(), [at("shooter")]);

    expect(resolved.movingSegments.map((body) => body.part)).toEqual(["carriage", "barrel"]);
    expect(resolved.movingSegments[0]!.under).toBeUndefined();
    expect(resolved.movingSegments[1]!.under).toHaveLength(1);
    expect(resolved.movingSegments[1]!.under![0]).toEqual(resolved.movingSegments[0]!.motion);
  });

  it("moves the whole piece when an Asset with no moving Part is given a Motion", () => {
    const motion = { spin: { axis: { x: 0, y: 1, z: 0 }, pivot: { x: 0, y: 0, z: 0 }, speed: 1 } };
    const resolved = resolveTrack(library(), [at("fragile_block", { motion })]);

    expect(resolved.movingSegments).toHaveLength(1);
    expect(resolved.movingSegments[0]!.part).toBeUndefined();
    expect(resolved.movingSegments[0]!.motion).toEqual(motion);
    expect(resolved.staticTrimeshes).toEqual([]);
  });

  it("plans one whole-Segment body for an Asset that declares no Parts", () => {
    const module: Module = { id: "plain", statics: [], sockets: [], footprint: ASSET_MODULE_DEFS[0]!.footprint };

    expect(segmentBodies(at("plain"), module)).toEqual([{ body: "still" }]);
    const motion = { spin: { axis: { x: 0, y: 1, z: 0 }, pivot: { x: 0, y: 0, z: 0 }, speed: 2 } };
    expect(segmentBodies(at("plain", { motion }), module)).toEqual([{ body: "moving", motion }]);
  });
});

describe("the real sweeper turning in a world", () => {
  const GROUND: Module = {
    id: "ground",
    statics: [{ center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 10, y: 0.5, z: 10 } }],
    sockets: [],
    footprint: { bounds: { center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 10, y: 0.5, z: 10 } }, clearance: 0.5 },
  };

  const world = (standAt: { x: number; z: number }, motion?: SegmentMotion) => {
    const def = DF_MODULE_DEFS.find((entry) => entry.id === "sweeper_2arms")!;
    const sweeper = attachAssetGeometry(
      def,
      loadAssetModule(new Uint8Array(readFileSync(join(assets, "sweeper_2arms.glb"))), { footprint: def.footprint.bounds }),
    );
    const resolved = resolveTrack({ sweeper_2arms: sweeper, ground: GROUND }, [
      { moduleId: "ground", position: { x: 0, y: 0, z: 0 }, rotation: 0 },
      { moduleId: "sweeper_2arms", position: { x: 0, y: 0, z: 0 }, rotation: 0, ...(motion === undefined ? {} : { motion }) },
    ]);
    const sim = new RapierSimulation({ ...resolved, withDefaultCharacter: false });
    sim.addCharacter("me", { x: standAt.x, y: CAPSULE_BOTTOM_OFFSET + 0.1, z: standAt.z });
    const run = (seconds: number, until?: () => boolean): void => {
      for (let n = 0; n < seconds * TICK_RATE_HZ; n += 1) {
        sim.tick({});
        if (until?.()) return;
      }
    };
    return { sim, run, me: () => sim.snapshot().characters.me! };
  };

  const spin = (speed: number): SegmentMotion => ({ spin: { axis: { x: 0, y: -1, z: 0 }, pivot: { x: 0, y: 0, z: 0 }, speed } });

  beforeAll(async () => {
    await initPhysics();
  });

  it("carries a Character its arm reaches around with it", () => {
    // Out on the arm, clear of the drum. At the authored 1.246 rad/s the arm
    // is doing 3.2 u/s out here — under MOVING_SEGMENT_STAGGER_SPEED (6.67),
    // so it shoves rather than knocks down, and shoving is a ride round the
    // circle. The speed-gated rule (ADR 0061), not a rule of this Asset's own.
    const { sim, run, me } = world({ x: 0, z: 2.6 });
    const start = me().position;
    let furthest = 0;
    let everDown = false;
    run(6, () => {
      furthest = Math.max(furthest, Math.hypot(me().position.x - start.x, me().position.z - start.z));
      everDown ||= me().motionState !== "Controlled";
      return false;
    });

    expect(everDown).toBe(false);
    // Carried most of the way round the circle it was standing on, rather
    // than left where it started (measured: it reaches the far side, ~5.6 m
    // away, and comes back round within the 6 seconds).
    expect(furthest).toBeGreaterThan(4);
    // …and stayed out on that circle, never dragged into the drum.
    expect(Math.hypot(me().position.x, me().position.z)).toBeGreaterThan(2);
    sim.dispose();
  });

  it("knocks one down once its author turns it up", () => {
    // 6 rad/s puts the same spot at 15.6 u/s, past MOVING_SEGMENT_RAGDOLL_SPEED.
    const { sim, run, me } = world({ x: 0, z: 2.6 }, spin(6));
    let down = false;
    run(6, () => (down ||= me().motionState === "Ragdoll"));

    expect(down).toBe(true);
    sim.dispose();
  });

  it("leaves a Character standing on its base alone — the base is not what turns", () => {
    // On the drum's top plate, inside the arms' reach but under them.
    const { sim, run, me } = world({ x: 0, z: 0 });
    const start = me().position;
    run(6);

    expect(me().motionState).toBe("Controlled");
    expect(Math.hypot(me().position.x - start.x, me().position.z - start.z)).toBeLessThan(0.5);
    sim.dispose();
  });
});

describe("the three-arm sweeper speeding up over a Round (ADR 0123)", () => {
  const GROUND: Module = {
    id: "ground",
    statics: [{ center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 10, y: 0.5, z: 10 } }],
    sockets: [],
    footprint: { bounds: { center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 10, y: 0.5, z: 10 } }, clearance: 0.5 },
  };
  const still = { spin: { axis: { x: 0, y: 1, z: 0 }, pivot: { x: 0, y: 0, z: 0 }, speed: 0, startAngle: 0 } };

  // Only the middle arm turns: the low one stopped along +X, the high one
  // along −X, both well clear of a Character standing 4.5 m out on +Z.
  const knockedDown = (motionClock: MotionClock): boolean => {
    const def = DF_MODULE_DEFS.find((entry) => entry.id === "sweeper_3arms")!;
    const sweeper = attachAssetGeometry(
      def,
      loadAssetModule(new Uint8Array(readFileSync(join(assets, "sweeper_3arms.glb"))), { footprint: def.footprint.bounds }),
    );
    const mid = {
      spin: { axis: { x: 0, y: 1, z: 0 }, pivot: { x: 0, y: 0, z: 0 }, speed: SWEEPER_3ARMS_SPIN.mid },
      ramp: { multiplier: 3, seconds: 0.2 },
    };
    const high = { spin: { ...still.spin, startAngle: Math.PI } };
    const resolved = resolveTrack({ sweeper_3arms: sweeper, ground: GROUND }, [
      { moduleId: "ground", position: { x: 0, y: 0, z: 0 }, rotation: 0 },
      { moduleId: "sweeper_3arms", position: { x: 0, y: 0, z: 0 }, rotation: 0, partMotions: { low: still, mid, high } },
    ]);
    const sim = new RapierSimulation({ ...resolved, withDefaultCharacter: false, motionClock });
    sim.addCharacter("me", { x: 0, y: CAPSULE_BOTTOM_OFFSET + 0.1, z: 4.5 });
    let down = false;
    for (let n = 0; n < 6 * TICK_RATE_HZ && !down; n += 1) {
      sim.tick({});
      down = sim.snapshot().characters.me!.motionState === "Ragdoll";
    }
    sim.dispose();
    return down;
  };

  beforeAll(async () => {
    await initPhysics();
  });

  it("only knocks down once the Round's clock has sped the arm past the Impact threshold", () => {
    // At its own 72°/s the arm does 5.7 u/s out here — under
    // MOVING_SEGMENT_STAGGER_SPEED, so it shoves. Three times that knocks
    // down, and nothing but the Motion Clock differs between the two runs.
    expect(knockedDown(null)).toBe(false);
    expect(knockedDown(0)).toBe(true);
  });
});

describe("what a Part sweeps through (ADR 0106 + 0116)", () => {
  beforeAll(async () => {
    await initPhysics();
  });

  const withBarrierAt = (z: number): SegmentOverlap[] => {
    const modules: Record<string, Module> = {};
    for (const id of ["sweeper_2arms", "kaykit_barrier_1x1x1"]) {
      const def = ASSET_MODULE_DEFS.find((entry) => entry.id === id)!;
      modules[id] = attachAssetGeometry(
        def,
        loadAssetModule(new Uint8Array(readFileSync(join(assets, `${id}.glb`))), { footprint: def.footprint.bounds }),
      );
    }
    return findOverlaps(modules, [
      { moduleId: "sweeper_2arms", position: { x: 0, y: 0, z: 0 }, rotation: 0 },
      { moduleId: "kaykit_barrier_1x1x1", position: { x: 0, y: 0, z }, rotation: 0 },
    ]);
  };

  it("catches what the arms reach on their way round, not just where they rest", () => {
    // The arms lie along ±X at rest, so nothing stands in them at Tick 0 —
    // a check that only posed the Segment's rest would see two pieces apart.
    expect(withBarrierAt(2.5).map((overlap) => [overlap.a, overlap.b])).toEqual([[0, 1]]);
  });

  it("leaves alone what stands outside their reach", () => {
    expect(withBarrierAt(5)).toEqual([]);
  });
});
