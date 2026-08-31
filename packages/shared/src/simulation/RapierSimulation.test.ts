import { beforeAll, describe, expect, it } from "vitest";
import type { Box } from "../math/box.js";
import {
  CAPSULE_BOTTOM_OFFSET,
  DASH_COOLDOWN_MS,
  IMPACT_RAGDOLL_MIN,
  IMPACT_STAGGER_MIN,
  RAGDOLL_MAX_MS,
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

/**
 * Tick idle until the Character is back under control. Ticks first, then checks —
 * a Fall queues the ragdoll but the state machine only transitions on the next
 * tick, so an immediate check would see a stale `Controlled`.
 */
const tickUntilControlled = (sim: RapierSimulation, maxTicks = 400): void => {
  for (let i = 0; i < maxTicks; i += 1) {
    sim.tick(IDLE_INPUTS);
    if (sim.snapshot().character.motionState === "Controlled") return;
  }
  throw new Error(`still ${sim.snapshot().character.motionState} after ${maxTicks} ticks`);
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
  /** A floating platform with a big void underneath and a kill-plane at y = -8. */
  const PLATFORM: Box = { center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 4, y: 0.5, z: 4 } };
  const config = { spawn: { x: 0, y: 1.5, z: 0 }, statics: [PLATFORM], killPlaneY: -8 };

  it("respawns at spawn after Falling past the kill-plane", () => {
    const sim = new RapierSimulation(config);
    tick(sim, 0.5); // settle
    tickUntilFall(sim); // walk off the north edge
    tickUntilControlled(sim); // ragdoll flop + get up

    const { character } = sim.snapshot();
    expect(character.fallCount).toBe(1);
    expect(character.position.y).toBeGreaterThan(config.killPlaneY); // out of the void
    expect(Math.hypot(character.position.x, character.position.z)).toBeLessThan(3); // near the spawn
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
      respawn: { x: 8, y: 1.5, z: 0 },
      volume: { center: { x: 0, y: 0.5, z: 0 }, halfExtents: { x: 2, y: 2, z: 2 } },
    };
    const sim = new RapierSimulation({
      spawn: config.spawn,
      statics: [
        PLATFORM,
        { center: { x: 8, y: -0.5, z: 0 }, halfExtents: { x: 3, y: 0.5, z: 3 } }, // checkpoint pad
      ],
      checkpoints: [checkpoint],
      killPlaneY: -8,
    });
    tick(sim, 0.5); // settle inside the checkpoint volume
    expect(sim.snapshot().character.checkpointIndex).toBe(0);

    tickUntilFall(sim);
    tickUntilControlled(sim);

    expect(Math.abs(sim.snapshot().character.position.x - 8)).toBeLessThan(3); // respawned at the pad
  });

  it("routes a Fall through a Ragdoll at the Checkpoint before returning control", () => {
    const sim = new RapierSimulation({ spawn: config.spawn, statics: [PLATFORM], killPlaneY: -8 });
    tick(sim, 0.5);
    tickUntilFall(sim);

    sim.tick(NORTH); // the respawn tick
    expect(sim.snapshot().character.motionState).toBe("Ragdoll");
    expect(sim.snapshot().character.bones.length).toBe(11);

    const seen = new Set<string>();
    for (let i = 0; i < 400; i += 1) {
      seen.add(sim.snapshot().character.motionState);
      if (sim.snapshot().character.motionState === "Controlled") break;
      sim.tick(NORTH); // input is ignored while ragdolling / getting up
    }
    expect(seen.has("Ragdoll")).toBe(true);
    expect(seen.has("GettingUp")).toBe(true);
    expect(sim.snapshot().character.motionState).toBe("Controlled");
  });

  it("ignores movement input until control returns after a Fall", () => {
    const sim = new RapierSimulation({ spawn: config.spawn, statics: [PLATFORM], killPlaneY: -8 });
    tick(sim, 0.5);
    tickUntilFall(sim);
    sim.tick(NORTH);
    const afterRespawn = sim.snapshot().character.position;

    for (let i = 0; i < 20; i += 1) sim.tick(input({ moveDirection: { x: 1, y: 0, z: 0 } }));
    // still ragdolling — the flopping body moves a little, but nowhere near a full walk
    expect(Math.abs(sim.snapshot().character.position.x - afterRespawn.x)).toBeLessThan(1.5);
  });

  it("flags the teleport only on the respawn tick", () => {
    const sim = new RapierSimulation({ spawn: config.spawn, statics: [PLATFORM], killPlaneY: -8 });
    tick(sim, 0.5);
    tickUntilFall(sim);

    sim.tick(NORTH); // respawn tick
    expect(sim.snapshot().character.teleported).toBe(true);

    sim.tick(NORTH);
    expect(sim.snapshot().character.teleported).toBe(false);
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

  it("surfaces dashing:true for the renderer only while a burst is playing out", () => {
    const sim = settled();
    expect(sim.snapshot().character.dashing).toBe(false);

    sim.tick(input({ ...NORTH, dashHeld: true }));
    expect(sim.snapshot().character.dashing).toBe(true);

    tick(sim, 1, NORTH); // well past DASH_DURATION_MS
    expect(sim.snapshot().character.dashing).toBe(false);
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

  it("does not start a Dash while airborne — grounded only", () => {
    const sim = settled();
    sim.tick(input({ jumpHeld: true }));
    tick(sim, 0.15, input({ jumpHeld: true })); // rising, now airborne
    expect(sim.snapshot().character.grounded).toBe(false);

    sim.tick(input({ ...NORTH, dashHeld: true, jumpHeld: true })); // dash press while airborne
    expect(sim.snapshot().character.dashing).toBe(false);
    expect(sim.snapshot().character.dashCooldownMs).toBe(0); // ignored outright, not even queued

    const before = sim.snapshot().character.position.z;
    tick(sim, 0.15, input({ ...NORTH, jumpHeld: true }));
    const after = sim.snapshot().character.position.z;
    expect(Math.abs(after - before)).toBeLessThan(WALK_SPEED * 0.15 * 1.5); // plain air control only
  });
});

describe("RapierSimulation — Impact & ragdoll", () => {
  const standing = () => {
    const sim = new RapierSimulation({ spawn: RESTING_SPAWN, statics: [GROUND] });
    tick(sim, 0.5);
    return sim;
  };

  it("ignores a tiny Impact", () => {
    const sim = standing();
    sim.applyImpact({ x: IMPACT_STAGGER_MIN - 1, y: 0, z: 0 });
    sim.tick(IDLE_INPUTS);
    expect(sim.snapshot().character.motionState).toBe("Controlled");
  });

  it("staggers on a medium Impact — stays upright, walks slower, recovers", () => {
    const sim = standing();
    sim.applyImpact({ x: (IMPACT_STAGGER_MIN + IMPACT_RAGDOLL_MIN) / 2, y: 0, z: 0 });
    sim.tick(NORTH);
    expect(sim.snapshot().character.motionState).toBe("Stagger");
    expect(sim.snapshot().character.bones.length).toBe(0); // no ragdoll body

    const staggerZ0 = sim.snapshot().character.position.z;
    tick(sim, 0.2, NORTH);
    const staggerTravel = Math.abs(sim.snapshot().character.position.z - staggerZ0);
    expect(staggerTravel).toBeLessThan(WALK_SPEED * 0.2 * 0.6); // dampened

    tickUntilControlled(sim);
    expect(sim.snapshot().character.motionState).toBe("Controlled");
  });

  it("ragdolls on a hard Impact and shows 11 bones", () => {
    const sim = standing();
    sim.applyImpact({ x: IMPACT_RAGDOLL_MIN + 5, y: 3, z: 0 });
    sim.tick(IDLE_INPUTS);
    expect(sim.snapshot().character.motionState).toBe("Ragdoll");
    expect(sim.snapshot().character.bones.length).toBe(11);
  });

  it("the ragdoll does not explode — bones stay near the Character and finite", () => {
    const sim = standing();
    const origin = sim.snapshot().character.position;
    sim.applyImpact({ x: IMPACT_RAGDOLL_MIN + 4, y: 4, z: 0 });
    for (let i = 0; i < 90; i += 1) {
      sim.tick(IDLE_INPUTS);
      for (const b of sim.snapshot().character.bones) {
        expect(Number.isFinite(b.position.x + b.position.y + b.position.z)).toBe(true);
        expect(Math.hypot(b.position.x - origin.x, b.position.z - origin.z)).toBeLessThan(12);
      }
    }
  });

  it("gets back up and returns to Controlled near where it fell", () => {
    const sim = standing();
    const fellAt = sim.snapshot().character.position;
    sim.applyImpact({ x: IMPACT_RAGDOLL_MIN + 3, y: 3, z: 0 });
    tickUntilControlled(sim, 500);

    const back = sim.snapshot().character.position;
    expect(sim.snapshot().character.motionState).toBe("Controlled");
    expect(sim.snapshot().character.bones.length).toBe(0);
    expect(back.y - CAPSULE_BOTTOM_OFFSET).toBeCloseTo(0, 0); // standing on the ground again
    expect(Math.hypot(back.x - fellAt.x, back.z - fellAt.z)).toBeLessThan(6);
  });

  it("caps ragdoll time even if it never settles (RAGDOLL_MAX_MS)", () => {
    const sim = standing();
    sim.applyImpact({ x: IMPACT_RAGDOLL_MIN, y: 1, z: 0 });
    tick(sim, RAGDOLL_MAX_MS / 1000 + 0.2);
    // it must have left Ragdoll (into GettingUp or already Controlled)
    expect(sim.snapshot().character.motionState).not.toBe("Ragdoll");
  });

  it("the camera-follow point never jumps at the Ragdoll → GettingUp handoff", () => {
    const sim = standing();
    sim.applyImpact({ x: IMPACT_RAGDOLL_MIN + 3, y: 4, z: 0 });
    let prev = sim.snapshot().character.position;
    let maxStep = 0;
    for (let i = 0; i < 400; i += 1) {
      sim.tick(IDLE_INPUTS);
      const c = sim.snapshot().character;
      if (!c.teleported) {
        maxStep = Math.max(maxStep, Math.hypot(c.position.x - prev.x, c.position.y - prev.y, c.position.z - prev.z));
      }
      prev = c.position;
      if (c.motionState === "Controlled" && i > 20) break;
    }
    expect(maxStep).toBeLessThan(0.35); // no ~0.7 pop, no discontinuity
  });

  it("dampens jump and dash while Staggered, not just walking", () => {
    const sim = standing();
    sim.applyImpact({ x: (IMPACT_STAGGER_MIN + IMPACT_RAGDOLL_MIN) / 2, y: 0, z: 0 });
    sim.tick(input({ jumpHeld: true, dashHeld: true }));
    expect(sim.snapshot().character.motionState).toBe("Stagger");
    const y0 = sim.snapshot().character.position.y;

    // hammer jump+dash while staggered — the Character should barely leave the ground
    for (let i = 0; i < 4; i += 1) {
      sim.tick(input({ jumpHeld: false, dashHeld: false }));
      sim.tick(input({ ...NORTH, jumpHeld: true, dashHeld: true }));
    }
    expect(sim.snapshot().character.position.y - y0).toBeLessThan(0.4); // no real jump
  });
});

describe("RapierSimulation — Spinner", () => {
  it("knocks a standing Character down when the rotating bar sweeps through it", () => {
    const sim = new RapierSimulation({
      spawn: RESTING_SPAWN,
      statics: [GROUND],
      spinners: [
        {
          center: { x: 0, y: RESTING_SPAWN.y, z: 3 },
          armLength: 3.5,
          halfHeight: 0.5,
          armRadius: 0.4,
          angularSpeed: 2 * Math.PI, // one revolution per second — several sweeps in the window below
        },
      ],
    });
    tick(sim, 0.5); // settle

    let hit = false;
    for (let i = 0; i < 90; i += 1) {
      sim.tick(IDLE_INPUTS);
      if (sim.snapshot().character.motionState !== "Controlled") {
        hit = true;
        break;
      }
    }
    expect(hit).toBe(true);
  });

  it("does nothing to a Character outside the bar's reach", () => {
    const sim = new RapierSimulation({
      spawn: RESTING_SPAWN,
      statics: [GROUND],
      spinners: [
        {
          center: { x: 0, y: RESTING_SPAWN.y, z: 10 }, // far away
          armLength: 3.5,
          halfHeight: 0.5,
          armRadius: 0.4,
          angularSpeed: 2 * Math.PI,
        },
      ],
    });
    tick(sim, 2); // several full revolutions
    expect(sim.snapshot().character.motionState).toBe("Controlled");
  });
});

describe("RapierSimulation — dynamic props", () => {
  const propConfig = {
    shape: { kind: "box" as const, halfExtents: { x: 0.4, y: 0.4, z: 0.4 } },
    center: { x: 0, y: 0.4, z: -1.5 },
  };

  it("pushes a Prop when the Character walks into it", () => {
    const sim = new RapierSimulation({ spawn: RESTING_SPAWN, statics: [GROUND], props: [propConfig] });
    tick(sim, 0.5); // settle
    const start = sim.snapshot().props[0]!.position;

    tick(sim, 1.5, NORTH); // walk into the prop, which sits north of spawn

    const moved = sim.snapshot().props[0]!.position;
    expect(Math.hypot(moved.x - start.x, moved.z - start.z)).toBeGreaterThan(0.3);
  });

  it("leaves an untouched Prop at rest", () => {
    const sim = new RapierSimulation({ spawn: RESTING_SPAWN, statics: [GROUND], props: [propConfig] });
    tick(sim, 1);
    const p = sim.snapshot().props[0]!.position;
    expect(Math.hypot(p.x - propConfig.center.x, p.z - propConfig.center.z)).toBeLessThan(0.1);
  });
});

describe("RapierSimulation — dash into a wall", () => {
  const WALL: Box = { center: { x: 3, y: 1, z: 0 }, halfExtents: { x: 0.5, y: 1, z: 5 } };

  it("ragdolls the Character when a dash is blocked by a wall", () => {
    const sim = new RapierSimulation({ spawn: RESTING_SPAWN, statics: [GROUND, WALL] });
    tick(sim, 0.5); // settle
    sim.tick(input({ moveDirection: { x: 1, y: 0, z: 0 }, dashHeld: true })); // dash toward the wall

    let ragdolled = false;
    for (let i = 0; i < 20; i += 1) {
      sim.tick(input({ moveDirection: { x: 1, y: 0, z: 0 } }));
      if (sim.snapshot().character.motionState === "Ragdoll") {
        ragdolled = true;
        break;
      }
    }
    expect(ragdolled).toBe(true);
  });

  it("does not ragdoll from an ordinary walk into a wall", () => {
    const sim = new RapierSimulation({ spawn: RESTING_SPAWN, statics: [GROUND, WALL] });
    tick(sim, 0.5);
    tick(sim, 2, input({ moveDirection: { x: 1, y: 0, z: 0 } }));
    expect(sim.snapshot().character.motionState).toBe("Controlled");
  });
});
