import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_CHARACTER_ID,
  IDLE_INPUTS,
  RapierSimulation,
  TICK_RATE_HZ,
  initPhysics,
  pointInOrientedBox,
  type SimInputs,
} from "@dont-fall/shared";
import { shouldAnnounceFinish } from "./practice.js";

const SRC = dirname(fileURLToPath(import.meta.url));

describe("practice never phones the server (m8.1 ticket 01)", () => {
  it("constructs no socket and imports no netcode — a practice session that reaches the server is a bug", () => {
    const source = readFileSync(join(SRC, "practice.ts"), "utf8");

    expect(source).not.toMatch(/\bWebSocket\b/);
    expect(source).not.toMatch(/lib\/connection/);
    expect(source).not.toMatch(/from ["']\.\.\/net\//);
  });
});

describe("shouldAnnounceFinish (m8.1 ticket 02)", () => {
  it("announces exactly once, on the rising edge of being inside a finish zone", () => {
    // Outside, stays outside: silence.
    expect(shouldAnnounceFinish(false, false)).toBe(false);
    // The crossing tick: announce.
    expect(shouldAnnounceFinish(false, true)).toBe(true);
    // Still inside afterwards: no repeat (the author keeps running).
    expect(shouldAnnounceFinish(true, true)).toBe(false);
    // Left and re-entered: announce again (a second crossing is news too).
    expect(shouldAnnounceFinish(true, false)).toBe(false);
  });
});

describe("practice session rules, headless (m8.1 ticket 02)", () => {
  beforeAll(async () => {
    await initPhysics();
  });

  const NORTH: SimInputs = { ...IDLE_INPUTS, moveDirection: { x: 0, y: 0, z: -1 } };

  /**
   * Practice's exact world construction (`practice.ts`): its own
   * authoritative sim, character added at the spawn, no finish zones — the
   * sim never learns the crossing, so it can never lock input or end
   * anything. Every tick below passes `"RUNNING"` for the same reason:
   * nothing here ever leaves the running phase.
   */
  const startPracticeSim = (config: ConstructorParameters<typeof RapierSimulation>[0], spawn: Vec3Like): RapierSimulation => {
    const sim = new RapierSimulation({ ...config, withDefaultCharacter: false, authoritative: true });
    sim.addCharacter(DEFAULT_CHARACTER_ID, spawn);
    return sim;
  };

  it("runs, checkpoints, crosses the finish and keeps moving — with no finishTick, ever", () => {
    const checkpoint = {
      respawn: { x: 0, y: 1.5, z: -4 },
      trigger: { center: { x: 0, y: 0.5, z: -4 }, halfExtents: { x: 2, y: 2, z: 1.5 } },
    };
    const finishTrigger = { center: { x: 0, y: 0.5, z: -12 }, halfExtents: { x: 2, y: 2, z: 1.5 } };
    const sim = startPracticeSim(
      {
        statics: [{ center: { x: 0, y: -0.5, z: -6 }, halfExtents: { x: 3, y: 0.5, z: 12 } }],
        checkpoints: [checkpoint],
        killPlaneY: -8,
      },
      { x: 0, y: 1.5, z: 4 },
    );

    for (let n = 0; n < Math.round(0.5 * TICK_RATE_HZ); n += 1) sim.tick({ [DEFAULT_CHARACTER_ID]: IDLE_INPUTS }, "RUNNING");

    let sawCheckpoint = false;
    let announced = false;
    let finishTick: number | null = null;
    for (let n = 0; n < Math.round(8 * TICK_RATE_HZ); n += 1) {
      sim.tick({ [DEFAULT_CHARACTER_ID]: NORTH }, "RUNNING");
      const c = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!;
      if (c.checkpointIndex === 0) sawCheckpoint = true;
      if (shouldAnnounceFinish(announced, pointInOrientedBox(c.position, finishTrigger))) announced = true;
      finishTick = c.finishTick;
      if (sawCheckpoint && announced) break;
    }
    expect(sawCheckpoint).toBe(true); // ran through the Checkpoint on the way
    expect(announced).toBe(true); // crossed the finish zone and said so

    // The finish reports instead of ending: the sim never set `finishTick`
    // (it holds no finish zones by construction), so input stays live and
    // the author keeps running underneath the toast.
    expect(finishTick).toBeNull();
    const before = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;
    for (let n = 0; n < Math.round(1 * TICK_RATE_HZ); n += 1) sim.tick({ [DEFAULT_CHARACTER_ID]: NORTH }, "RUNNING");
    const after = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(0.5);
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.finishTick).toBeNull();
  });

  it("falls and respawns at the last Checkpoint, not the spawn", () => {
    const sim = startPracticeSim(
      {
        statics: [{ center: { x: 8, y: -0.5, z: 0 }, halfExtents: { x: 3, y: 0.5, z: 3 } }],
        checkpoints: [
          {
            respawn: { x: 8, y: 1.5, z: 0 },
            trigger: { center: { x: 8, y: 0.5, z: 0 }, halfExtents: { x: 2, y: 2, z: 2 } },
          },
        ],
        killPlaneY: -8,
      },
      { x: 8, y: 1.5, z: 0 },
    );

    for (let n = 0; n < Math.round(0.5 * TICK_RATE_HZ); n += 1) sim.tick({ [DEFAULT_CHARACTER_ID]: IDLE_INPUTS }, "RUNNING");
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.checkpointIndex).toBe(0);

    for (let n = 0; n < 300; n += 1) {
      sim.tick({ [DEFAULT_CHARACTER_ID]: NORTH }, "RUNNING");
      if (sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.fallCount >= 1) break;
    }
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.fallCount).toBeGreaterThanOrEqual(1);

    for (let n = 0; n < 400; n += 1) {
      sim.tick({ [DEFAULT_CHARACTER_ID]: IDLE_INPUTS }, "RUNNING");
      if (sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.motionState === "Controlled") break;
    }
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.motionState).toBe("Controlled");
    const at = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;
    expect(Math.abs(at.x - 8)).toBeLessThan(3); // the Checkpoint pad, not the spawn
    expect(Math.abs(at.z - 0)).toBeLessThan(3);
  });

  it("holds no finish zones by construction — the sim cannot lock input on a crossing", () => {
    const source = readFileSync(join(SRC, "practice.ts"), "utf8");
    const start = source.indexOf("new RapierSimulation({");
    const end = source.indexOf("});", start);
    const constructorCall = source.slice(start, end);
    expect(constructorCall).not.toMatch(/finishZones/);
  });
});

type Vec3Like = { x: number; y: number; z: number };
