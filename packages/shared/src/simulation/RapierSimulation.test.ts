import { beforeAll, describe, expect, it } from "vitest";
import type { Box } from "../math/box.js";
import {
  CAPSULE_BOTTOM_OFFSET,
  DASH_COOLDOWN_MS,
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

const input = (partial: Partial<SimInputs> = {}): SimInputs => ({ ...IDLE_INPUTS, ...partial });
const NORTH = input({ moveDirection: { x: 0, y: 0, z: -1 } });

const tick = (sim: RapierSimulation, seconds: number, i: SimInputs = IDLE_INPUTS) => {
  for (let n = 0; n < Math.round(seconds * TICK_RATE_HZ); n += 1) sim.tick(i);
};

/** Jump/settle, then hold `held` for `count` ticks, tracking the peak Y. */
const peakYWhile = (sim: RapierSimulation, count: number, held: SimInputs): number => {
  let peak = -Infinity;
  for (let n = 0; n < count; n += 1) {
    sim.tick(held);
    peak = Math.max(peak, sim.snapshot().character.position.y);
  }
  return peak;
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
    tick(sim, 2, input({ moveDirection: { x: 1, y: 0, z: 0 } }));
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

    tick(sim, 2.5, input({ moveDirection: { x: 0, y: 0, z: 1 } })); // walk back south through `near`
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
    tick(sim, 0.5, input({ moveDirection: { x: 1, y: 0, z: 0 } })); // walk toward the east edge
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

describe("RapierSimulation — jump", () => {
  const settled = () => {
    const sim = new RapierSimulation({ spawn: RESTING_SPAWN, statics: [GROUND] });
    tick(sim, 0.5);
    return sim;
  };

  it("lifts the Character clear of the ground on a jump", () => {
    const sim = settled();
    const restY = sim.snapshot().character.position.y;
    sim.tick(input({ jumpHeld: true })); // rising edge
    const peak = peakYWhile(sim, 30, input({ jumpHeld: true }));
    expect(peak - restY).toBeGreaterThan(1.5);
  });

  it("reaches a higher peak when jump is held longer", () => {
    const restY = settled().snapshot().character.position.y;

    const tapper = settled();
    tapper.tick(input({ jumpHeld: true }));
    let tapPeak = -Infinity;
    for (let n = 0; n < 40; n += 1) {
      tapper.tick(input({ jumpHeld: false })); // released straight away
      tapPeak = Math.max(tapPeak, tapper.snapshot().character.position.y);
    }

    const holder = settled();
    holder.tick(input({ jumpHeld: true }));
    const holdPeak = peakYWhile(holder, 40, input({ jumpHeld: true }));

    expect(holdPeak).toBeGreaterThan(tapPeak + 0.3);
    expect(tapPeak - restY).toBeGreaterThan(0.4); // a tap still hops
  });

  it("does not jump a second time in mid-air (no double jump)", () => {
    const singlePeak = (() => {
      const sim = settled();
      sim.tick(input({ jumpHeld: true }));
      return peakYWhile(sim, 45, input({ jumpHeld: true }));
    })();

    const sim = settled();
    sim.tick(input({ jumpHeld: true }));
    for (let n = 0; n < 6; n += 1) sim.tick(input({ jumpHeld: true }));
    sim.tick(input({ jumpHeld: false })); // release mid-air
    sim.tick(input({ jumpHeld: true })); // press again mid-air
    const doublePeak = peakYWhile(sim, 45, input({ jumpHeld: true }));

    expect(doublePeak).toBeLessThanOrEqual(singlePeak + 0.15);
  });

  it("caps the jump height even if jump is held indefinitely", () => {
    const restY = settled().snapshot().character.position.y;

    const normalHold = settled();
    normalHold.tick(input({ jumpHeld: true }));
    const normalPeak = peakYWhile(normalHold, 45, input({ jumpHeld: true }));

    const foreverHold = settled();
    foreverHold.tick(input({ jumpHeld: true }));
    const foreverPeak = peakYWhile(foreverHold, 200, input({ jumpHeld: true }));

    // holding past the hold-time cap adds nothing — the extra float window is bounded
    expect(foreverPeak - restY).toBeLessThan(normalPeak - restY + 0.2);
  });

  it("still lets the Character jump just after walking off an edge (coyote time)", () => {
    const ledge: Box = { center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 2, y: 0.5, z: 2 } };
    const sim = new RapierSimulation({
      spawn: { x: 0, y: RESTING_SPAWN.y, z: 1.5 },
      statics: [ledge],
      killPlaneY: -30,
    });
    tick(sim, 0.5);

    // walk north until the moment ground contact is lost
    for (let n = 0; n < 60 && sim.snapshot().character.grounded; n += 1) sim.tick(NORTH);
    const yAtEdge = sim.snapshot().character.position.y;

    // jump immediately — inside the coyote window
    const rise = peakYWhile(sim, 12, input({ ...NORTH, jumpHeld: true }));
    expect(rise).toBeGreaterThan(yAtEdge + 0.5);
  });

  it("does not jump once the coyote window has passed", () => {
    const ledge: Box = { center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 2, y: 0.5, z: 2 } };
    const sim = new RapierSimulation({
      spawn: { x: 0, y: RESTING_SPAWN.y, z: 1.5 },
      statics: [ledge],
      killPlaneY: -30,
    });
    tick(sim, 0.5);
    for (let n = 0; n < 60 && sim.snapshot().character.grounded; n += 1) sim.tick(NORTH);

    tick(sim, 0.4, NORTH); // fall for well over the coyote window
    const yBefore = sim.snapshot().character.position.y;
    peakYWhile(sim, 6, input({ ...NORTH, jumpHeld: true }));
    expect(sim.snapshot().character.position.y).toBeLessThan(yBefore); // kept falling
  });
});

describe("RapierSimulation — dash", () => {
  const settled = () => {
    const sim = new RapierSimulation({ spawn: RESTING_SPAWN, statics: [GROUND] });
    tick(sim, 0.5);
    return sim;
  };

  it("covers much more ground during a dash than a plain walk", () => {
    const walkRef = settled();
    const walkStart = walkRef.snapshot().character.position.z;
    tick(walkRef, 0.3, NORTH);
    const walked = Math.abs(walkRef.snapshot().character.position.z - walkStart);

    const dasher = settled();
    const dashStart = dasher.snapshot().character.position.z;
    dasher.tick(input({ ...NORTH, dashHeld: true })); // dash press
    tick(dasher, 0.3, NORTH);
    const dashed = Math.abs(dasher.snapshot().character.position.z - dashStart);

    expect(dashed).toBeGreaterThan(walked * 1.5);
  });

  it("dashes along the movement direction, not straight ahead when idle-facing changes", () => {
    const sim = settled();
    tick(sim, 0.2, NORTH); // establish a facing
    const before = sim.snapshot().character.position;
    sim.tick(input({ moveDirection: { x: 1, y: 0, z: 0 }, dashHeld: true })); // dash east
    tick(sim, 0.2, input({ moveDirection: { x: 1, y: 0, z: 0 } }));
    const after = sim.snapshot().character.position;
    expect(after.x - before.x).toBeGreaterThan(1.5);
    expect(Math.abs(after.z - before.z)).toBeLessThan(1);
  });

  it("eases the dash speed in and out rather than jumping to full speed", () => {
    const sim = settled();
    const stepZ = (i: SimInputs): number => {
      const z0 = sim.snapshot().character.position.z;
      sim.tick(i);
      return Math.abs(sim.snapshot().character.position.z - z0);
    };

    const first = stepZ(input({ ...NORTH, dashHeld: true })); // dash press tick
    const rest = [1, 2, 3, 4, 5, 6].map(() => stepZ(NORTH));

    const peak = Math.max(first, ...rest);
    const last = rest[rest.length - 1]!;
    expect(peak).toBeGreaterThan(first * 1.5); // sped up after the first tick
    expect(last).toBeLessThan(peak * 0.7); // eased back down before the end
  });

  it("dashes along the last movement direction when the stick is idle", () => {
    const sim = settled();
    tick(sim, 0.3, NORTH); // establish a northward facing
    tick(sim, 0.2, IDLE_INPUTS); // let momentum settle, stick released
    const before = sim.snapshot().character.position;

    sim.tick(input({ dashHeld: true })); // dash with no move input
    tick(sim, 0.2, IDLE_INPUTS);
    const after = sim.snapshot().character.position;

    expect(after.z - before.z).toBeLessThan(-2); // dashed north, the last-held direction
    expect(Math.abs(after.x - before.x)).toBeLessThan(0.5);
  });

  it("enforces the cooldown — a second dash within a second does nothing extra", () => {
    const sim = settled();
    const start = sim.snapshot().character.position.z;
    sim.tick(input({ ...NORTH, dashHeld: true }));
    tick(sim, 0.3, NORTH);
    const afterFirst = sim.snapshot().character.position.z;

    sim.tick(input({ ...NORTH, dashHeld: false }));
    sim.tick(input({ ...NORTH, dashHeld: true })); // try again ~0.35s later
    tick(sim, 0.3, NORTH);
    const afterSecondAttempt = sim.snapshot().character.position.z;

    const firstBurst = Math.abs(afterFirst - start);
    const secondSpan = Math.abs(afterSecondAttempt - afterFirst);
    expect(secondSpan).toBeLessThan(firstBurst * 0.75); // second "dash" was just a walk
  });

  it("surfaces the cooldown and lets it recover", () => {
    const sim = settled();
    expect(sim.snapshot().character.dashCooldownMs).toBe(0);

    sim.tick(input({ ...NORTH, dashHeld: true }));
    expect(sim.snapshot().character.dashCooldownMs).toBeGreaterThan(DASH_COOLDOWN_MS * 0.8);

    tick(sim, DASH_COOLDOWN_MS / 1000 + 0.1, NORTH);
    expect(sim.snapshot().character.dashCooldownMs).toBe(0);
  });

  it("works in the air", () => {
    const sim = settled();
    sim.tick(input({ jumpHeld: true }));
    tick(sim, 0.15, input({ jumpHeld: true })); // rising
    const before = sim.snapshot().character.position.z;
    sim.tick(input({ moveDirection: { x: 0, y: 0, z: -1 }, dashHeld: true, jumpHeld: true }));
    tick(sim, 0.15, input({ jumpHeld: true, moveDirection: { x: 0, y: 0, z: -1 } }));
    const after = sim.snapshot().character.position.z;
    expect(Math.abs(after - before)).toBeGreaterThan(WALK_SPEED * 0.3 * 1.2);
  });
});
