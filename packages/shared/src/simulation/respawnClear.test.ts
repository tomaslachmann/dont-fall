import { beforeAll, describe, expect, it } from "vitest";
import { CAPSULE_RADIUS } from "../tuning/character.js";
import { DEFAULT_CHARACTER_ID, RapierSimulation, initPhysics } from "./RapierSimulation.js";
import { IDLE_INPUTS, type SimInputs } from "./SimInputs.js";

beforeAll(async () => {
  await initPhysics();
});

const NORTH: SimInputs = { ...IDLE_INPUTS, moveDirection: { x: 0, y: 0, z: -1 } };
const SPAWN = { x: 0, y: 1, z: 0 };
const STANDER = "stander";

/** A 6 m deck with one Character at its middle, which is also its Respawn point. */
const deck = (): RapierSimulation =>
  new RapierSimulation({
    spawn: SPAWN,
    statics: [{ center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 3, y: 0.5, z: 3 } }],
    killPlaneY: -8,
  });

const ground = (a: { x: number; z: number }, b: { x: number; z: number }): number => Math.hypot(a.x - b.x, a.z - b.z);

describe("a Respawn never lands a Character inside another (found by the M17 Bot suites, 2026-09-24)", () => {
  it("lands beside someone standing on the Respawn point, on the floor, and both can walk away", () => {
    const sim = deck();
    const idle = { [DEFAULT_CHARACTER_ID]: IDLE_INPUTS, [STANDER]: IDLE_INPUTS };
    for (let t = 0; t < 15; t += 1) sim.tick({ [DEFAULT_CHARACTER_ID]: IDLE_INPUTS });
    // Walk off the deck's north edge, and have someone step onto the point once it is free.
    let added = false;
    for (let t = 0; t < 300 && sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.fallCount === 0; t += 1) {
      if (!added && sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position.z < -1.5) {
        sim.addCharacter(STANDER, SPAWN);
        added = true;
      }
      sim.tick(added ? { [DEFAULT_CHARACTER_ID]: NORTH, [STANDER]: IDLE_INPUTS } : { [DEFAULT_CHARACTER_ID]: NORTH });
    }
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.fallCount).toBe(1);
    for (let t = 0; t < 30; t += 1) sim.tick(idle);

    const { characters } = sim.snapshot();
    const back = characters[DEFAULT_CHARACTER_ID]!;
    const stander = characters[STANDER]!;
    expect(ground(back.position, stander.position)).toBeGreaterThanOrEqual(2 * CAPSULE_RADIUS);
    expect(back.position.y).toBeGreaterThan(0); // on the deck, not in the void
    expect(back.fallCount).toBe(1);

    // Neither is locked: each walks a metre in a second.
    const before = { back: { ...back.position }, stander: { ...stander.position } };
    for (let t = 0; t < 30; t += 1) sim.tick({ [DEFAULT_CHARACTER_ID]: { ...IDLE_INPUTS, moveDirection: { x: 1, y: 0, z: 0 } }, [STANDER]: { ...IDLE_INPUTS, moveDirection: { x: -1, y: 0, z: 0 } } });
    const after = sim.snapshot().characters;
    expect(ground(after[DEFAULT_CHARACTER_ID]!.position, before.back)).toBeGreaterThan(1);
    expect(ground(after[STANDER]!.position, before.stander)).toBeGreaterThan(1);
  });

  it("keeps the Checkpoint's own point when nobody is on it", () => {
    const sim = deck();
    for (let t = 0; t < 15; t += 1) sim.tick({ [DEFAULT_CHARACTER_ID]: IDLE_INPUTS });
    for (let t = 0; t < 300 && sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.fallCount === 0; t += 1) sim.tick({ [DEFAULT_CHARACTER_ID]: NORTH });
    sim.tick({ [DEFAULT_CHARACTER_ID]: IDLE_INPUTS });
    expect(ground(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position, SPAWN)).toBeLessThan(0.05);
  });
});
