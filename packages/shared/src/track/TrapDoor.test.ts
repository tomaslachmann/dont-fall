import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { initPhysics, RapierSimulation } from "../simulation/RapierSimulation.js";
import { CAPSULE_BOTTOM_OFFSET } from "../tuning/character.js";
import { TICK_DT, TICK_RATE_HZ } from "../tuning/clock.js";
import { loadAssetModule } from "./asset.js";
import { attachAssetGeometry } from "./assetModules.js";
import { invalidAttachmentReason } from "./Attachment.js";
import { DF_MODULE_DEFS, TRAPDOOR_CURVE, TRAPDOOR_CURVE_STEP, TRAPDOOR_PERIOD_SECONDS } from "./dfAssetDefs.js";
import type { Module } from "./Module.js";
import { resolveTrack } from "./resolveTrack.js";
import type { Segment } from "./Track.js";
import {
  invalidTrapDoorReason,
  trapDoorAngle,
  trapDoorCurveSeconds,
  trapDoorCycleOf,
  trapDoorShut,
  type TrapDoorCycle,
} from "./TrapDoor.js";

const assets = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "assets");

const trapdoorModule = (): Module => {
  const def = DF_MODULE_DEFS.find((entry) => entry.id === "trapdoor")!;
  return attachAssetGeometry(
    def,
    loadAssetModule(new Uint8Array(readFileSync(join(assets, "trapdoor.glb"))), { footprint: def.footprint.bounds }),
  );
};

const leafCycle = (): TrapDoorCycle => {
  const def = DF_MODULE_DEFS.find((entry) => entry.id === "trapdoor")!;
  return def.parts!.find((part) => part.name === "left")!.trapDoor!;
};

const ticksOf = (seconds: number): number => seconds / TICK_DT;

describe("a trap door's clock (ADR 0117)", () => {
  const cycle = leafCycle();

  it("replays the authored curve, sample for sample", () => {
    // Not a re-modelled swing: the clip's own keyframes, at the clip's own
    // step, are what the simulation poses.
    for (const [i, authored] of TRAPDOOR_CURVE.entries()) {
      expect(trapDoorAngle(cycle, ticksOf(i * TRAPDOOR_CURVE_STEP)), `sample ${i}`).toBeCloseTo(authored, 4);
    }
  });

  it("lies shut for the rest of its period, and comes round again", () => {
    const swing = trapDoorCurveSeconds(cycle);
    expect(swing).toBeLessThan(TRAPDOOR_PERIOD_SECONDS);

    expect(trapDoorAngle(cycle, ticksOf(swing + 0.5))).toBe(0);
    expect(trapDoorAngle(cycle, ticksOf(TRAPDOOR_PERIOD_SECONDS - 0.01))).toBe(0);
    // One period on, it is doing exactly what it did.
    expect(trapDoorAngle(cycle, ticksOf(TRAPDOOR_PERIOD_SECONDS + 0.6))).toBeCloseTo(trapDoorAngle(cycle, ticksOf(0.6)), 6);
  });

  it("is a floor while it trembles, and a hole from the moment it falls", () => {
    // The tremble is the telegraph (ADR 0117): the leaf visibly loads up
    // while you can still stand on it.
    expect(trapDoorShut(cycle, 0)).toBe(true);
    expect(trapDoorShut(cycle, ticksOf(0.4))).toBe(true);
    expect(trapDoorAngle(cycle, ticksOf(0.4))).toBeLessThan(0);

    expect(trapDoorShut(cycle, ticksOf(0.6))).toBe(false);
    expect(trapDoorShut(cycle, ticksOf(1.2))).toBe(false);
    // …and a floor again only once it is all the way back.
    expect(trapDoorShut(cycle, ticksOf(2.1))).toBe(false);
    expect(trapDoorShut(cycle, ticksOf(trapDoorCurveSeconds(cycle)))).toBe(true);
  });

  it("carries its author's period and phase, never the shape of the swing", () => {
    const retuned = trapDoorCycleOf(cycle, { period: 8, phase: 0.5 });

    expect(retuned.period).toBe(8);
    expect(retuned.phase).toBe(0.5);
    expect(retuned.curve).toBe(cycle.curve);
    // Half a cycle ahead: it is falling when the unphased leaf is shut.
    expect(trapDoorShut(retuned, ticksOf(4.6))).toBe(false);
    expect(trapDoorShut({ ...retuned, phase: 0 }, ticksOf(4.6))).toBe(true);
  });

  it("floors a period too short to fit the swing, rather than cutting the leaf off mid-fall", () => {
    const swing = trapDoorCurveSeconds(cycle);
    const squeezed = trapDoorCycleOf(cycle, { period: 1 });

    expect(squeezed.period).toBeCloseTo(swing, 6);
    // …so the swing still runs whole: it is open in the middle of it.
    expect(trapDoorShut(squeezed, ticksOf(1.2))).toBe(false);
  });

  it("refuses a timing that is not one, at publish", () => {
    expect(invalidTrapDoorReason({ period: 8 })).toBeUndefined();
    expect(invalidTrapDoorReason({ period: 0 })).toMatch(/positive/);
    expect(invalidTrapDoorReason({ phase: 1 })).toMatch(/phase/);
    expect(invalidTrapDoorReason({ hold: 2 })).toMatch(/no "hold"/);
    expect(invalidTrapDoorReason(true)).toMatch(/object/);
    // …and through the Attachment registry the publish path actually reads.
    expect(invalidAttachmentReason({ trapdoor: { period: -1 } })).toMatch(/positive/);
    expect(invalidAttachmentReason({ trapdoor: { period: 6, phase: 0.25 } })).toBeUndefined();
  });
});

describe("a placed trap door", () => {
  const at = (extra: Partial<Segment> = {}): Segment => ({
    moduleId: "trapdoor",
    position: { x: 0, y: 0, z: 0 },
    rotation: 0,
    ...extra,
  });

  it("resolves into a still frame and two leaves on their own clocks", () => {
    const resolved = resolveTrack({ trapdoor: trapdoorModule() }, [at()]);

    expect(resolved.movingSegments.map((body) => body.part)).toEqual(["left", "right"]);
    for (const leaf of resolved.movingSegments) {
      expect(leaf.trapDoor).toBeDefined();
      expect(leaf.motion).toEqual({});
      expect(leaf.solids.length).toBeGreaterThan(0);
    }
    // The frame stands still throughout, so the piece always reads as a doorway.
    expect(resolved.staticTrimeshes.length).toBeGreaterThan(0);
  });

  it("takes its author's timing onto both leaves", () => {
    const resolved = resolveTrack({ trapdoor: trapdoorModule() }, [at({ trapdoor: { period: 9 } })]);

    expect(resolved.movingSegments.map((leaf) => leaf.trapDoor!.period)).toEqual([9, 9]);
  });
});

describe("standing on one", () => {
  const GROUND: Module = {
    id: "ledge",
    statics: [{ center: { x: -4, y: -0.25, z: 0 }, halfExtents: { x: 1, y: 0.25, z: 2 } }],
    sockets: [],
    footprint: { bounds: { center: { x: -4, y: -0.25, z: 0 }, halfExtents: { x: 1, y: 0.25, z: 2 } }, clearance: 0.5 },
  };

  beforeAll(async () => {
    await initPhysics();
  });

  /** Stood on the left leaf, a metre in from its hinge. */
  const world = (timing?: { period?: number; phase?: number }) => {
    const resolved = resolveTrack({ trapdoor: trapdoorModule(), ledge: GROUND }, [
      { moduleId: "ledge", position: { x: 0, y: 0, z: 0 }, rotation: 0 },
      { moduleId: "trapdoor", position: { x: 0, y: 0, z: 0 }, rotation: 0, ...(timing === undefined ? {} : { trapdoor: timing }) },
    ]);
    const sim = new RapierSimulation({ ...resolved, withDefaultCharacter: false });
    // The leaf's top face is at y = 0.553.
    sim.addCharacter("me", { x: -1.2, y: 0.553 + CAPSULE_BOTTOM_OFFSET + 0.05, z: 0 });
    const run = (seconds: number): void => {
      for (let n = 0; n < Math.round(seconds * TICK_RATE_HZ); n += 1) sim.tick({});
    };
    return { sim, run, me: () => sim.snapshot().characters.me! };
  };

  it("holds a Character up while the leaf trembles, and drops it straight down when the leaf falls", () => {
    const { sim, run, me } = world();
    // Settle, then through the tremble: still standing, and tipped a little
    // by it — the tell is felt as well as seen.
    run(0.4);
    const onTheTell = me().position;
    expect(me().grounded).toBe(true);

    // Past the tremble the floor is gone. It falls where it stood: a leaf
    // swinging its far edge down at ~9 u/s carries nobody (ADR 0117), so
    // there is no fling along the arc — only the few centimetres the tremble
    // itself had already tipped it by (measured: 0.07 m over the whole fall,
    // against the 2 m the swing used to throw it before `solidAt`).
    run(0.4);
    expect(me().position.y).toBeLessThan(onTheTell.y - 1);
    expect(Math.abs(me().position.x - onTheTell.x)).toBeLessThan(0.12);
    expect(Math.abs(me().position.z - onTheTell.z)).toBeLessThan(0.12);
    sim.dispose();
  });

  it("stays a floor for as long as its author's timing says", () => {
    // Half a cycle ahead, so the swing this door would otherwise have run
    // through now happens later: the same 1.2 seconds is solid ground.
    const { sim, run, me } = world({ period: 6, phase: 0.5 });
    run(1.2);

    expect(me().grounded).toBe(true);
    expect(me().position.y).toBeGreaterThan(1);
    sim.dispose();
  });
});
