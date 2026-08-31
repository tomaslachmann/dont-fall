import { beforeAll, describe, expect, it } from "vitest";
import type { Box } from "../math/box.js";
import {
  CAPSULE_BOTTOM_OFFSET,
  RESPAWN_LOCKOUT_TICKS,
  TICK_RATE_HZ,
  WALK_SPEED,
} from "../tuning.js";
import type { Checkpoint } from "./Checkpoint.js";
import { RapierSimulation, initPhysics } from "./RapierSimulation.js";
import { IDLE_INPUTS, type SimInputs } from "./SimInputs.js";

beforeAll(async () => {
  await initPhysics();
});

const GROUND: Box = { center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 20, y: 0.5, z: 20 } };
const RESTING_SPAWN = { x: 0, y: CAPSULE_BOTTOM_OFFSET + 0.1, z: 0 };
const NORTH: SimInputs = { moveDirection: { x: 0, y: 0, z: -1 } };

const tick = (sim: RapierSimulation, seconds: number, input: SimInputs = IDLE_INPUTS) => {
  for (let i = 0; i < Math.round(seconds * TICK_RATE_HZ); i += 1) sim.tick(input);
};

const tickUntilFall = (sim: RapierSimulation): void => {
  for (let i = 0; i < 300; i += 1) {
    sim.tick(NORTH);
    if (sim.snapshot().character.fallCount >= 1) return;
  }
  throw new Error("character never fell");
};

describe("RapierSimulation — walk", () => {
  it("drops the character under gravity onto the ground", () => {
    const sim = new RapierSimulation({ spawn: { x: 0, y: 4, z: 0 }, statics: [GROUND] });
    tick(sim, 3);
    expect(sim.snapshot().character.position.y - CAPSULE_BOTTOM_OFFSET).toBeCloseTo(0, 1);
    expect(sim.snapshot().character.grounded).toBe(true);
  });

  it("walks the character in the commanded direction at roughly WALK_SPEED", () => {
    const sim = new RapierSimulation({ spawn: RESTING_SPAWN, statics: [GROUND] });
    tick(sim, 0.5);
    const before = sim.snapshot().character.position;
    tick(sim, 1, NORTH);
    const after = sim.snapshot().character.position;
    expect(after.z - before.z).toBeCloseTo(-WALK_SPEED, 0);
    expect(sim.snapshot().character.motionState).toBe("Controlled"); // the only M1 state
  });

  it("stops the character at a wall instead of passing through it", () => {
    const wall: Box = { center: { x: 3, y: 1, z: 0 }, halfExtents: { x: 0.5, y: 1, z: 5 } };
    const sim = new RapierSimulation({ spawn: RESTING_SPAWN, statics: [GROUND, wall] });
    tick(sim, 2, { moveDirection: { x: 1, y: 0, z: 0 } });
    expect(sim.snapshot().character.position.x).toBeLessThan(2.5);
  });

  it("advances the tick counter once per tick", () => {
    const sim = new RapierSimulation({ statics: [GROUND] });
    sim.tick(IDLE_INPUTS);
    sim.tick(IDLE_INPUTS);
    expect(sim.snapshot().tick).toBe(2);
  });

  it("exposes its resolved static geometry and checkpoints for the renderer", () => {
    const cp: Checkpoint = {
      respawn: { x: 1, y: 2, z: 3 },
      volume: { center: { x: 1, y: 2, z: 3 }, halfExtents: { x: 1, y: 1, z: 1 } },
    };
    const sim = new RapierSimulation({ statics: [GROUND], checkpoints: [cp] });
    expect(sim.getStatics()).toEqual([GROUND]);
    expect(sim.getCheckpoints()).toEqual([cp]);
  });
});

describe("RapierSimulation — Fall & Respawn", () => {
  /** A high floating platform with a big void underneath and a kill-plane at y = -8. */
  const PLATFORM: Box = { center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 2, y: 0.5, z: 2 } };
  const config = { spawn: { x: 0, y: 1.5, z: 0 }, statics: [PLATFORM], killPlaneY: -8 };

  const EDGE_SPAWN = { x: 0, y: 1.5, z: 1.8 }; // near the north edge of PLATFORM

  it("respawns at spawn after Falling past the kill-plane", () => {
    const sim = new RapierSimulation({ ...config, spawn: EDGE_SPAWN });
    tick(sim, 0.5); // settle
    tickUntilFall(sim);

    const { character } = sim.snapshot();
    expect(character.fallCount).toBe(1);
    expect(character.position.y).toBeGreaterThan(config.killPlaneY); // out of the void
    expect(character.position.z).toBeCloseTo(EDGE_SPAWN.z, 0); // back near the spawn
    expect(character.checkpointIndex).toBeNull(); // no checkpoint reached
  });

  it("does not move the respawn point backward when walking back through an earlier Checkpoint", () => {
    const near: Checkpoint = {
      respawn: { x: -8, y: 1.5, z: 4 },
      volume: { center: { x: 0, y: 0.5, z: 4 }, halfExtents: { x: 3, y: 2, z: 1.5 } },
    };
    const far: Checkpoint = {
      respawn: { x: 8, y: 1.5, z: -4 },
      volume: { center: { x: 0, y: 0.5, z: -4 }, halfExtents: { x: 3, y: 2, z: 1.5 } },
    };
    const sim = new RapierSimulation({
      spawn: { x: 0, y: 1.5, z: 6 },
      statics: [{ center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 3, y: 0.5, z: 12 } }],
      checkpoints: [near, far],
      killPlaneY: -8,
    });
    tick(sim, 0.5);
    tick(sim, 2.5, NORTH); // walk through `near` then `far`
    expect(sim.snapshot().character.checkpointIndex).toBe(1);

    tick(sim, 2.5, { moveDirection: { x: 0, y: 0, z: 1 } }); // walk back south through `near`
    expect(sim.snapshot().character.checkpointIndex).toBe(1); // still the far one
  });

  it("respawns at the last Checkpoint reached, not spawn", () => {
    const checkpoint: Checkpoint = {
      respawn: { x: 5, y: 1.5, z: 0 },
      volume: { center: { x: 0, y: 0.5, z: 0 }, halfExtents: { x: 2, y: 2, z: 2 } },
    };
    const sim = new RapierSimulation({
      spawn: EDGE_SPAWN,
      statics: [
        PLATFORM,
        { center: { x: 5, y: -0.5, z: 0 }, halfExtents: { x: 1, y: 0.5, z: 1 } }, // checkpoint pad
      ],
      checkpoints: [checkpoint],
      killPlaneY: -8,
    });
    tick(sim, 0.5); // settle inside the checkpoint volume
    expect(sim.snapshot().character.checkpointIndex).toBe(0);

    tickUntilFall(sim);

    expect(sim.snapshot().character.position.x).toBeCloseTo(5, 0); // respawned at the pad
  });

  it("ignores movement input during the post-Respawn lockout", () => {
    const sim = new RapierSimulation({ spawn: EDGE_SPAWN, statics: [PLATFORM], killPlaneY: -8 });
    tick(sim, 0.5);
    tickUntilFall(sim);

    sim.tick(NORTH); // first locked tick
    expect(sim.snapshot().character.respawning).toBe(true);
    const lockedStart = sim.snapshot().character.position;

    for (let i = 0; i < RESPAWN_LOCKOUT_TICKS - 3; i += 1) sim.tick(NORTH);
    const lockedEnd = sim.snapshot().character.position;
    expect(lockedEnd.z).toBeCloseTo(lockedStart.z, 1); // never moved despite the input
    expect(sim.snapshot().character.respawning).toBe(true);

    tick(sim, 1, NORTH); // past the lockout, control returns
    expect(sim.snapshot().character.respawning).toBe(false);
    expect(sim.snapshot().character.position.z).toBeLessThan(lockedEnd.z - 1);
  });

  it("keeps walking at full speed after a Respawn (no character-controller stall)", () => {
    const sim = new RapierSimulation({ spawn: EDGE_SPAWN, statics: [PLATFORM], killPlaneY: -8 });
    tick(sim, 0.5);
    tickUntilFall(sim); // fall #1
    tick(sim, RESPAWN_LOCKOUT_TICKS / TICK_RATE_HZ + 0.2); // wait out the lockout

    const before = sim.snapshot().character.position;
    tick(sim, 0.5, { moveDirection: { x: 1, y: 0, z: 0 } }); // walk toward the east edge
    const travelled = Math.abs(sim.snapshot().character.position.x - before.x);
    expect(travelled).toBeGreaterThan(WALK_SPEED * 0.5 * 0.6); // at least 60% of full speed
  });

  it("flags the teleport only on the tick the Respawn happens", () => {
    const sim = new RapierSimulation({ spawn: EDGE_SPAWN, statics: [PLATFORM], killPlaneY: -8 });
    tick(sim, 0.5);
    expect(sim.snapshot().character.teleported).toBe(false);

    tickUntilFall(sim);
    expect(sim.snapshot().character.teleported).toBe(true); // the fall tick

    sim.tick(NORTH);
    expect(sim.snapshot().character.teleported).toBe(false); // and only that tick
  });
});
