import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { initPhysics, RapierSimulation } from "../simulation/RapierSimulation.js";
import { CAPSULE_BOTTOM_OFFSET } from "../tuning/character.js";
import { TICK_RATE_HZ } from "../tuning/clock.js";
import { loadAssetModule } from "./asset.js";
import { attachAssetGeometry } from "./assetModules.js";
import { beltLoopLength, beltSlatAt, beltSlatPose } from "./BeltPath.js";
import { CONVEYOR_SPEEDS } from "./Conveyor.js";
import { BELT_PATH, BELT_PRESET, DF_MODULE_DEFS } from "./dfAssetDefs.js";
import type { Module } from "./Module.js";
import { resolveTrack } from "./resolveTrack.js";
import type { Segment } from "./Track.js";

const assets = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "assets");

const beltModule = (): Module => {
  const def = DF_MODULE_DEFS.find((entry) => entry.id === "belt")!;
  return attachAssetGeometry(
    def,
    loadAssetModule(new Uint8Array(readFileSync(join(assets, "belt.glb"))), { footprint: def.footprint.bounds }),
  );
};

const place = (extra: Partial<Segment> = {}): Segment => ({
  moduleId: "belt",
  position: { x: 0, y: 0, z: 0 },
  rotation: 0,
  ...extra,
});

describe("the loop a conveyor's slats ride (ADR 0120)", () => {
  it("is exactly the loop the export says it is", () => {
    // The GLB's own extras give `belt_loop_length` 10.913. Four numbers
    // reproduce it, which is what says this is the authored path and not an
    // approximation of it.
    expect(beltLoopLength(BELT_PATH)).toBeCloseTo(10.913, 3);
  });

  it("runs flat along the top, wraps the rollers and comes back underneath", () => {
    const top = beltSlatPose(BELT_PATH, 0.1);
    const bottom = beltSlatPose(BELT_PATH, 0.6);

    expect(top.position.y).toBeCloseTo(BELT_PATH.rollerY + BELT_PATH.radius, 6);
    expect(bottom.position.y).toBeCloseTo(BELT_PATH.rollerY - BELT_PATH.radius, 6);
    // Downstream on top is −Z, the way a Track travels.
    expect(beltSlatPose(BELT_PATH, 0.2).position.z).toBeLessThan(top.position.z);
    // …and back the other way underneath.
    expect(beltSlatPose(BELT_PATH, 0.7).position.z).toBeGreaterThan(bottom.position.z);
    // Never further out than the rollers reach.
    for (let i = 0; i <= 40; i += 1) {
      const at = beltSlatPose(BELT_PATH, i / 40);
      expect(Math.abs(at.position.z)).toBeLessThanOrEqual(BELT_PATH.rollerZ + BELT_PATH.radius + 1e-9);
    }
  });

  it("closes on itself, so a slat never jumps", () => {
    const start = beltSlatPose(BELT_PATH, 0);
    const end = beltSlatPose(BELT_PATH, 1 - 1e-6);

    expect(end.position.z).toBeCloseTo(start.position.z, 3);
    expect(end.position.y).toBeCloseTo(start.position.y, 3);
  });

  it("spaces the slats evenly and carries them at the belt's own speed", () => {
    const speed = CONVEYOR_SPEEDS[BELT_PRESET];
    const first = beltSlatAt(BELT_PATH, 0, speed, 0);
    const second = beltSlatAt(BELT_PATH, 1, speed, 0);
    expect(Math.abs(first.position.z - second.position.z)).toBeCloseTo(beltLoopLength(BELT_PATH) / BELT_PATH.slats, 3);

    // One loop's worth of seconds puts slat 0 back where it started.
    const lap = beltLoopLength(BELT_PATH) / speed;
    expect(beltSlatAt(BELT_PATH, 0, speed, lap).position.z).toBeCloseTo(first.position.z, 3);
    // …and half a lap has it somewhere else entirely.
    expect(beltSlatAt(BELT_PATH, 0, speed, lap / 2).position.y).not.toBeCloseTo(first.position.y, 1);
  });
});

describe("a placed belt (ADR 0120)", () => {
  it("conveys without anyone attaching a Conveyor to it", () => {
    const resolved = resolveTrack({ belt: beltModule() }, [place()]);

    expect(resolved.conveyors).toHaveLength(1);
    expect(resolved.conveyors[0]!.own).toBe(true);
    // Downstream is −Z, at the middle preset.
    expect(resolved.conveyors[0]!.velocity.z).toBeCloseTo(-CONVEYOR_SPEEDS[BELT_PRESET], 5);
  });

  it("stores nothing for it, and takes the author's own Conveyor over its", () => {
    const track = [place({ conveyor: { preset: "fast", angle: Math.PI } })];
    const resolved = resolveTrack({ belt: beltModule() }, track);

    expect(track[0]!.conveyor).toEqual({ preset: "fast", angle: Math.PI });
    expect(resolved.conveyors[0]!.velocity.z).toBeCloseTo(CONVEYOR_SPEEDS.fast, 5);
  });

  it("turns its flow with the Segment", () => {
    const resolved = resolveTrack({ belt: beltModule() }, [place({ rotation: Math.PI / 2 })]);

    expect(resolved.conveyors[0]!.velocity.x).toBeCloseTo(-CONVEYOR_SPEEDS[BELT_PRESET], 5);
    expect(Math.abs(resolved.conveyors[0]!.velocity.z)).toBeLessThan(1e-6);
  });
});

describe("standing on one", () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it("is carried along it, on one flat deck rather than thirty-six ridges", () => {
    const resolved = resolveTrack({ belt: beltModule() }, [place()]);
    const sim = new RapierSimulation({ ...resolved, withDefaultCharacter: false });
    // The deck's top is at y = 1.13.
    sim.addCharacter("me", { x: 0, y: 1.13 + CAPSULE_BOTTOM_OFFSET + 0.05, z: 1.5 });
    const me = () => sim.snapshot().characters.me!;
    for (let n = 0; n < TICK_RATE_HZ; n += 1) sim.tick({});

    expect(me().grounded).toBe(true);
    // Carried downstream, without the ride bouncing it about.
    expect(me().position.z).toBeLessThan(0.5);
    expect(Math.abs(me().position.x)).toBeLessThan(0.2);
    sim.dispose();
  });
});
