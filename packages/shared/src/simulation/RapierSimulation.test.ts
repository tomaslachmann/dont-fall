import { beforeAll, describe, expect, it } from "vitest";
import { CAPSULE_BOTTOM_OFFSET, TICK_RATE_HZ, WALK_SPEED } from "../tuning.js";
import { RapierSimulation, initPhysics, type StaticBox } from "./RapierSimulation.js";
import { IDLE_INPUTS, type SimInputs } from "./SimInputs.js";

beforeAll(async () => {
  await initPhysics();
});

const GROUND: StaticBox = { center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 20, y: 0.5, z: 20 } };
/** A little above the ground surface — characters always drop in, never spawn flush. */
const RESTING_SPAWN = { x: 0, y: CAPSULE_BOTTOM_OFFSET + 0.1, z: 0 };

const tick = (sim: RapierSimulation, seconds: number, input: SimInputs = IDLE_INPUTS) => {
  for (let i = 0; i < Math.round(seconds * TICK_RATE_HZ); i += 1) sim.tick(input);
};

const bottomOf = (sim: RapierSimulation) =>
  sim.snapshot().character.position.y - CAPSULE_BOTTOM_OFFSET;

describe("RapierSimulation", () => {
  it("drops the character under gravity onto the ground", () => {
    const sim = new RapierSimulation({ spawn: { x: 0, y: 4, z: 0 }, statics: [GROUND] });

    tick(sim, 3);

    expect(bottomOf(sim)).toBeCloseTo(0, 1); // rests on the ground surface at y = 0
    expect(sim.snapshot().character.grounded).toBe(true);
  });

  it("keeps the character on the ground once it has settled", () => {
    const sim = new RapierSimulation({ spawn: RESTING_SPAWN, statics: [GROUND] });

    tick(sim, 2);

    expect(bottomOf(sim)).toBeGreaterThan(-0.05);
    expect(bottomOf(sim)).toBeLessThan(0.15);
  });

  it("walks the character in the commanded direction at roughly WALK_SPEED", () => {
    const sim = new RapierSimulation({ spawn: RESTING_SPAWN, statics: [GROUND] });
    tick(sim, 0.5); // settle onto the ground

    const before = sim.snapshot().character.position;
    tick(sim, 1, { moveDirection: { x: 0, y: 0, z: -1 } }); // one second north
    const after = sim.snapshot().character.position;

    expect(after.z - before.z).toBeCloseTo(-WALK_SPEED, 0); // ~ -6 over 1s, within 0.5
    expect(after.x - before.x).toBeCloseTo(0, 1);
  });

  it("stops the character at a wall instead of passing through it", () => {
    const wall: StaticBox = { center: { x: 3, y: 1, z: 0 }, halfExtents: { x: 0.5, y: 1, z: 5 } };
    const sim = new RapierSimulation({ spawn: RESTING_SPAWN, statics: [GROUND, wall] });

    tick(sim, 2, { moveDirection: { x: 1, y: 0, z: 0 } }); // push east into the wall

    // wall's west face is at x = 2.5; the capsule centre can't get past 2.5 - radius
    expect(sim.snapshot().character.position.x).toBeLessThan(2.5);
  });

  it("advances the tick counter once per tick", () => {
    const sim = new RapierSimulation({ statics: [GROUND] });
    sim.tick(IDLE_INPUTS);
    sim.tick(IDLE_INPUTS);
    expect(sim.snapshot().tick).toBe(2);
  });

  it("exposes its resolved static geometry for the renderer", () => {
    const sim = new RapierSimulation({ statics: [GROUND] });
    expect(sim.getStatics()).toEqual([GROUND]);
  });

  it("only ever reports the Controlled motion state in M1", () => {
    const sim = new RapierSimulation({ spawn: RESTING_SPAWN, statics: [GROUND] });
    tick(sim, 1, { moveDirection: { x: 1, y: 0, z: 0 } });
    expect(sim.snapshot().character.motionState).toBe("Controlled");
  });
});
