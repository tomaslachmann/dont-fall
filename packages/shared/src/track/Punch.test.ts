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
import { DF_MODULE_DEFS, PUNCH_CYCLE, PUNCH_PERIOD_SECONDS, PUNCH_RATE } from "./dfAssetDefs.js";
import type { Module } from "./Module.js";
import { invalidPunchReason, punchCycleOf, punchLanded, punchPose, punchReachAt, punchScaleAt, punchSeconds } from "./Punch.js";
import { resolveTrack } from "./resolveTrack.js";
import type { Segment } from "./Track.js";

const assets = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "assets");

const gloveModule = (): Module => {
  const def = DF_MODULE_DEFS.find((entry) => entry.id === "punching_glove")!;
  return attachAssetGeometry(
    def,
    loadAssetModule(new Uint8Array(readFileSync(join(assets, "punching_glove.glb"))), { footprint: def.footprint.bounds }),
  );
};

const place = (extra: Partial<Segment> = {}): Segment => ({
  moduleId: "punching_glove",
  position: { x: 0, y: 0, z: 0 },
  rotation: 0,
  ...extra,
});

const ticksOf = (seconds: number): number => seconds / TICK_DT;

describe("a punching glove's swing (ADR 0121)", () => {
  it("replays the authored curve, at the speed the def asks for", () => {
    // The clip's own samples, read by `pnpm convert:df` — played `rate` times
    // faster, so sample n lands at n·step/rate.
    for (const [i, reach] of PUNCH_CYCLE.reach.entries()) {
      expect(punchReachAt(PUNCH_CYCLE, ticksOf((i * PUNCH_CYCLE.step) / PUNCH_RATE)), `sample ${i}`).toBeCloseTo(reach, 3);
    }
    expect(punchSeconds(PUNCH_CYCLE)).toBeCloseTo((PUNCH_CYCLE.reach.length - 1) * PUNCH_CYCLE.step / PUNCH_RATE, 5);
  });

  it("is a fist out front, and nothing at all in between", () => {
    // At rest there is no glove: the authored scale is 0.001, and nothing
    // that small is something to be hit by.
    expect(punchScaleAt(PUNCH_CYCLE, 0, "glove")).toBeLessThan(0.01);
    expect(punchLanded(PUNCH_CYCLE, 0)).toBe(false);
    expect(punchReachAt(PUNCH_CYCLE, 0)).toBe(0);

    // Mid-punch it is full size and out front.
    const out = ticksOf(0.6 / PUNCH_RATE);
    expect(punchLanded(PUNCH_CYCLE, out)).toBe(true);
    expect(punchReachAt(PUNCH_CYCLE, out)).toBeGreaterThan(1.5);

    // …and it is gone again well before the cycle comes round.
    expect(punchLanded(PUNCH_CYCLE, ticksOf(PUNCH_PERIOD_SECONDS - 0.1))).toBe(false);
  });

  it("crosses its reach fast enough for the ordinary rule to knock down", () => {
    // Measured on the curve itself: at the authored speed the fist does about
    // 4.6 u/s, which ADR 0037's gate reads as a shove; the point of `rate` is
    // to clear the 15 that knocks down (ADR 0121).
    const fastest = (rate: number): number => {
      const cycle = { ...PUNCH_CYCLE, rate };
      let most = 0;
      for (let tick = 0; tick < ticksOf(punchSeconds(cycle)); tick += 1) {
        most = Math.max(most, Math.abs(punchReachAt(cycle, tick + 1) - punchReachAt(cycle, tick)) / TICK_DT);
      }
      return most;
    };

    expect(fastest(1)).toBeLessThan(15);
    expect(fastest(PUNCH_RATE)).toBeGreaterThan(15);
  });

  it("grows each piece about its own place, so nothing slides as it swells", () => {
    const out = ticksOf(0.6 / PUNCH_RATE);
    const bellows = punchPose(PUNCH_CYCLE, out, "bellows");

    // The bellows stretches along Z alone and stays anchored where it is
    // bolted: its pivot maps to itself however far it is stretched.
    expect(bellows.scale.x).toBe(1);
    expect(bellows.scale.z).toBeGreaterThan(1);
    const pivot = PUNCH_CYCLE.pivots.bellows;
    expect(bellows.position.z + pivot.z * bellows.scale.z).toBeCloseTo(pivot.z, 6);
  });

  it("carries its author's timing, never the shape of the swing", () => {
    const retuned = punchCycleOf(PUNCH_CYCLE, { period: 8, phase: 0.5, rate: 1 });

    expect(retuned.period).toBe(8);
    expect(retuned.rate).toBe(1);
    expect(retuned.reach).toBe(PUNCH_CYCLE.reach);
    // A period shorter than the punch itself is floored, not refused: how
    // long the punch takes is the Asset's.
    expect(punchCycleOf(PUNCH_CYCLE, { period: 0.1 }).period).toBeCloseTo(punchSeconds(PUNCH_CYCLE), 5);
  });

  it("refuses a timing that is not one, at publish", () => {
    expect(invalidPunchReason({ period: 4, phase: 0.5, rate: 2 })).toBeUndefined();
    expect(invalidPunchReason({ period: 0 })).toMatch(/period/);
    expect(invalidPunchReason({ rate: -1 })).toMatch(/rate/);
    expect(invalidPunchReason({ reach: 3 })).toMatch(/no "reach"/);
    expect(invalidAttachmentReason({ punch: { phase: 1 } })).toMatch(/phase/);
  });
});

describe("a placed punching glove", () => {
  it("resolves into a still box and three pieces on one curve", () => {
    const resolved = resolveTrack({ punching_glove: gloveModule() }, [place()]);

    expect(resolved.movingSegments.map((body) => body.part)).toEqual(["glove", "bellows", "button"]);
    for (const body of resolved.movingSegments) expect(body.punch).toBeDefined();
    // Only the fist has anything to collide as; the rest are drawn.
    expect(resolved.movingSegments[0]!.solids.length).toBeGreaterThan(0);
    expect(resolved.movingSegments[1]!.solids).toEqual([]);
    expect(resolved.staticTrimeshes.length).toBeGreaterThan(0);
  });

  it("takes its author's timing onto every piece", () => {
    const resolved = resolveTrack({ punching_glove: gloveModule() }, [place({ punch: { period: 9, rate: 1 } })]);

    for (const body of resolved.movingSegments) {
      expect(body.punch!.cycle.period).toBe(9);
      expect(body.punch!.cycle.rate).toBe(1);
    }
  });
});

describe("standing in front of one", () => {
  const GROUND: Module = {
    id: "ground",
    statics: [{ center: { x: 0, y: -0.5, z: 3 }, halfExtents: { x: 4, y: 0.5, z: 6 } }],
    sockets: [],
    footprint: { bounds: { center: { x: 0, y: -0.5, z: 3 }, halfExtents: { x: 4, y: 0.5, z: 6 } }, clearance: 0.5 },
  };

  beforeAll(async () => {
    await initPhysics();
  });

  const world = (extra: Partial<Segment> = {}) => {
    const resolved = resolveTrack({ punching_glove: gloveModule(), ground: GROUND }, [
      { moduleId: "ground", position: { x: 0, y: 0, z: 0 }, rotation: 0 },
      place(extra),
    ]);
    const sim = new RapierSimulation({ ...resolved, withDefaultCharacter: false });
    // In the fist's way, a metre and a half out from the plate.
    sim.addCharacter("me", { x: 0, y: CAPSULE_BOTTOM_OFFSET + 0.05, z: 1.8 });
    const me = () => sim.snapshot().characters.me!;
    const run = (seconds: number, until?: () => boolean): void => {
      for (let n = 0; n < Math.round(seconds * TICK_RATE_HZ); n += 1) {
        sim.tick({});
        if (until?.()) return;
      }
    };
    return { sim, run, me };
  };

  it("knocks down what it reaches", () => {
    const { sim, run, me } = world();
    let down = false;
    run(PUNCH_PERIOD_SECONDS + 1, () => (down ||= me().motionState === "Ragdoll"));

    expect(down).toBe(true);
    sim.dispose();
  });

  it("leaves alone whoever is standing where there is no glove", () => {
    // The same cannon-sized box, at the authored speed: the fist is doing
    // 4.6 u/s, which is a shove and not a knockdown (ADR 0037's gate).
    const { sim, run, me } = world({ punch: { period: PUNCH_PERIOD_SECONDS, rate: 1 } });
    let down = false;
    run(PUNCH_PERIOD_SECONDS + 2, () => (down ||= me().motionState === "Ragdoll"));

    expect(down).toBe(false);
    sim.dispose();
  });
});
