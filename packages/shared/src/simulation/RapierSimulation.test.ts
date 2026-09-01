import { beforeAll, describe, expect, it } from "vitest";
import type { Box } from "../math/box.js";
import {
  CAPSULE_BOTTOM_OFFSET,
  DASH_COOLDOWN_MS,
  DASH_DURATION_MS,
  DASH_SPEED,
  IMPACT_RAGDOLL_MIN,
  IMPACT_STAGGER_MIN,
  RAGDOLL_MAX_MS,
  TICK_RATE_HZ,
  WALK_SPEED,
} from "../tuning.js";
import type { Checkpoint } from "./Checkpoint.js";
import { DEFAULT_CHARACTER_ID, RapierSimulation, initPhysics } from "./RapierSimulation.js";
import { IDLE_INPUTS, type SimInputs } from "./SimInputs.js";

beforeAll(async () => {
  await initPhysics();
});

const GROUND: Box = { center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 20, y: 0.5, z: 20 } };
const RESTING_SPAWN = { x: 0, y: CAPSULE_BOTTOM_OFFSET + 0.1, z: 0 };

const input = (partial: Partial<SimInputs> = {}): SimInputs => ({ ...IDLE_INPUTS, ...partial });
const NORTH = input({ moveDirection: { x: 0, y: 0, z: -1 } });

const tick = (sim: RapierSimulation, seconds: number, i: SimInputs = IDLE_INPUTS) => {
  for (let n = 0; n < Math.round(seconds * TICK_RATE_HZ); n += 1) sim.tick({ [DEFAULT_CHARACTER_ID]: i });
};

/** Jump/settle, then hold `held` for `count` ticks, tracking the peak Y. */
const peakYWhile = (sim: RapierSimulation, count: number, held: SimInputs): number => {
  let peak = -Infinity;
  for (let n = 0; n < count; n += 1) {
    sim.tick({ [DEFAULT_CHARACTER_ID]: held });
    peak = Math.max(peak, sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position.y);
  }
  return peak;
};

const tickUntilFall = (sim: RapierSimulation): void => {
  for (let i = 0; i < 300; i += 1) {
    sim.tick({ [DEFAULT_CHARACTER_ID]: NORTH });
    if (sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.fallCount >= 1) return;
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
    sim.tick({ [DEFAULT_CHARACTER_ID]: IDLE_INPUTS });
    if (sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.motionState === "Controlled") return;
  }
  throw new Error(`still ${sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.motionState} after ${maxTicks} ticks`);
};

describe("RapierSimulation — walk", () => {
  it("drops the character under gravity onto the ground", () => {
    const sim = new RapierSimulation({ spawn: { x: 0, y: 4, z: 0 }, statics: [GROUND] });
    tick(sim, 3);
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position.y - CAPSULE_BOTTOM_OFFSET).toBeCloseTo(0, 1);
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.grounded).toBe(true);
  });

  it("walks the character in the commanded direction at roughly WALK_SPEED", () => {
    const sim = new RapierSimulation({ spawn: RESTING_SPAWN, statics: [GROUND] });
    tick(sim, 0.5);
    const before = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;
    tick(sim, 1, NORTH);
    const after = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;
    expect(after.z - before.z).toBeCloseTo(-WALK_SPEED, 0);
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.motionState).toBe("Controlled"); // the only M1 state
  });

  it("stops the character at a wall instead of passing through it", () => {
    const wall: Box = { center: { x: 3, y: 1, z: 0 }, halfExtents: { x: 0.5, y: 1, z: 5 } };
    const sim = new RapierSimulation({ spawn: RESTING_SPAWN, statics: [GROUND, wall] });
    tick(sim, 2, input({ moveDirection: { x: 1, y: 0, z: 0 } }));
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position.x).toBeLessThan(2.5);
  });

  it("advances the tick counter once per tick", () => {
    const sim = new RapierSimulation({ statics: [GROUND] });
    sim.tick({ [DEFAULT_CHARACTER_ID]: IDLE_INPUTS });
    sim.tick({ [DEFAULT_CHARACTER_ID]: IDLE_INPUTS });
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

    const character = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!;
    expect(character.fallCount).toBe(1);
    expect(character.position.y).toBeGreaterThan(config.killPlaneY); // out of the void
    expect(Math.hypot(character.position.x, character.position.z)).toBeLessThan(3); // near the spawn
    expect(character.checkpointIndex).toBeNull(); // no checkpoint reached
  });

  it("advances ragdollEpoch on a Fall and records the cause (ADR 0023)", () => {
    const sim = new RapierSimulation(config);
    tick(sim, 0.5);
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.ragdollEpoch).toBe(0);

    tickUntilFall(sim);
    sim.tick({}); // the forced Ragdoll transition lands the tick after the Fall is detected

    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.ragdollEpoch).toBe(1);
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.ragdollCause).toBe("Fall");
  });

  it("phaseStartTick is stamped once, in sim-tick space, and repeated snapshot() calls don't move it", () => {
    const sim = new RapierSimulation(config);
    tick(sim, 0.5);
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.phaseStartTick).toBe(0); // Controlled since tick 0

    tickUntilFall(sim);
    sim.tick({}); // Ragdoll entry
    const entered = sim.snapshot().tick;
    const stamped = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.phaseStartTick;
    expect(stamped).toBe(entered);
    // snapshot() is a pure read now — calling it again must not re-stamp.
    for (let i = 0; i < 3; i += 1) {
      expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.phaseStartTick).toBe(stamped);
    }
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
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.checkpointIndex).toBe(1);

    tick(sim, 2.5, input({ moveDirection: { x: 0, y: 0, z: 1 } })); // walk back south through `near`
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.checkpointIndex).toBe(1); // still the far one
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
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.checkpointIndex).toBe(0);

    tickUntilFall(sim);
    tickUntilControlled(sim);

    expect(Math.abs(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position.x - 8)).toBeLessThan(3); // respawned at the pad
  });

  it("routes a Fall through a Ragdoll at the Checkpoint before returning control", () => {
    const sim = new RapierSimulation({ spawn: config.spawn, statics: [PLATFORM], killPlaneY: -8 });
    tick(sim, 0.5);
    tickUntilFall(sim);

    sim.tick({ [DEFAULT_CHARACTER_ID]: NORTH }); // the respawn tick
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.motionState).toBe("Ragdoll");
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.bones.length).toBe(11);

    const seen = new Set<string>();
    for (let i = 0; i < 400; i += 1) {
      seen.add(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.motionState);
      if (sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.motionState === "Controlled") break;
      sim.tick({ [DEFAULT_CHARACTER_ID]: NORTH }); // input is ignored while ragdolling / getting up
    }
    expect(seen.has("Ragdoll")).toBe(true);
    expect(seen.has("GettingUp")).toBe(true);
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.motionState).toBe("Controlled");
  });

  it("ignores movement input until control returns after a Fall", () => {
    const sim = new RapierSimulation({ spawn: config.spawn, statics: [PLATFORM], killPlaneY: -8 });
    tick(sim, 0.5);
    tickUntilFall(sim);
    sim.tick({ [DEFAULT_CHARACTER_ID]: NORTH });
    const afterRespawn = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;

    for (let i = 0; i < 20; i += 1) sim.tick({ [DEFAULT_CHARACTER_ID]: input({ moveDirection: { x: 1, y: 0, z: 0 } }) });
    // still ragdolling — the flopping body moves a little, but nowhere near a full walk
    expect(Math.abs(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position.x - afterRespawn.x)).toBeLessThan(1.5);
  });

  it("advances respawnCount once per Respawn and holds it steady between (ADR 0023, Q9)", () => {
    const sim = new RapierSimulation({ spawn: config.spawn, statics: [PLATFORM], killPlaneY: -8 });
    tick(sim, 0.5);
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.respawnCount).toBe(0);

    tickUntilFall(sim);
    sim.tick({ [DEFAULT_CHARACTER_ID]: NORTH }); // respawn tick
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.respawnCount).toBe(1);

    // Stable between respawns — not a one-tick pulse (a skipped snapshot must
    // still be able to observe the change against a last-seen value).
    for (let i = 0; i < 5; i += 1) sim.tick({ [DEFAULT_CHARACTER_ID]: NORTH });
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.respawnCount).toBe(1);
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
    const restY = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position.y;
    sim.tick({ [DEFAULT_CHARACTER_ID]: input({ jumpHeld: true }) }); // rising edge
    const peak = peakYWhile(sim, 30, input({ jumpHeld: true }));
    expect(peak - restY).toBeGreaterThan(1.5);
  });

  it("reaches a higher peak when jump is held longer", () => {
    const restY = settled().snapshot().characters[DEFAULT_CHARACTER_ID]!.position.y;

    const tapper = settled();
    tapper.tick({ [DEFAULT_CHARACTER_ID]: input({ jumpHeld: true }) });
    let tapPeak = -Infinity;
    for (let n = 0; n < 40; n += 1) {
      tapper.tick({ [DEFAULT_CHARACTER_ID]: input({ jumpHeld: false }) }); // released straight away
      tapPeak = Math.max(tapPeak, tapper.snapshot().characters[DEFAULT_CHARACTER_ID]!.position.y);
    }

    const holder = settled();
    holder.tick({ [DEFAULT_CHARACTER_ID]: input({ jumpHeld: true }) });
    const holdPeak = peakYWhile(holder, 40, input({ jumpHeld: true }));

    expect(holdPeak).toBeGreaterThan(tapPeak + 0.3);
    expect(tapPeak - restY).toBeGreaterThan(0.4); // a tap still hops
  });

  it("does not jump a second time in mid-air (no double jump)", () => {
    const singlePeak = (() => {
      const sim = settled();
      sim.tick({ [DEFAULT_CHARACTER_ID]: input({ jumpHeld: true }) });
      return peakYWhile(sim, 45, input({ jumpHeld: true }));
    })();

    const sim = settled();
    sim.tick({ [DEFAULT_CHARACTER_ID]: input({ jumpHeld: true }) });
    for (let n = 0; n < 6; n += 1) sim.tick({ [DEFAULT_CHARACTER_ID]: input({ jumpHeld: true }) });
    sim.tick({ [DEFAULT_CHARACTER_ID]: input({ jumpHeld: false }) }); // release mid-air
    sim.tick({ [DEFAULT_CHARACTER_ID]: input({ jumpHeld: true }) }); // press again mid-air
    const doublePeak = peakYWhile(sim, 45, input({ jumpHeld: true }));

    expect(doublePeak).toBeLessThanOrEqual(singlePeak + 0.15);
  });

  it("caps the jump height even if jump is held indefinitely", () => {
    const restY = settled().snapshot().characters[DEFAULT_CHARACTER_ID]!.position.y;

    const normalHold = settled();
    normalHold.tick({ [DEFAULT_CHARACTER_ID]: input({ jumpHeld: true }) });
    const normalPeak = peakYWhile(normalHold, 45, input({ jumpHeld: true }));

    const foreverHold = settled();
    foreverHold.tick({ [DEFAULT_CHARACTER_ID]: input({ jumpHeld: true }) });
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
    for (let n = 0; n < 60 && sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.grounded; n += 1) sim.tick({ [DEFAULT_CHARACTER_ID]: NORTH });
    const yAtEdge = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position.y;

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
    for (let n = 0; n < 60 && sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.grounded; n += 1) sim.tick({ [DEFAULT_CHARACTER_ID]: NORTH });

    tick(sim, 0.4, NORTH); // fall for well over the coyote window
    const yBefore = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position.y;
    peakYWhile(sim, 6, input({ ...NORTH, jumpHeld: true }));
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position.y).toBeLessThan(yBefore); // kept falling
  });
});

describe("RapierSimulation — dash", () => {
  const settled = () => {
    const sim = new RapierSimulation({ spawn: RESTING_SPAWN, statics: [GROUND] });
    tick(sim, 0.5);
    return sim;
  };

  it("covers much more ground during a dash than a plain walk", () => {
    // The dash builds continuously toward full speed across the whole burst
    // (a "nitro" build, not an early ramp), so the comparison window has to
    // span the full DASH_DURATION_MS to see it, not a short slice of it.
    const window = DASH_DURATION_MS / 1000;

    const walkRef = settled();
    const walkStart = walkRef.snapshot().characters[DEFAULT_CHARACTER_ID]!.position.z;
    tick(walkRef, window, NORTH);
    const walked = Math.abs(walkRef.snapshot().characters[DEFAULT_CHARACTER_ID]!.position.z - walkStart);

    const dasher = settled();
    const dashStart = dasher.snapshot().characters[DEFAULT_CHARACTER_ID]!.position.z;
    dasher.tick({ [DEFAULT_CHARACTER_ID]: input({ ...NORTH, dashHeld: true }) }); // dash press
    tick(dasher, window, NORTH);
    const dashed = Math.abs(dasher.snapshot().characters[DEFAULT_CHARACTER_ID]!.position.z - dashStart);

    expect(dashed).toBeGreaterThan(walked * 1.5);
  });

  it("surfaces dashing:true for the renderer only while a burst is playing out", () => {
    const sim = settled();
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.dashing).toBe(false);

    sim.tick({ [DEFAULT_CHARACTER_ID]: input({ ...NORTH, dashHeld: true }) });
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.dashing).toBe(true);

    tick(sim, DASH_DURATION_MS / 1000 + 0.2, NORTH); // comfortably past the burst's end
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.dashing).toBe(false);
  });

  it("surfaces dashSpeed as a direct, deterministic readout of the dash envelope — 0 when not dashing, rising mid-burst", () => {
    const sim = settled();
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.dashSpeed).toBe(0);

    sim.tick({ [DEFAULT_CHARACTER_ID]: input({ ...NORTH, dashHeld: true }) });
    const justStarted = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.dashSpeed;
    expect(justStarted).toBeGreaterThan(0);
    expect(justStarted).toBeLessThan(DASH_SPEED); // still building, not yet at peak

    tick(sim, DASH_DURATION_MS / 1000 + 0.2, NORTH); // comfortably past the burst's end
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.dashSpeed).toBe(0);
  });

  it("dashes along the movement direction, not straight ahead when idle-facing changes", () => {
    const sim = settled();
    tick(sim, 0.2, NORTH); // establish a facing
    const before = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;
    sim.tick({ [DEFAULT_CHARACTER_ID]: input({ moveDirection: { x: 1, y: 0, z: 0 }, dashHeld: true }) }); // dash east
    tick(sim, DASH_DURATION_MS / 1000, input({ moveDirection: { x: 1, y: 0, z: 0 } }));
    const after = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;
    expect(after.x - before.x).toBeGreaterThan(1.5);
    expect(Math.abs(after.z - before.z)).toBeLessThan(1);
  });

  it("eases the dash speed in and out rather than jumping to full speed", () => {
    const sim = settled();
    const stepZ = (i: SimInputs): number => {
      const z0 = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position.z;
      sim.tick({ [DEFAULT_CHARACTER_ID]: i });
      return Math.abs(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position.z - z0);
    };

    const first = stepZ(input({ ...NORTH, dashHeld: true })); // dash press tick
    const durationTicks = Math.round((DASH_DURATION_MS / 1000) * TICK_RATE_HZ);
    const rest = Array.from({ length: durationTicks - 1 }, () => stepZ(NORTH));

    const peak = Math.max(first, ...rest);
    const last = rest[rest.length - 1]!;
    expect(peak).toBeGreaterThan(first * 1.5); // sped up after the first tick
    expect(last).toBeLessThan(peak * 0.7); // eased back down before the end
  });

  it("dashes along the last movement direction when the stick is idle", () => {
    const sim = settled();
    tick(sim, 0.3, NORTH); // establish a northward facing
    tick(sim, 0.2, IDLE_INPUTS); // let momentum settle, stick released
    const before = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;

    sim.tick({ [DEFAULT_CHARACTER_ID]: input({ dashHeld: true }) }); // dash with no move input
    tick(sim, DASH_DURATION_MS / 1000, IDLE_INPUTS);
    const after = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;

    expect(after.z - before.z).toBeLessThan(-2); // dashed north, the last-held direction
    expect(Math.abs(after.x - before.x)).toBeLessThan(0.5);
  });

  it("enforces the cooldown — a second press mid-burst does not restart it", () => {
    const sim = settled();
    sim.tick({ [DEFAULT_CHARACTER_ID]: input({ ...NORTH, dashHeld: true }) }); // first dash press
    tick(sim, 0.05, NORTH); // a few ticks into the burst, well before it ends
    const cooldownBeforeRetry = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.dashCooldownMs;

    sim.tick({ [DEFAULT_CHARACTER_ID]: input({ ...NORTH, dashHeld: false }) });
    sim.tick({ [DEFAULT_CHARACTER_ID]: input({ ...NORTH, dashHeld: true }) }); // second press attempt, still on cooldown
    const cooldownAfterRetry = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.dashCooldownMs;

    // Ticked down normally, not refreshed back up toward DASH_COOLDOWN_MS.
    expect(cooldownAfterRetry).toBeLessThanOrEqual(cooldownBeforeRetry);
  });

  it("surfaces the cooldown and lets it recover", () => {
    const sim = settled();
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.dashCooldownMs).toBe(0);

    sim.tick({ [DEFAULT_CHARACTER_ID]: input({ ...NORTH, dashHeld: true }) });
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.dashCooldownMs).toBeGreaterThan(DASH_COOLDOWN_MS * 0.8);

    tick(sim, DASH_COOLDOWN_MS / 1000 + 0.1, NORTH);
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.dashCooldownMs).toBe(0);
  });

  it("does not start a Dash while airborne — grounded only", () => {
    const sim = settled();
    sim.tick({ [DEFAULT_CHARACTER_ID]: input({ jumpHeld: true }) });
    tick(sim, 0.15, input({ jumpHeld: true })); // rising, now airborne
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.grounded).toBe(false);

    sim.tick({ [DEFAULT_CHARACTER_ID]: input({ ...NORTH, dashHeld: true, jumpHeld: true }) }); // dash press while airborne
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.dashing).toBe(false);
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.dashCooldownMs).toBe(0); // ignored outright, not even queued

    const before = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position.z;
    tick(sim, 0.15, input({ ...NORTH, jumpHeld: true }));
    const after = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position.z;
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
    sim.applyImpact(DEFAULT_CHARACTER_ID, { x: IMPACT_STAGGER_MIN - 1, y: 0, z: 0 });
    sim.tick({ [DEFAULT_CHARACTER_ID]: IDLE_INPUTS });
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.motionState).toBe("Controlled");
  });

  it("staggers on a medium Impact — stays upright, walks slower, recovers", () => {
    const sim = standing();
    sim.applyImpact(DEFAULT_CHARACTER_ID, { x: (IMPACT_STAGGER_MIN + IMPACT_RAGDOLL_MIN) / 2, y: 0, z: 0 });
    sim.tick({ [DEFAULT_CHARACTER_ID]: NORTH });
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.motionState).toBe("Stagger");
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.bones.length).toBe(0); // no ragdoll body

    const staggerZ0 = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position.z;
    tick(sim, 0.2, NORTH);
    const staggerTravel = Math.abs(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position.z - staggerZ0);
    expect(staggerTravel).toBeLessThan(WALK_SPEED * 0.2 * 0.6); // dampened

    tickUntilControlled(sim);
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.motionState).toBe("Controlled");
  });

  it("ragdolls on a hard Impact and shows 11 bones", () => {
    const sim = standing();
    sim.applyImpact(DEFAULT_CHARACTER_ID, { x: IMPACT_RAGDOLL_MIN + 5, y: 3, z: 0 });
    sim.tick({ [DEFAULT_CHARACTER_ID]: IDLE_INPUTS });
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.motionState).toBe("Ragdoll");
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.bones.length).toBe(11);
  });

  it("reports the ragdoll's own velocity, not zero, while Ragdoll (ticket 08 follow-up)", () => {
    // The capsule's velocity is zeroed the instant Ragdoll begins, but a
    // reconciling client needs a real launch to hand its own local ragdoll on
    // a forced Bump snap — reporting zero here would always flop it limply
    // regardless of how hard the hit was.
    const sim = standing();
    sim.applyImpact(DEFAULT_CHARACTER_ID, { x: IMPACT_RAGDOLL_MIN + 5, y: 3, z: 0 });
    sim.tick({ [DEFAULT_CHARACTER_ID]: IDLE_INPUTS });
    const snap = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!;
    expect(snap.motionState).toBe("Ragdoll");
    expect(Math.hypot(snap.velocity.x, snap.velocity.y, snap.velocity.z)).toBeGreaterThan(0.5);
  });

  it("the ragdoll does not explode — bones stay near the Character and finite", () => {
    const sim = standing();
    const origin = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;
    sim.applyImpact(DEFAULT_CHARACTER_ID, { x: IMPACT_RAGDOLL_MIN + 4, y: 4, z: 0 });
    for (let i = 0; i < 90; i += 1) {
      sim.tick({ [DEFAULT_CHARACTER_ID]: IDLE_INPUTS });
      for (const b of sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.bones) {
        expect(Number.isFinite(b.position.x + b.position.y + b.position.z)).toBe(true);
        expect(Math.hypot(b.position.x - origin.x, b.position.z - origin.z)).toBeLessThan(12);
      }
    }
  });

  it("gets back up and returns to Controlled near where it fell", () => {
    const sim = standing();
    const fellAt = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;
    sim.applyImpact(DEFAULT_CHARACTER_ID, { x: IMPACT_RAGDOLL_MIN + 3, y: 3, z: 0 });
    tickUntilControlled(sim, 500);

    const back = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.motionState).toBe("Controlled");
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.bones.length).toBe(0);
    expect(back.y - CAPSULE_BOTTOM_OFFSET).toBeCloseTo(0, 0); // standing on the ground again
    expect(Math.hypot(back.x - fellAt.x, back.z - fellAt.z)).toBeLessThan(6);
  });

  it("caps ragdoll time even if it never settles (RAGDOLL_MAX_MS)", () => {
    const sim = standing();
    sim.applyImpact(DEFAULT_CHARACTER_ID, { x: IMPACT_RAGDOLL_MIN, y: 1, z: 0 });
    tick(sim, RAGDOLL_MAX_MS / 1000 + 0.2);
    // it must have left Ragdoll (into GettingUp or already Controlled)
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.motionState).not.toBe("Ragdoll");
  });

  it("the camera-follow point never jumps at the Ragdoll → GettingUp handoff", () => {
    const sim = standing();
    sim.applyImpact(DEFAULT_CHARACTER_ID, { x: IMPACT_RAGDOLL_MIN + 3, y: 4, z: 0 });
    let prev = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;
    let prevRespawnCount = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.respawnCount;
    let maxStep = 0;
    for (let i = 0; i < 400; i += 1) {
      sim.tick({ [DEFAULT_CHARACTER_ID]: IDLE_INPUTS });
      const c = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!;
      if (c.respawnCount === prevRespawnCount) {
        maxStep = Math.max(maxStep, Math.hypot(c.position.x - prev.x, c.position.y - prev.y, c.position.z - prev.z));
      }
      prev = c.position;
      prevRespawnCount = c.respawnCount;
      if (c.motionState === "Controlled" && i > 20) break;
    }
    expect(maxStep).toBeLessThan(0.35); // no ~0.7 pop, no discontinuity
  });

  it("dampens jump and dash while Staggered, not just walking", () => {
    const sim = standing();
    sim.applyImpact(DEFAULT_CHARACTER_ID, { x: (IMPACT_STAGGER_MIN + IMPACT_RAGDOLL_MIN) / 2, y: 0, z: 0 });
    sim.tick({ [DEFAULT_CHARACTER_ID]: input({ jumpHeld: true, dashHeld: true }) });
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.motionState).toBe("Stagger");
    const y0 = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position.y;

    // hammer jump+dash while staggered — the Character should barely leave the ground
    for (let i = 0; i < 4; i += 1) {
      sim.tick({ [DEFAULT_CHARACTER_ID]: input({ jumpHeld: false, dashHeld: false }) });
      sim.tick({ [DEFAULT_CHARACTER_ID]: input({ ...NORTH, jumpHeld: true, dashHeld: true }) });
    }
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position.y - y0).toBeLessThan(0.4); // no real jump
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
      sim.tick({ [DEFAULT_CHARACTER_ID]: IDLE_INPUTS });
      if (sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.motionState !== "Controlled") {
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
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.motionState).toBe("Controlled");
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

  it("a ragdoll flung into a Prop crumples against it instead of passing through (ticket 08)", () => {
    const box = {
      shape: { kind: "box" as const, halfExtents: { x: 0.6, y: 0.6, z: 0.6 } },
      center: { x: 0, y: 0.6, z: -2 }, // ~2 units north of spawn
    };
    const sim = new RapierSimulation({ spawn: RESTING_SPAWN, statics: [GROUND], props: [box] });
    tick(sim, 0.5);
    // Dash north into the box — a dash-crash ragdolls the Character.
    sim.tick({ [DEFAULT_CHARACTER_ID]: input({ moveDirection: { x: 0, y: 0, z: -1 }, dashHeld: true }) });
    tick(sim, 2, input({ moveDirection: { x: 0, y: 0, z: -1 } }));

    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.motionState).not.toBe("Controlled"); // it ragdolled
    // Without ragdoll-vs-Prop collision the ragdoll rockets clean past the box
    // (several units downrange); with it, it piles up around the box.
    const pelvisZ = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position.z;
    expect(pelvisZ).toBeGreaterThan(-4);
  });
});

describe("RapierSimulation — client Props are pinned obstacles, never predicted (ticket 06, ADR 0016)", () => {
  const airborneProp = {
    shape: { kind: "box" as const, halfExtents: { x: 0.4, y: 0.4, z: 0.4 } },
    center: { x: 6, y: 5, z: 0 }, // well above the ground, so gravity is obvious if it simulates
  };
  const serverPose = (pos: { x: number; y: number; z: number }) => ({
    position: pos,
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    atRest: false,
  });

  it("pins a Prop to the snapshot pose — never simulates it (no gravity)", () => {
    const sim = new RapierSimulation({ spawn: RESTING_SPAWN, statics: [GROUND], props: [airborneProp] });
    sim.syncPropsToSnapshot([serverPose({ x: 6, y: 5, z: 0 })]);

    tick(sim, 2); // would fall ~metres under gravity if simulated

    const p = sim.snapshot().props[0]!.position;
    expect(p.y).toBeCloseTo(5, 3);
    expect(p.x).toBeCloseTo(6, 3);
  });

  it("follows a moving snapshot pose exactly", () => {
    const sim = new RapierSimulation({ spawn: RESTING_SPAWN, statics: [GROUND], props: [airborneProp] });
    for (let step = 0; step < 5; step += 1) {
      sim.syncPropsToSnapshot([serverPose({ x: 6 + step, y: 5, z: 0 })]);
      sim.tick({});
      expect(sim.snapshot().props[0]!.position.x).toBeCloseTo(6 + step, 3);
    }
  });

  it("is a solid obstacle the local player slides against, but the player's push never moves it locally (ADR 0016)", () => {
    const groundProp = {
      shape: { kind: "box" as const, halfExtents: { x: 0.4, y: 0.4, z: 0.4 } },
      center: { x: 0, y: 0.4, z: -1.5 }, // on the ground, north of spawn
    };
    const sim = new RapierSimulation({ spawn: RESTING_SPAWN, statics: [GROUND], props: [groundProp] });
    sim.syncPropsToSnapshot([serverPose(groundProp.center)]);
    tick(sim, 0.5);

    const startZ = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position.z;
    for (let i = 0; i < 40; i += 1) {
      sim.syncPropsToSnapshot([serverPose(groundProp.center)]); // server: Prop hasn't moved
      sim.tick({ [DEFAULT_CHARACTER_ID]: NORTH });
    }

    // The Prop is exactly where the server put it — the local push did nothing to it.
    const prop = sim.snapshot().props[0]!.position;
    expect(prop.x).toBeCloseTo(groundProp.center.x, 3);
    expect(prop.z).toBeCloseTo(groundProp.center.z, 3);
    // ...and it blocked the player: they didn't walk through to the far side.
    const moverZ = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position.z;
    expect(moverZ).toBeLessThan(startZ); // did advance toward it
    expect(moverZ).toBeGreaterThan(groundProp.center.z + 0.5); // but stopped short, not through
  });

  it("a Prop re-pinned every tick to an advancing pose stays a smooth obstacle — the pushing player tracks it, no per-snapshot sawtooth (main.ts's per-frame prop pin)", () => {
    const groundProp = {
      shape: { kind: "box" as const, halfExtents: { x: 0.4, y: 0.4, z: 0.4 } },
      center: { x: 0, y: 0.4, z: -1.2 },
    };
    const sim = new RapierSimulation({ spawn: RESTING_SPAWN, statics: [GROUND], props: [groundProp] });
    sim.syncPropsToSnapshot([serverPose(groundProp.center)]);
    tick(sim, 0.5);

    // The server pushes the box north (−z) a little each tick; the client
    // re-pins it every tick from that (interpolated) pose while the player
    // walks north into it.
    let propZ = groundProp.center.z;
    let prevGap = Infinity;
    for (let i = 0; i < 50; i += 1) {
      propZ -= 0.06;
      sim.syncPropsToSnapshot([serverPose({ x: 0, y: 0.4, z: propZ })]);
      sim.tick({ [DEFAULT_CHARACTER_ID]: NORTH });
      const gap = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position.z - propZ;
      // The player stays a roughly constant short distance behind the moving
      // box every tick — never lurching (the sawtooth would show as the gap
      // swinging wide then snapping closed).
      if (i > 15) expect(Math.abs(gap - prevGap)).toBeLessThan(0.08);
      prevGap = gap;
    }
    // And it did follow the box north the whole way, not get stuck at the start.
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position.z).toBeLessThan(-1.5);
  });

  it("does not touch Props on the server (no sync calls) — they stay fully dynamic", () => {
    const sim = new RapierSimulation({ spawn: RESTING_SPAWN, statics: [GROUND], props: [airborneProp] });
    tick(sim, 1.5);
    expect(sim.snapshot().props[0]!.position.y).toBeLessThan(4); // fell under gravity
  });

  it("a moving Prop's snapshot carries velocity; a settled one is atRest with no velocity (ADR 0022)", () => {
    const sim = new RapierSimulation({ spawn: RESTING_SPAWN, statics: [GROUND], props: [airborneProp] });
    sim.tick({}); // one step — the box is now falling
    const falling = sim.snapshot().props[0]!;
    expect(falling.atRest).toBe(false);
    expect(falling.velocity).toBeDefined();
    expect(Math.abs(falling.velocity!.y)).toBeGreaterThan(0);

    tick(sim, 8); // land and settle to sleep
    const settled = sim.snapshot().props[0]!;
    expect(settled.atRest).toBe(true);
    expect(settled.velocity).toBeUndefined();
    expect(settled.angularVelocity).toBeUndefined();
  });
});

describe("RapierSimulation — dash into a wall", () => {
  const WALL: Box = { center: { x: 3, y: 1, z: 0 }, halfExtents: { x: 0.5, y: 1, z: 5 } };

  it("ragdolls the Character when a dash is blocked by a wall", () => {
    const sim = new RapierSimulation({ spawn: RESTING_SPAWN, statics: [GROUND, WALL] });
    tick(sim, 0.5); // settle
    sim.tick({ [DEFAULT_CHARACTER_ID]: input({ moveDirection: { x: 1, y: 0, z: 0 }, dashHeld: true }) }); // dash toward the wall

    let ragdolled = false;
    for (let i = 0; i < 20; i += 1) {
      sim.tick({ [DEFAULT_CHARACTER_ID]: input({ moveDirection: { x: 1, y: 0, z: 0 } }) });
      if (sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.motionState === "Ragdoll") {
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
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.motionState).toBe("Controlled");
  });

  it("a dash-wall Ragdoll advances ragdollEpoch and records cause DashWall (ADR 0023)", () => {
    const sim = new RapierSimulation({ spawn: RESTING_SPAWN, statics: [GROUND, WALL] });
    tick(sim, 0.5);
    sim.tick({ [DEFAULT_CHARACTER_ID]: input({ moveDirection: { x: 1, y: 0, z: 0 }, dashHeld: true }) });
    tick(sim, 1, input({ moveDirection: { x: 1, y: 0, z: 0 } }));

    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.motionState).toBe("Ragdoll");
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.ragdollEpoch).toBe(1);
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.ragdollCause).toBe("DashWall");
  });

  it("does not ragdoll from a wall hit right at the start of the build — only once fast enough", () => {
    // Wall close enough to hit on the very first dash tick, while speed is
    // still near zero (the build has barely started) — should just block,
    // same as an ordinary walk, not force Ragdoll.
    const closeWall: Box = { center: { x: 1, y: 1, z: 0 }, halfExtents: { x: 0.5, y: 1, z: 5 } };
    const sim = new RapierSimulation({ spawn: RESTING_SPAWN, statics: [GROUND, closeWall] });
    tick(sim, 0.5);
    sim.tick({ [DEFAULT_CHARACTER_ID]: input({ moveDirection: { x: 1, y: 0, z: 0 }, dashHeld: true }) }); // dash press, contacts the wall immediately
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.motionState).toBe("Controlled");
  });
});

describe("RapierSimulation — client/server dash-wall knockdown desync (2026-09 playtest, ADR 0015)", () => {
  const WALL: Box = { center: { x: 3, y: 1, z: 0 }, halfExtents: { x: 0.5, y: 1, z: 5 } };
  const EAST = input({ moveDirection: { x: 1, y: 0, z: 0 } });
  const DASH_EAST = input({ moveDirection: { x: 1, y: 0, z: 0 }, dashHeld: true });
  const isDownState = (m: string) => m === "Ragdoll" || m === "GettingUp";
  const dist = (a: { x: number; y: number; z: number }, b: typeof a) =>
    Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

  interface DashTraceStep {
    client: string;
    server: string;
    clientPos: { x: number; y: number; z: number };
    serverPos: { x: number; y: number; z: number };
  }

  /**
   * A faithful miniature of `apps/client/src/main.ts`'s predict → send →
   * reconcile loop, run entirely against two real `RapierSimulation`s with a
   * fixed input latency — no network, no browser, deterministic. `server` is
   * the authority (`authoritative` default `true`); `client` is what a player
   * actually sees (`authoritative: false`, ADR 0015 — never trusts its own
   * settle-check to end a knockdown). `dashInput` presses dash at `dashStep`
   * (idle/hold `East` otherwise) — a caller can angle it to hit the wall
   * off-centre. Returns each tick's motionState and position on both sides.
   */
  const runClientServerDash = (
    latencyTicks: number,
    steps: number,
    dashInput: SimInputs = DASH_EAST,
    dashStep = 10,
  ): DashTraceStep[] => {
    const server = new RapierSimulation({ spawn: RESTING_SPAWN, statics: [GROUND, WALL] });
    const client = new RapierSimulation({ spawn: RESTING_SPAWN, statics: [GROUND, WALL], authoritative: false });

    const clientInputs: { tick: number; input: SimInputs }[] = [];
    const positionHistory = new Map<number, { x: number; y: number; z: number }>();
    let clientTick = 0;
    let serverIdx = -1;
    const trace: DashTraceStep[] = [];

    for (let step = 0; step < steps; step += 1) {
      // Client predicts one tick, exactly like main.ts's fixed-timestep loop
      // (main.ts:304-319). A single dash press toward the wall at `dashStep`,
      // held East afterward — no further dash attempts, so nothing but the
      // reconcile loop itself can change the outcome from here.
      clientTick += 1;
      const cmd = step === dashStep ? dashInput : EAST;
      clientInputs.push({ tick: clientTick, input: cmd });
      client.tick({ [DEFAULT_CHARACTER_ID]: cmd });
      positionHistory.set(clientTick, { ...client.snapshot().characters[DEFAULT_CHARACTER_ID]!.position });

      // Server consumes the input `latencyTicks` behind the client — ordinary
      // network/processing latency, no jitter or loss needed.
      if (step >= latencyTicks) serverIdx += 1;
      const serverInput = serverIdx >= 0 ? clientInputs[serverIdx]!.input : IDLE_INPUTS;
      server.tick({ [DEFAULT_CHARACTER_ID]: serverInput });
      const acked = serverIdx + 1; // ~ server.lastInputTick
      const s = server.snapshot().characters[DEFAULT_CHARACTER_ID]!;

      // ---- main.ts's reconcile(), post-ADR-0015 ----
      const c = client.snapshot().characters[DEFAULT_CHARACTER_ID]!;
      const serverDown = isDownState(s.motionState);
      const localDown = isDownState(c.motionState);
      const predictedAtAck = positionHistory.get(acked);
      const positionError = predictedAtAck ? dist(predictedAtAck, s.position) : Infinity;
      const needsCorrection =
        serverDown || // authority says down — always sync (ADR 0015)
        localDown || // we think we're down but the authority doesn't — always resync
        s.motionState !== c.motionState ||
        positionError > 0.2;

      if (needsCorrection) {
        client.reconcileCharacter(DEFAULT_CHARACTER_ID, s);
        if (!serverDown) {
          const unacked = clientInputs.filter((e) => e.tick > acked);
          const replayed = client.replayLocalCharacter(DEFAULT_CHARACTER_ID, unacked.map((e) => e.input));
          positionHistory.clear();
          unacked.forEach((e, i) => positionHistory.set(e.tick, replayed[i]!));
        } else {
          positionHistory.clear();
        }
      }

      const c2 = client.snapshot().characters[DEFAULT_CHARACTER_ID]!;
      trace.push({ client: c2.motionState, server: s.motionState, clientPos: c2.position, serverPos: s.position });
    }
    return trace;
  };

  it(
    "brings the client down while the server is authoritatively Ragdolled from a wall crash the client " +
      "mispredicted as merely blocked — instead of leaving it walking around for the whole episode (regression " +
      "test for the 2026-09 playtest desync: server tick=725 lastInputTick=433 Ragdoll, client stayed Controlled)",
    () => {
      const trace = runClientServerDash(6, 150);

      // Sanity: this run actually exercises the bug precondition — the
      // *server* ran the full Ragdoll → GettingUp → Controlled episode, and
      // the client's own prediction genuinely missed the crash (never itself
      // called `beginRagdoll` for it) — this isn't passing because the client
      // happened to predict the hit too.
      expect(trace.some((t) => t.server === "Ragdoll")).toBe(true);
      expect(trace.some((t) => t.server === "GettingUp")).toBe(true);
      expect(trace.at(-1)?.server).toBe("Controlled");
      expect(trace.some((t) => t.client === "Ragdoll" && t.server === "Controlled")).toBe(false);

      // The property this whole netcode model is supposed to guarantee (ADR
      // 0015): while the server has the Character authoritatively down, the
      // client must show it down too — never a Character standing and
      // walking around on one screen while the authority has it face-down on
      // the other. Before ADR 0015 this failed: `reconcileCharacter` only
      // forced Ragdoll on a rising `bumpSeq`, and a dash-into-wall knockdown
      // never advances one by design (ticket 08) — so a client that mispredicted
      // its own wall crash (exactly what the ordinary `RECONCILE_POSITION_ERROR`
      // correction causes here, mid dash build-up) had no way to ever accept
      // the server's Ragdoll. Now `reconcileTo`'s down branch is unconditional.
      const clientWentDownWithServer = trace.some((t) => t.server === "Ragdoll" && t.client !== "Controlled");
      expect(clientWentDownWithServer).toBe(true);
    },
  );

  it(
    "does not correct the local prediction's own position while GettingUp, unlike Ragdoll's snapRootTo — " +
      "documents why main.ts must render the local Character from the server snapshot while down, not from " +
      "here, once the server has confirmed the knockdown (the angled-hit playtest glitch)",
    () => {
      const sim = new RapierSimulation({ spawn: RESTING_SPAWN, statics: [GROUND], authoritative: false });
      sim.applyImpact(DEFAULT_CHARACTER_ID, { x: 0, y: 3, z: 12 });
      tick(sim, 0.1);
      expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.motionState).toBe("Ragdoll");

      // The server has moved on to GettingUp — entering it here only updates
      // the state, not the position (there's no ragdoll body left active for
      // `reconcileTo` to `snapRootTo` once `beginGettingUp` deactivates it).
      const gettingUp = (position: { x: number; y: number; z: number }) => ({
        position,
        velocity: { x: 0, y: 0, z: 0 },
        grounded: false,
        motionState: "GettingUp" as const,
        dashCooldownMs: 0,
      });
      sim.reconcileCharacter(DEFAULT_CHARACTER_ID, gettingUp({ x: 5, y: RESTING_SPAWN.y, z: 5 }));
      const afterEntry = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;

      // A further server report during the same GettingUp, at a position
      // that's drifted further still (an off-centre knockdown settles
      // differently on each machine — ticket 09's known predicted-ragdoll
      // jitter, more visible on a glancing/angled wall hit than a square
      // one) — this is a documented no-op here, not a bug in this file; the
      // fix lives in what `main.ts` chooses to render, not in reconciling
      // this position harder.
      sim.reconcileCharacter(DEFAULT_CHARACTER_ID, gettingUp({ x: 8, y: RESTING_SPAWN.y, z: 8 }));
      const afterFurtherDrift = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;

      expect(afterFurtherDrift.x).toBeCloseTo(afterEntry.x, 1);
      expect(afterFurtherDrift.z).toBeCloseTo(afterEntry.z, 1);
    },
  );
});

describe("RapierSimulation — Character collection (ticket 01)", () => {
  it("holds exactly the default Character until another is added", () => {
    const sim = new RapierSimulation({ spawn: RESTING_SPAWN, statics: [GROUND] });
    expect(Object.keys(sim.snapshot().characters)).toEqual([DEFAULT_CHARACTER_ID]);
  });

  it("adds a second Character at its own spawn, alongside the first", () => {
    const sim = new RapierSimulation({ spawn: RESTING_SPAWN, statics: [GROUND] });
    const otherSpawn = { x: 5, y: CAPSULE_BOTTOM_OFFSET + 0.1, z: 5 };
    sim.addCharacter("other", otherSpawn);

    const snapshot = sim.snapshot();
    expect(Object.keys(snapshot.characters).sort()).toEqual([DEFAULT_CHARACTER_ID, "other"]);
    const other = snapshot.characters["other"]!.position;
    expect(other.x).toBeCloseTo(otherSpawn.x, 5);
    expect(other.y).toBeCloseTo(otherSpawn.y, 5);
    expect(other.z).toBeCloseTo(otherSpawn.z, 5);
    const mine = snapshot.characters[DEFAULT_CHARACTER_ID]!.position;
    expect(mine.x).toBeCloseTo(RESTING_SPAWN.x, 5);
    expect(mine.y).toBeCloseTo(RESTING_SPAWN.y, 5);
    expect(mine.z).toBeCloseTo(RESTING_SPAWN.z, 5);
  });

  it("removes a Character by ID, leaving the rest of the collection untouched", () => {
    const sim = new RapierSimulation({ spawn: RESTING_SPAWN, statics: [GROUND] });
    sim.addCharacter("other", { x: 5, y: CAPSULE_BOTTOM_OFFSET + 0.1, z: 5 });

    sim.removeCharacter("other");

    expect(Object.keys(sim.snapshot().characters)).toEqual([DEFAULT_CHARACTER_ID]);
  });

  it("keeps ticking and settling the default Character normally with an extra Character present", () => {
    const sim = new RapierSimulation({ spawn: { x: 0, y: 4, z: 0 }, statics: [GROUND] });
    sim.addCharacter("other", { x: 5, y: 4, z: 5 });

    tick(sim, 3);

    const snapshot = sim.snapshot();
    expect(snapshot.characters[DEFAULT_CHARACTER_ID]!.position.y - CAPSULE_BOTTOM_OFFSET).toBeCloseTo(0, 1);
    expect(snapshot.characters[DEFAULT_CHARACTER_ID]!.grounded).toBe(true);
  });
});

describe("RapierSimulation — reconcileCharacter + replay (ticket 05)", () => {
  const CONTROLLED = (position: { x: number; y: number; z: number }) => ({
    position,
    velocity: { x: 0, y: 0, z: 0 },
    grounded: true,
    motionState: "Controlled" as const,
    dashCooldownMs: 0,
  });

  it("snaps a locally-Controlled Character into Ragdoll the client never predicted (ADR 0015)", () => {
    const sim = new RapierSimulation({ spawn: RESTING_SPAWN, statics: [GROUND] });
    tick(sim, 0.5);
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.motionState).toBe("Controlled");

    sim.reconcileCharacter(DEFAULT_CHARACTER_ID, {
      position: { x: 1, y: RESTING_SPAWN.y, z: 1 },
      velocity: { x: 0, y: 0, z: 0 },
      grounded: false,
      motionState: "Ragdoll",
      dashCooldownMs: 0,
    });

    // Immediate — the discrete state is never delayed or smoothed (ADR 0013).
    const snap = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!;
    expect(snap.motionState).toBe("Ragdoll");
    expect(snap.bones.length).toBeGreaterThan(0);
    // ...and re-anchored near the server's reported pelvis, not left at the
    // stale predicted spot.
    expect(snap.position.x).toBeCloseTo(1, 1);
    expect(snap.position.z).toBeCloseTo(1, 1);
  });

  it("still snaps into Ragdoll for a server down-state even with no local prediction at all — the server is the sole authority (ADR 0015)", () => {
    const sim = new RapierSimulation({ spawn: RESTING_SPAWN, statics: [GROUND] });
    tick(sim, 0.5);

    // A knockdown the client's own prediction missed entirely (e.g. the
    // dash-wall-speed threshold sensitivity ADR 0015 documents) — there is no
    // `bumpSeq`/event id backing this any more, and there doesn't need to be.
    sim.reconcileCharacter(DEFAULT_CHARACTER_ID, {
      position: { x: 1, y: RESTING_SPAWN.y, z: 1 },
      velocity: { x: 0, y: 0, z: 0 },
      grounded: false,
      motionState: "Ragdoll",
      dashCooldownMs: 0,
    });

    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.motionState).toBe("Ragdoll");
  });

  it("advances straight to GettingUp when the server reports it, even though the client never predicted the Ragdoll episode at all", () => {
    const sim = new RapierSimulation({ spawn: RESTING_SPAWN, statics: [GROUND] });
    tick(sim, 0.5);

    // A connection stall or similar missed the whole Ragdoll snapshot for
    // this Character — the first report the client sees is already GettingUp.
    sim.reconcileCharacter(DEFAULT_CHARACTER_ID, {
      ...CONTROLLED(RESTING_SPAWN),
      motionState: "GettingUp",
    });

    // Not "still Controlled" (the old, superseded bumpSeq-gated behavior) and
    // not stuck in "Ragdoll" either — it advances the extra step, same as the
    // server did, from a synthesized flop at the server's reported position.
    const snap = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!;
    expect(snap.motionState).toBe("GettingUp");

    sim.tick({ [DEFAULT_CHARACTER_ID]: IDLE_INPUTS });
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.motionState).toBe("GettingUp");
  });

  it("restores the capsule to the server's position/velocity for a Controlled base", () => {
    const sim = new RapierSimulation({ spawn: RESTING_SPAWN, statics: [GROUND] });
    tick(sim, 0.5);

    sim.reconcileCharacter(DEFAULT_CHARACTER_ID, CONTROLLED({ x: 4, y: RESTING_SPAWN.y, z: -3 }));

    const p = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;
    expect(p.x).toBeCloseTo(4, 3);
    expect(p.z).toBeCloseTo(-3, 3);
  });

  it("brings a locally-Ragdolling Character back under control when the server says it never went down", () => {
    const sim = new RapierSimulation({ spawn: RESTING_SPAWN, statics: [GROUND] });
    tick(sim, 0.5);
    sim.applyImpact(DEFAULT_CHARACTER_ID, { x: 0, y: 3, z: 12 });
    tick(sim, 0.1);
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.motionState).toBe("Ragdoll");

    sim.reconcileCharacter(DEFAULT_CHARACTER_ID, CONTROLLED({ x: 0, y: RESTING_SPAWN.y, z: 0 }));
    sim.tick({ [DEFAULT_CHARACTER_ID]: IDLE_INPUTS });

    const snap = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!;
    expect(snap.motionState).toBe("Controlled");
    expect(snap.bones.length).toBe(0);
  });

  it("replays buffered inputs forward from the reconciled base, one shared step per input", () => {
    const sim = new RapierSimulation({ spawn: RESTING_SPAWN, statics: [GROUND] });
    tick(sim, 0.5);

    sim.reconcileCharacter(DEFAULT_CHARACTER_ID, CONTROLLED({ x: 0, y: RESTING_SPAWN.y, z: 0 }));
    const walkNorth: SimInputs = input({ moveDirection: { x: 0, y: 0, z: -1 } });
    const positions = sim.replayLocalCharacter(DEFAULT_CHARACTER_ID, Array<SimInputs>(10).fill(walkNorth));

    expect(positions).toHaveLength(10);
    // 10 ticks of walking north from z=0 moves clearly toward −z, monotonically.
    expect(positions[9]!.z).toBeLessThan(positions[0]!.z);
    expect(positions[9]!.z).toBeLessThan(-1);
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position.z).toBeCloseTo(positions[9]!.z, 5);
  });

  it("a Bump reconciled over several snapshots stays down and tracks the server without rubber-banding", () => {
    const sim = new RapierSimulation({ spawn: RESTING_SPAWN, statics: [GROUND] });
    tick(sim, 0.5);

    // Server keeps reporting Ragdoll at a pelvis drifting north as the body
    // slides; the client reconciles on every snapshot (ADR 0015: unconditional
    // while down, so repeating the same report every snapshot is idempotent).
    let serverZ = 0;
    for (let s = 0; s < 6; s += 1) {
      serverZ -= 0.15;
      sim.reconcileCharacter(DEFAULT_CHARACTER_ID, {
        position: { x: 0, y: RESTING_SPAWN.y - 0.5, z: serverZ },
        velocity: { x: 0, y: 0, z: 0 },
        grounded: false,
        motionState: "Ragdoll",
        dashCooldownMs: 0,
      });
      tick(sim, 0.1); // a few local ticks between snapshots

      const snap = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!;
      expect(snap.motionState).toBe("Ragdoll"); // never bounces back to Controlled
      expect(Math.abs(snap.position.z - serverZ)).toBeLessThan(0.6); // stays near the server
    }
  });

  it("syncTick realigns the tick counter so replay runs against the server's Spinner phase", () => {
    const sim = new RapierSimulation({
      spawn: RESTING_SPAWN,
      statics: [GROUND],
      spinners: [{ center: { x: 0, y: 0, z: 8 }, armLength: 2, halfHeight: 0.4, armRadius: 0.3, angularSpeed: 4 }],
    });
    tick(sim, 2); // localSim tick counter now well ahead of a fresh server

    sim.reconcileCharacter(DEFAULT_CHARACTER_ID, CONTROLLED(RESTING_SPAWN));
    sim.syncTick(5); // server is only 5 ticks in
    // Replay runs without throwing and the Character ends where the inputs put it.
    const positions = sim.replayLocalCharacter(DEFAULT_CHARACTER_ID, Array<SimInputs>(5).fill(IDLE_INPUTS));
    expect(positions).toHaveLength(5);
    expect(sim.snapshot().tick).toBe(10); // 5 (synced) + 5 (replayed)
  });

  it("replay runs Fall detection — a replayed step off the kill plane respawns instead of recording an under-floor position", () => {
    const sim = new RapierSimulation({
      spawn: { x: 0, y: CAPSULE_BOTTOM_OFFSET + 0.1, z: 0 },
      statics: [{ center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 1.5, y: 0.5, z: 1.5 } }], // small platform
      killPlaneY: -6,
    });
    tick(sim, 0.3);

    sim.reconcileCharacter(DEFAULT_CHARACTER_ID, CONTROLLED({ x: 0, y: CAPSULE_BOTTOM_OFFSET + 0.1, z: 0 }));
    // Walk south off the edge and keep going — enough replayed ticks to fall past the kill plane.
    const walkSouth: SimInputs = input({ moveDirection: { x: 0, y: 0, z: 1 } });
    sim.replayLocalCharacter(DEFAULT_CHARACTER_ID, Array<SimInputs>(60).fill(walkSouth));

    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.fallCount).toBeGreaterThan(0);
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position.y).toBeGreaterThan(-6);
  });
});

describe("RapierSimulation — Character-to-Character Bump (ticket 04)", () => {
  const MOVER = DEFAULT_CHARACTER_ID;
  const TARGET = "target";
  const onGround = (z: number) => ({ x: 0, y: CAPSULE_BOTTOM_OFFSET + 0.1, z });

  /** Mover at z=0, target a little to the north (−z); both settled on the ground. */
  const twoCharacters = (gap: number): RapierSimulation => {
    const sim = new RapierSimulation({ spawn: onGround(0), statics: [GROUND] });
    sim.addCharacter(TARGET, onGround(-gap));
    for (let n = 0; n < 10; n += 1) sim.tick({}); // settle both
    return sim;
  };

  const step = (sim: RapierSimulation, seconds: number, moverInput: SimInputs) => {
    for (let n = 0; n < Math.round(seconds * TICK_RATE_HZ); n += 1) {
      sim.tick({ [MOVER]: moverInput });
    }
  };

  it("makes two Characters solid — one cannot walk through the other", () => {
    const sim = twoCharacters(1);
    step(sim, 2, NORTH); // walk the mover straight at the target for 2s

    const mover = sim.snapshot().characters[MOVER]!.position;
    const target = sim.snapshot().characters[TARGET]!.position;
    // Blocked: centres never get closer than roughly two capsule radii.
    expect(mover.z - target.z).toBeGreaterThan(0.6);
  });

  it("a fast Dash into another player knocks THAT player down, and leaves the mover in control", () => {
    const sim = twoCharacters(3.5);
    step(sim, 0.9, input({ ...NORTH, dashHeld: true }));

    expect(sim.snapshot().characters[TARGET]!.motionState).toBe("Ragdoll");
    expect(sim.snapshot().characters[MOVER]!.motionState).toBe("Controlled");
  });

  it("advances the bumped player's ragdollEpoch with cause Bump, but not the mover's (ADR 0023)", () => {
    const sim = twoCharacters(3.5);
    expect(sim.snapshot().characters[TARGET]!.ragdollEpoch).toBe(0);

    step(sim, 0.9, input({ ...NORTH, dashHeld: true }));

    expect(sim.snapshot().characters[TARGET]!.ragdollEpoch).toBeGreaterThan(0);
    expect(sim.snapshot().characters[TARGET]!.ragdollCause).toBe("Bump");
    expect(sim.snapshot().characters[MOVER]!.ragdollEpoch).toBe(0);
  });

  it("an ordinary walking bump does not change the other player's state", () => {
    const sim = twoCharacters(0.9);
    step(sim, 1.5, NORTH);

    expect(sim.snapshot().characters[TARGET]!.motionState).toBe("Controlled");
  });

  it("is one-sided: a stationary player standing in the way is not knocked down by the mover walking into them, and never bumps the mover", () => {
    const sim = twoCharacters(0.9);
    step(sim, 1.5, NORTH);

    expect(sim.snapshot().characters[MOVER]!.motionState).toBe("Controlled");
    expect(sim.snapshot().characters[TARGET]!.motionState).toBe("Controlled");
  });

  it("does not Bump through a mirror capsule — mirrors are movement obstacles only, never Impact targets (ADR 0012)", () => {
    const sim = new RapierSimulation({ spawn: onGround(0), statics: [GROUND] });
    for (let n = 0; n < 10; n += 1) sim.tick({});
    sim.syncMirrorCharacters({ other: onGround(-3.5) });

    step(sim, 0.9, input({ ...NORTH, dashHeld: true }));

    // The local player dashed into the mirror: solid (blocked), but no Bump
    // state change is ever predicted locally — the mover stays Controlled and
    // there is no second real Character to have gone down.
    expect(sim.snapshot().characters[MOVER]!.motionState).toBe("Controlled");
    expect(Object.keys(sim.snapshot().characters)).toEqual([MOVER]);
  });

  it("drops a mirror when it is no longer in the synced set", () => {
    const sim = new RapierSimulation({ spawn: onGround(0), statics: [GROUND] });
    sim.syncMirrorCharacters({ a: onGround(-3), b: onGround(3) });
    sim.syncMirrorCharacters({ a: onGround(-3) });
    sim.tick({});
    // b's capsule is gone: the mover can now walk through where it was.
    step(sim, 2, input({ moveDirection: { x: 0, y: 0, z: 1 } }));
    expect(sim.snapshot().characters[MOVER]!.position.z).toBeGreaterThan(3);
  });

  it("a mirror re-synced every tick from a moving position stays solid — the local player piles up behind it, never through it (main.ts's per-frame mirror refresh)", () => {
    const sim = new RapierSimulation({ spawn: onGround(0), statics: [GROUND] });
    for (let n = 0; n < 10; n += 1) sim.tick({});

    // The other player is ahead of the local player and moving the same way,
    // slower; their mirror is refreshed every tick from where they'd be drawn.
    const SOUTH = input({ moveDirection: { x: 0, y: 0, z: 1 } });
    let mirrorZ = 1.5;
    for (let n = 0; n < 90; n += 1) {
      mirrorZ += 0.08; // slower than the mover's ~0.2 u/tick
      sim.syncMirrorCharacters({ other: onGround(mirrorZ) });
      sim.tick({ [MOVER]: SOUTH });
    }

    // The mover caught up and is blocked right behind the capsule — never
    // tunnels past it in the gap between position updates.
    const moverZ = sim.snapshot().characters[MOVER]!.position.z;
    expect(moverZ).toBeLessThan(mirrorZ - 0.4); // did not overtake
    expect(moverZ).toBeGreaterThan(mirrorZ - 1.3); // did close the distance (isn't just left behind)
  });
});
