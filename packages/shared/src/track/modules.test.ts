import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_CHARACTER_ID, RapierSimulation, initPhysics } from "../simulation/RapierSimulation.js";
import { M1_MODULES, MODULE_LIBRARY } from "./modules.js";
import { resolveTrack } from "./Track.js";

beforeAll(async () => {
  await initPhysics();
});

describe("arena (M5 ticket 06) — one open platform over the void, no walls", () => {
  it("appears in the builder palette like any other Module — it's in MODULE_LIBRARY", () => {
    expect(MODULE_LIBRARY.arena).toBeDefined();
    expect(MODULE_LIBRARY.arena).toBe(M1_MODULES.arena);
  });

  it("carries no Checkpoint and no Finish Zone", () => {
    expect(M1_MODULES.arena!.checkpoint).toBeUndefined();
    expect(M1_MODULES.arena!.finishZone).toBeUndefined();
  });

  it("resolves cleanly on its own, with neither", () => {
    const track = [{ moduleId: "arena", position: { x: 0, y: 0, z: 0 }, rotation: 0 }];
    const resolved = resolveTrack(MODULE_LIBRARY, track);

    expect(resolved.checkpoints).toEqual([]);
    expect(resolved.finishZones).toEqual([]);
    expect(resolved.statics.length).toBeGreaterThan(0); // the platform itself
  });

  it("is walkable — a Character standing on it does not immediately fall", () => {
    const track = [{ moduleId: "arena", position: { x: 0, y: 0, z: 0 }, rotation: 0 }];
    const resolved = resolveTrack(MODULE_LIBRARY, track);
    const sim = new RapierSimulation({ ...resolved, spawn: { x: 0, y: 1.5, z: 0 } });

    for (let n = 0; n < 30; n += 1) sim.tick({});

    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.motionState).toBe("Controlled");
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.fallCount).toBe(0);
    sim.dispose();
  });

  it("has no walls, no bridges — you can fall off it in every direction", () => {
    const NORTH = { moveDirection: { x: 0, y: 0, z: -1 }, jumpHeld: false, dashHeld: false, facing: 0, hitHeld: false };
    const SOUTH = { moveDirection: { x: 0, y: 0, z: 1 }, jumpHeld: false, dashHeld: false, facing: 0, hitHeld: false };
    const EAST = { moveDirection: { x: 1, y: 0, z: 0 }, jumpHeld: false, dashHeld: false, facing: 0, hitHeld: false };
    const WEST = { moveDirection: { x: -1, y: 0, z: 0 }, jumpHeld: false, dashHeld: false, facing: 0, hitHeld: false };

    for (const [label, input] of [
      ["north", NORTH],
      ["south", SOUTH],
      ["east", EAST],
      ["west", WEST],
    ] as const) {
      const track = [{ moduleId: "arena", position: { x: 0, y: 0, z: 0 }, rotation: 0 }];
      const resolved = resolveTrack(MODULE_LIBRARY, track);
      const sim = new RapierSimulation({ ...resolved, spawn: { x: 0, y: 1.5, z: 0 } });

      let fell = false;
      for (let n = 0; n < 300 && !fell; n += 1) {
        sim.tick({ [DEFAULT_CHARACTER_ID]: input });
        fell = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.fallCount >= 1;
      }

      expect(fell, `walking ${label} never fell off the arena`).toBe(true);
      sim.dispose();
    }
  });
});
