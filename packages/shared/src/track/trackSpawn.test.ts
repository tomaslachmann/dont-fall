import { beforeAll, describe, expect, it } from "vitest";
import { playgroundSpawn } from "../playground.js";
import { IDLE_INPUTS } from "../simulation/SimInputs.js";
import { RapierSimulation, initPhysics } from "../simulation/RapierSimulation.js";
import { TICK_RATE_HZ } from "../tuning.js";
import { M1_TRACK, MODULE_LIBRARY } from "./modules.js";
import { resolveTrack, trackSpawn } from "./Track.js";
import type { Track } from "./Track.js";

beforeAll(async () => {
  await initPhysics();
});

const shift = (track: Track, dx: number): Track =>
  track.map((s) => ({ ...s, position: { x: s.position.x + dx, y: s.position.y, z: s.position.z } }));

/** Step until grounded or timeout; returns the final snapshot Character. */
const settle = (sim: RapierSimulation, id: string) => {
  for (let n = 0; n < 4 * TICK_RATE_HZ; n += 1) {
    sim.tick({ [id]: IDLE_INPUTS });
    if (sim.snapshot().characters[id]!.grounded) break;
  }
  return sim.snapshot().characters[id]!;
};

describe("trackSpawn", () => {
  it("matches playgroundSpawn exactly on M1 (no behavior change on the M2 path)", () => {
    for (let i = 0; i < 12; i += 1) {
      const a = trackSpawn(M1_TRACK, i);
      const b = playgroundSpawn(i);
      expect(a.x).toBeCloseTo(b.x, 9);
      expect(a.y).toBeCloseTo(b.y, 9);
      expect(a.z).toBeCloseTo(b.z, 9);
    }
  });

  it("follows a rigidly shifted track (free placement)", () => {
    const moved = shift(M1_TRACK, 60);
    const a = trackSpawn(moved, 0);
    const b = playgroundSpawn(0);
    expect(a.x).toBeCloseTo(b.x + 60, 9);
    expect(a.y).toBeCloseTo(b.y, 9);
    expect(a.z).toBeCloseTo(b.z, 9);
  });

  it("stands on the start platform of a shifted track (playtest bug, 2026-09)", () => {
    const moved = shift(M1_TRACK, 60);
    const sim = new RapierSimulation({
      ...resolveTrack(MODULE_LIBRARY, moved),
      withDefaultCharacter: false,
    });
    sim.addCharacter("p", trackSpawn(moved, 0));
    const c = settle(sim, "p");
    expect(c.grounded).toBe(true);
    expect(c.fallCount).toBe(0);
  });

  it("stands on a yaw-rotated start platform", () => {
    const rotated: Track = M1_TRACK.map((s, i) =>
      i === 0 ? { ...s, rotation: Math.PI / 2 } : s,
    );
    const sim = new RapierSimulation({
      ...resolveTrack(MODULE_LIBRARY, rotated),
      withDefaultCharacter: false,
    });
    sim.addCharacter("p", trackSpawn(rotated, 0));
    const c = settle(sim, "p");
    expect(c.grounded).toBe(true);
    expect(c.fallCount).toBe(0);
  });
});
