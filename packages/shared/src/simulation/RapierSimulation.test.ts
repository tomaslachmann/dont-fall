import { beforeAll, describe, expect, it } from "vitest";
import { orientBox, pointInOrientedBox, type Box, type OrientedBox } from "../math/box.js";
import { IDENTITY_QUAT, pitchQuat, yawQuat } from "../math/quat.js";
import { rotateVec3ByQuat } from "../math/vec3.js";
import {
  CAPSULE_BOTTOM_OFFSET,
  CAPSULE_RADIUS,
  DASH_COOLDOWN_MS,
  DASH_COOLDOWN_TICKS,
  DASH_DURATION_MS,
  DASH_SPEED,
  GROUND_STICK_SPEED,
  IMPACT_RAGDOLL_MIN,
  IMPACT_STAGGER_MIN,
  RAGDOLL_MAX_MS,
  SLIDE_INPUT_SCALE,
  SPEED_PAD_FADE_MS,
  SPEED_PAD_HOLD_MS,
  TICK_MS,
  TICK_RATE_HZ,
  WALK_SPEED,
} from "../tuning.js";
import { DEFAULT_SURFACE, SURFACES } from "../track/Surface.js";
import type { Checkpoint } from "./Checkpoint.js";
import { isDownMotionState } from "./CharacterStateMachine.js";
import { DEFAULT_CHARACTER_ID, RapierSimulation, initPhysics } from "./RapierSimulation.js";
import { needsCorrection } from "./reconcileGate.js";
import { IDLE_INPUTS, type SimInputs } from "./SimInputs.js";
import type { VolumeConfig } from "./Volume.js";

beforeAll(async () => {
  await initPhysics();
});

const GROUND: Box = { center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 20, y: 0.5, z: 20 } };
const RESTING_SPAWN = { x: 0, y: CAPSULE_BOTTOM_OFFSET + 0.1, z: 0 };

const input = (partial: Partial<SimInputs> = {}): SimInputs => ({ ...IDLE_INPUTS, ...partial });
const NORTH = input({ moveDirection: { x: 0, y: 0, z: -1 } });
const SOUTH = input({ moveDirection: { x: 0, y: 0, z: 1 } });
const SOUTH_DASH = input({ moveDirection: { x: 0, y: 0, z: 1 }, dashHeld: true });

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

});

describe("RapierSimulation — Surfaces (ticket 01, ADR 0036): the ground collider handle the character controller already reports, not a new scene query", () => {
  const MUD_FLOOR: Box = { center: { x: 0, y: -0.5, z: 5 }, halfExtents: { x: 10, y: 0.5, z: 5 } }; // world z in [0, 10]
  const DEFAULT_FLOOR: Box = { center: { x: 0, y: -0.5, z: -5 }, halfExtents: { x: 10, y: 0.5, z: 5 } }; // world z in [-10, 0]

  it("caps top speed while standing on mud", () => {
    const sim = new RapierSimulation({
      spawn: { x: 0, y: CAPSULE_BOTTOM_OFFSET + 0.1, z: 8 },
      statics: [MUD_FLOOR],
      staticSurfaces: ["mud"],
    });
    tick(sim, 0.5); // settle, and let the one-tick Surface lag catch up
    const before = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;
    tick(sim, 1, NORTH);
    const after = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;
    const traveled = before.z - after.z;
    expect(traveled).toBeCloseTo(WALK_SPEED * SURFACES.mud!.topSpeedMultiplier, 0);
    expect(traveled).toBeLessThan(WALK_SPEED * 0.75); // clearly capped, not rounding noise
  });

  it("restores full speed once the Character walks off mud onto a default-Surface floor", () => {
    const sim = new RapierSimulation({
      spawn: { x: 0, y: CAPSULE_BOTTOM_OFFSET + 0.1, z: 8 },
      statics: [MUD_FLOOR, DEFAULT_FLOOR],
      staticSurfaces: ["mud", DEFAULT_SURFACE],
    });
    tick(sim, 0.5);
    tick(sim, 4, NORTH); // cross from the mud floor (z > 0) onto the default one (z < 0)
    const onDefault = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;
    expect(onDefault.z).toBeLessThan(-2); // sanity: actually crossed the seam

    tick(sim, 0.5); // let the one-tick Surface lag catch up to "default" after crossing
    const before = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;
    tick(sim, 1, NORTH);
    const after = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;
    expect(before.z - after.z).toBeCloseTo(WALK_SPEED, 0);
  });

  it("a Character with no staticSurfaces config at all (every existing test/caller) walks at full WALK_SPEED — the default Surface is a true no-op", () => {
    const sim = new RapierSimulation({ spawn: RESTING_SPAWN, statics: [GROUND] });
    tick(sim, 0.5);
    const before = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;
    tick(sim, 1, NORTH);
    const after = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;
    expect(before.z - after.z).toBeCloseTo(WALK_SPEED, 0);
  });

  it("mud is re-expressed in grip terms too — its own grip stays full (1), reaching the capped target within the same single tick as before ticket 06 (ticket 01's own mud test, unchanged, already re-confirms the number; this locks down that grip:1 specifically is what makes it so)", () => {
    const sim = new RapierSimulation({
      spawn: { x: 0, y: CAPSULE_BOTTOM_OFFSET + 0.1, z: 8 },
      statics: [MUD_FLOOR],
      staticSurfaces: ["mud"],
    });
    tick(sim, 0.5);
    sim.tick({ [DEFAULT_CHARACTER_ID]: NORTH });
    const p0 = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;
    sim.tick({ [DEFAULT_CHARACTER_ID]: NORTH });
    const p1 = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;
    // Already at the mud-capped speed by the very next tick — full grip,
    // just a lower target, not a slow ramp toward it.
    expect((p0.z - p1.z) * TICK_RATE_HZ).toBeCloseTo(WALK_SPEED * SURFACES.mud!.topSpeedMultiplier, 0);
  });
});

describe("RapierSimulation — ice (ticket 06, ADR 0035/0036): grip multiplies both acceleration and drag, top speed untouched", () => {
  const ICE_FLOOR: Box = { center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 10, y: 0.5, z: 30 } };

  it("accelerates slowly on ice — noticeably below full WALK_SPEED shortly after starting from a standstill", () => {
    const sim = new RapierSimulation({
      spawn: { x: 0, y: CAPSULE_BOTTOM_OFFSET + 0.1, z: 10 },
      statics: [ICE_FLOOR],
      staticSurfaces: ["ice"],
    });
    tick(sim, 0.5); // settle, and let the one-tick Surface lag catch up
    const before = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;
    tick(sim, 0.3, NORTH); // a short burst — full grip would already be at WALK_SPEED throughout this
    const after = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;
    const speed = (before.z - after.z) / 0.3;
    expect(speed).toBeGreaterThan(0); // it does move...
    expect(speed).toBeLessThan(WALK_SPEED * 0.5); // ...but nowhere near full speed yet
  });

  it("eventually reaches full WALK_SPEED on ice, unchanged — \"ice makes you faster\" is the wrong intuition, but \"ice caps your speed\" would be just as wrong", () => {
    const sim = new RapierSimulation({
      spawn: { x: 0, y: CAPSULE_BOTTOM_OFFSET + 0.1, z: 10 },
      statics: [ICE_FLOOR],
      staticSurfaces: ["ice"],
    });
    tick(sim, 0.5);
    tick(sim, 4, NORTH); // long enough to approach the (near-zero-accel) target
    const before = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;
    tick(sim, 0.5, NORTH);
    const after = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;
    const speed = (before.z - after.z) / 0.5;
    expect(speed).toBeCloseTo(WALK_SPEED, 0); // top speed itself is exactly WALK_SPEED, same as full grip
  });

  it("slides past a turn on ice — releasing the original direction and pressing a new one doesn't reverse velocity the way full grip does; the Character keeps sliding in roughly the old direction for a while", () => {
    const sim = new RapierSimulation({
      spawn: { x: 0, y: CAPSULE_BOTTOM_OFFSET + 0.1, z: 20 },
      statics: [ICE_FLOOR],
      staticSurfaces: ["ice"],
    });
    tick(sim, 0.5);
    tick(sim, 3, NORTH); // build up real speed in -Z first
    const beforeTurn = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;

    // Now try to turn sideways (+X) — on full grip this reverses/redirects
    // velocity within a tick; on ice, residual -Z motion should still
    // clearly dominate immediately after the input change.
    const EAST = input({ moveDirection: { x: 1, y: 0, z: 0 } });
    sim.tick({ [DEFAULT_CHARACTER_ID]: EAST });
    const p0 = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;
    const stillSlidingZ = Math.abs(p0.z - beforeTurn.z);
    const newSidewaysX = Math.abs(p0.x - beforeTurn.x);
    expect(stillSlidingZ).toBeGreaterThan(newSidewaysX * 3); // still mostly going the old way, not the new one
  });
});

describe("RapierSimulation — tilted static floor (ADR 0034, ticket 01)", () => {
  // ~14.9°, comfortably under Rapier's default ~45° max slope-climb angle —
  // real, but not so steep a Character can't stand on it at all.
  const PITCH = 0.26;
  const plank = (): OrientedBox => ({
    center: { x: 0, y: 0, z: 0 },
    halfExtents: { x: 5, y: 0.1, z: 5 },
    rotation: pitchQuat(PITCH),
  });
  /** World Y of the plank's own local top surface at local Z `z` — ground truth, independent of RapierSimulation. */
  const surfaceYAt = (z: number): number => rotateVec3ByQuat({ x: 0, y: 0.1, z }, pitchQuat(PITCH)).y;

  const settleOn = (z: number): number => {
    const sim = new RapierSimulation({ statics: [plank()], spawn: { x: 0, y: surfaceYAt(z) + 3, z } });
    tick(sim, 3);
    return sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position.y;
  };

  it("is a real rotated collider, not a cosmetic label — a Character resting at one end of a pitched plank settles noticeably higher than at the other end", () => {
    // The old rotateBoxYaw90 trick could only ever produce a flat, axis-
    // aligned collider; this proves resting height actually tracks the
    // plank's true tilted surface, the way a real setRotation() collider
    // would (and a flat one couldn't).
    const restingNear = settleOn(3);
    const restingFar = settleOn(-3);
    const expectedGap = surfaceYAt(-3) - surfaceYAt(3); // ~1.54 units
    expect(expectedGap).toBeGreaterThan(1);
    expect(restingFar - restingNear).toBeGreaterThan(expectedGap - 0.4);
  });

  it("a Character can stand on a moderately tilted floor at all — Rapier's own (default, unconfigured) slope handling, not new movement code", () => {
    const sim = new RapierSimulation({ statics: [plank()], spawn: { x: 0, y: surfaceYAt(0) + 3, z: 0 } });
    tick(sim, 3);
    const character = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!;
    expect(character.grounded).toBe(true);
    expect(character.fallCount).toBe(0);
    // Settles near the plank's true local surface height, not falling through it.
    expect(character.position.y).toBeGreaterThan(surfaceYAt(0));
    expect(character.position.y).toBeLessThan(surfaceYAt(0) + 1);
  });
});

describe("RapierSimulation — ground-stick as a distance, via Rapier's own snap-to-ground (ticket 02, ADR 0037)", () => {
  // Steep enough that the old speed-based ground-stick reliably skipped (the
  // ticket's own spike measured this at both ~30° and ~40°, walking and
  // dashing) — a real regression guard, not just a happy-path smoke test.
  const PITCH = 0.524; // ~30°
  const ramp = (): OrientedBox => ({
    center: { x: 0, y: 0, z: 0 },
    halfExtents: { x: 5, y: 0.1, z: 15 },
    rotation: pitchQuat(PITCH),
  });
  // Spawn straight above the ramp's own local origin by rotating a *local*
  // offset before placing it — sidesteps ever needing to convert between the
  // ramp's local Z and a world Z at an arbitrary point along its slope, which
  // only agree near the plank's centre for a shallow pitch (exactly why the
  // describe block above stays close to z=0 at a shallow 14.9°).
  const spawnAboveCentre = (localClearance: number): { x: number; y: number; z: number } =>
    rotateVec3ByQuat({ x: 0, y: 0.1 + localClearance, z: 0 }, pitchQuat(PITCH));

  const remainsGroundedThroughout = (held: SimInputs, ticks: number): boolean => {
    const sim = new RapierSimulation({ statics: [ramp()], spawn: spawnAboveCentre(2) });
    tick(sim, 1); // settle at the ramp's centre before moving
    for (let i = 0; i < ticks; i += 1) {
      sim.tick({ [DEFAULT_CHARACTER_ID]: held });
      if (!sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.grounded) return false;
    }
    return true;
  };

  it("walks down the ramp without skipping into freefall", () => {
    expect(remainsGroundedThroughout(SOUTH, 40)).toBe(true);
  });

  it("dashes down the ramp without skipping into freefall — the case that used to collapse to ~5°", () => {
    expect(remainsGroundedThroughout(SOUTH_DASH, 20)).toBe(true);
  });

  it("still falls off a platform edge promptly — snap-to-ground doesn't stall the controller at a ledge", () => {
    const PLATFORM: Box = { center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 4, y: 0.5, z: 4 } };
    const sim = new RapierSimulation({ spawn: { x: 0, y: 1.5, z: 0 }, statics: [PLATFORM], killPlaneY: -8 });
    tick(sim, 0.5);
    // Geometric expectation: (0.5 clearance + 4 to the edge) / WALK_SPEED.
    const expectedEdgeTick = Math.round(((0.5 + 4) / WALK_SPEED) * TICK_RATE_HZ);
    let firstUngroundedTick = -1;
    for (let i = 0; i < expectedEdgeTick + 15 && firstUngroundedTick === -1; i += 1) {
      sim.tick({ [DEFAULT_CHARACTER_ID]: NORTH });
      if (!sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.grounded) firstUngroundedTick = i;
    }
    // A stall would show up as a delay past the geometric expectation; a
    // handful of ticks of slack absorbs settle/physics noise (observed: 1-3
    // ticks early/late across repeated runs), not a real multi-tick hold-back
    // (code review: the original +15/+10 tolerance was loose enough to still
    // pass through a real several-tick stall).
    expect(firstUngroundedTick).toBeGreaterThan(-1);
    expect(firstUngroundedTick).toBeLessThan(expectedEdgeTick + 5);
  });

  it("keeps reporting the Surface underfoot even on a tick where Rapier's own snap-to-ground corrects the Character without going through the collision list at all (code review — confirmed empirically: computedGrounded() can be true with zero qualifying computedCollision() entries)", () => {
    // Steep enough that this reliably exercises the snap-only path, but
    // still under ticket 03's WALKABLE_SLOPE_MAX_ANGLE (35°) — a walking,
    // not Sliding, scenario, since Sliding's own gravity-projected model
    // makes "stays under mud's capped WALK_SPEED" the wrong invariant to
    // check (it's supposed to accelerate). 34° is right at the edge of
    // where this reliably reproduces (code review, ticket 03): verified by
    // temporarily reverting the ticket-02 sticky fix and confirming this
    // exact test fails at 34° but not at 32-33° — a shallower angle would
    // silently stop testing the thing its own name claims to.
    const STEEP_PITCH = 0.593; // ~34°
    const mudRamp = (): OrientedBox => ({
      center: { x: 0, y: 0, z: 0 },
      halfExtents: { x: 5, y: 0.1, z: 15 },
      rotation: pitchQuat(STEEP_PITCH),
    });
    const spawn = rotateVec3ByQuat({ x: 0, y: 0.1 + 2, z: 0 }, pitchQuat(STEEP_PITCH));
    const sim = new RapierSimulation({ statics: [mudRamp()], staticSurfaces: ["mud"], spawn });
    tick(sim, 1); // settle at the ramp's centre

    let prev = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;
    const speeds: number[] = [];
    for (let i = 0; i < 30; i += 1) {
      sim.tick({ [DEFAULT_CHARACTER_ID]: SOUTH });
      const p = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;
      speeds.push(Math.hypot(p.z - prev.z, p.y - prev.y) * TICK_RATE_HZ);
      prev = p;
    }
    // Mud's speed cap (0.5×) should hold the whole descent — a leak back to
    // unmultiplied WALK_SPEED would show up as roughly double this envelope
    // (WALK_SPEED alone over a 45° slope is ~8.5 units/s of 3D distance).
    for (const speed of speeds.slice(5)) expect(speed).toBeLessThan(6); // well under the ~8.5 an uncapped leak would show
  });
});

describe("RapierSimulation — Sliding (ticket 03, M3.6, ADR 0037): the band between walkable and wall", () => {
  // WALKABLE_SLOPE_MAX_ANGLE is ~35°, the wall threshold (from
  // WALL_NORMAL_MAX_Y) is ~60° — these three pitches land cleanly inside
  // "walkable," "Sliding," and (for a later ticket, not tested here) "wall."
  const WALKABLE_PITCH = 0.349; // ~20°
  const SLIDING_PITCH = 0.785; // ~45°

  const ramp = (pitch: number): OrientedBox => ({
    center: { x: 0, y: 0, z: 0 },
    halfExtents: { x: 5, y: 0.1, z: 15 },
    rotation: pitchQuat(pitch),
  });
  // Spawn straight above the ramp's own local origin (see ticket 02's own
  // notes on why: avoids ever needing to convert between local and world Z).
  const spawnAboveCentre = (pitch: number, localClearance: number): { x: number; y: number; z: number } =>
    rotateVec3ByQuat({ x: 0, y: 0.1 + localClearance, z: 0 }, pitchQuat(pitch));

  it("stays Controlled (walks normally) on a shallow ramp under the walkable limit", () => {
    const sim = new RapierSimulation({ statics: [ramp(WALKABLE_PITCH)], spawn: spawnAboveCentre(WALKABLE_PITCH, 2) });
    tick(sim, 1);
    tick(sim, 1, SOUTH);
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.motionState).toBe("Controlled");
  });

  it("enters Sliding on a ramp steeper than walkable, and accelerates downhill under gravity", () => {
    const sim = new RapierSimulation({ statics: [ramp(SLIDING_PITCH)], spawn: spawnAboveCentre(SLIDING_PITCH, 2) });
    tick(sim, 1);
    sim.tick({ [DEFAULT_CHARACTER_ID]: IDLE_INPUTS }); // grounded, too-steep condition now true from last tick's contact
    sim.tick({ [DEFAULT_CHARACTER_ID]: IDLE_INPUTS }); // this tick's machine.tick() sees it
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.motionState).toBe("Sliding");

    // Accelerating, not a constant walk speed: distance covered in the next
    // 0.3s should be noticeably more than in the following 0.3s-shifted
    // window if it's truly speeding up under gravity.
    const p0 = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;
    tick(sim, 0.3, IDLE_INPUTS);
    const p1 = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;
    tick(sim, 0.3, IDLE_INPUTS);
    const p2 = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;
    const firstLeg = Math.hypot(p1.z - p0.z, p1.y - p0.y);
    const secondLeg = Math.hypot(p2.z - p1.z, p2.y - p1.y);
    expect(secondLeg).toBeGreaterThan(firstLeg);
  });

  it("Sliding applies only while grounded — falling above a too-steep Surface keeps full Controlled air control", () => {
    const sim = new RapierSimulation({
      statics: [ramp(SLIDING_PITCH)],
      spawn: { ...spawnAboveCentre(SLIDING_PITCH, 8) }, // well above the ramp, still airborne for a few ticks
    });
    sim.tick({ [DEFAULT_CHARACTER_ID]: IDLE_INPUTS });
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.grounded).toBe(false);
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.motionState).toBe("Controlled");
  });

  it("an Impact while Sliding sends the Character straight to Ragdoll, exactly as from Stagger", () => {
    const sim = new RapierSimulation({ statics: [ramp(SLIDING_PITCH)], spawn: spawnAboveCentre(SLIDING_PITCH, 2) });
    tick(sim, 1);
    sim.tick({ [DEFAULT_CHARACTER_ID]: IDLE_INPUTS });
    sim.tick({ [DEFAULT_CHARACTER_ID]: IDLE_INPUTS });
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.motionState).toBe("Sliding");

    sim.applyImpact(DEFAULT_CHARACTER_ID, { x: IMPACT_RAGDOLL_MIN + 3, y: 2, z: 0 });
    sim.tick({ [DEFAULT_CHARACTER_ID]: IDLE_INPUTS });
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.motionState).toBe("Ragdoll");
  });

  it("client prediction agrees with the server on Sliding — both derive it from the same resolved Track, no new message needed", () => {
    const config = { statics: [ramp(SLIDING_PITCH)], spawn: spawnAboveCentre(SLIDING_PITCH, 2), withDefaultCharacter: false };
    const server = new RapierSimulation(config);
    const client = new RapierSimulation({ ...config, authoritative: false });
    server.addCharacter(DEFAULT_CHARACTER_ID, config.spawn);
    client.addCharacter(DEFAULT_CHARACTER_ID, config.spawn);

    for (let i = 0; i < 45; i += 1) {
      const input = { [DEFAULT_CHARACTER_ID]: IDLE_INPUTS };
      server.tick(input);
      client.tick(input);
      expect(client.snapshot().characters[DEFAULT_CHARACTER_ID]!.motionState).toBe(
        server.snapshot().characters[DEFAULT_CHARACTER_ID]!.motionState,
      );
    }
    // Sanity: the agreement above wasn't vacuously "both always Controlled."
    expect(server.snapshot().characters[DEFAULT_CHARACTER_ID]!.motionState).toBe("Sliding");
  });

  it("steering while Sliding stays bounded — it blends toward the reduced walk target but never runs away past it (code review)", () => {
    // A much bigger, much deeper ramp than the other tests in this block —
    // this one needs to stay Sliding for several real seconds (long enough
    // for an *unbounded* integration bug to clearly separate from a bounded
    // one), which the other tests' compact ramp/kill-plane don't leave room
    // for on a 45° slope (gravity alone covers ~70 units in 3s).
    const bigRamp: OrientedBox = { center: { x: 0, y: 0, z: 0 }, halfExtents: { x: 5, y: 0.1, z: 80 }, rotation: pitchQuat(SLIDING_PITCH) };
    const sim = new RapierSimulation({ statics: [bigRamp], spawn: spawnAboveCentre(SLIDING_PITCH, 2), killPlaneY: -1000 });
    tick(sim, 1);
    sim.tick({ [DEFAULT_CHARACTER_ID]: IDLE_INPUTS });
    sim.tick({ [DEFAULT_CHARACTER_ID]: IDLE_INPUTS });
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.motionState).toBe("Sliding");

    // Pure sideways (world X) input: a pitch-only rotation never tilts the
    // slope's normal away from X=0, so gravity's projection onto X is always
    // exactly 0 here — X motion is *entirely* the steering contribution,
    // isolating it cleanly from the downhill gravity acceleration. Stops if
    // it ever does leave Sliding — once airborne it's correctly Controlled
    // again, with full, unblended input authority, which would otherwise
    // swamp this measurement with the *other* (already fully-tested)
    // movement model.
    const STEER = input({ moveDirection: { x: 1, y: 0, z: 0 } });
    let prevX = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position.x;
    let maxXSpeed = 0;
    for (let i = 0; i < 90; i += 1) {
      sim.tick({ [DEFAULT_CHARACTER_ID]: STEER });
      const character = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!;
      if (character.motionState !== "Sliding") break;
      maxXSpeed = Math.max(maxXSpeed, Math.abs(character.position.x - prevX) * TICK_RATE_HZ);
      prevX = character.position.x;
    }
    // The steering target is WALK_SPEED * SLIDE_INPUT_SCALE; a small margin
    // absorbs blend/settle noise, not runaway growth — the actual bug this
    // guards against grew well past double this within the same window.
    expect(maxXSpeed).toBeLessThan(WALK_SPEED * SLIDE_INPUT_SCALE * 1.3);
  });
});

describe("RapierSimulation — downhill faster, uphill slower (ticket 04, M3.6, ADR 0037)", () => {
  // A walkable-band pitch (under WALKABLE_SLOPE_MAX_ANGLE ~35°) — this ticket
  // is strictly about the walking model; Sliding's own gravity-projected
  // model is ticket 03's concern, already covered above.
  const PITCH = 0.262; // ~15°
  const ramp = (): OrientedBox => ({
    center: { x: 0, y: 0, z: 0 },
    halfExtents: { x: 5, y: 0.1, z: 20 },
    rotation: pitchQuat(PITCH),
  });
  // Positive PITCH: +Z is downhill, -Z is uphill (same convention
  // `movementVerbs.test.ts`'s own `slopeSpeedMultiplier` tests establish and
  // verify against this exact `pitchQuat` formula).
  const spawnAboveCentre = (localClearance: number): { x: number; y: number; z: number } =>
    rotateVec3ByQuat({ x: 0, y: 0.1 + localClearance, z: 0 }, pitchQuat(PITCH));
  const DOWNHILL = input({ moveDirection: { x: 0, y: 0, z: 1 } });
  const UPHILL = input({ moveDirection: { x: 0, y: 0, z: -1 } });

  const distanceTraveledIn = (heldInput: SimInputs, seconds: number): number => {
    const sim = new RapierSimulation({ statics: [ramp()], spawn: spawnAboveCentre(2) });
    tick(sim, 1); // settle at the ramp's centre
    const before = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;
    tick(sim, seconds, heldInput);
    const after = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;
    return Math.hypot(after.z - before.z, after.y - before.y);
  };

  it("covers more ground per second downhill than uphill, on the same ramp", () => {
    const downhillDistance = distanceTraveledIn(DOWNHILL, 1);
    const uphillDistance = distanceTraveledIn(UPHILL, 1);
    // Not just "greater," but by a clearly non-trivial margin — not float
    // noise, not the small residual effect Rapier's own slide-along-surface
    // geometry already contributes on any slope regardless of this ticket's
    // multiplier (an *additional* compounding factor on top of it, not a
    // substitute — no exact ratio is asserted against `slopeSpeedMultiplier`
    // alone for that reason).
    expect(downhillDistance / uphillDistance).toBeGreaterThan(1.15);
  });

  it("stays Controlled throughout — this is the walking model, not Sliding", () => {
    const sim = new RapierSimulation({ statics: [ramp()], spawn: spawnAboveCentre(2) });
    tick(sim, 1);
    tick(sim, 1, DOWNHILL);
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.motionState).toBe("Controlled");
  });

  it("moving straight downhill/uphill on FLAT ground is unaffected — the slope multiplier is exactly 1 with no tilt", () => {
    const sim = new RapierSimulation({ spawn: RESTING_SPAWN, statics: [GROUND] });
    tick(sim, 0.5);
    const before = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;
    tick(sim, 1, NORTH);
    const after = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;
    expect(before.z - after.z).toBeCloseTo(WALK_SPEED, 0); // exactly the pre-ticket-04 baseline, unchanged
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
      trigger: { center: { x: 0, y: 0.5, z: 4 }, halfExtents: { x: 3, y: 2, z: 1.5 } },
    };
    const far: Checkpoint = {
      respawn: { x: 8, y: 1.5, z: -4 },
      trigger: { center: { x: 0, y: 0.5, z: -4 }, halfExtents: { x: 3, y: 2, z: 1.5 } },
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
      trigger: { center: { x: 0, y: 0.5, z: 0 }, halfExtents: { x: 2, y: 2, z: 2 } },
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
    tick(sim, 0.5); // settle inside the checkpoint trigger
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.checkpointIndex).toBe(0);

    tickUntilFall(sim);
    tickUntilControlled(sim);

    expect(Math.abs(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position.x - 8)).toBeLessThan(3); // respawned at the pad
  });

  it("detects containment in a rotated Checkpoint trigger — not just an axis-aligned approximation (ADR 0034 code review)", () => {
    // An oblong trigger, long on local X (halfExtents.x=4, halfExtents.z=1),
    // rotated 90° around Y so its long axis now points along world Z. A
    // Character standing at (0, _, 3) is outside the *un-rotated* box
    // (z=3 > halfExtents.z=1) but inside the rotated one.
    const rotatedCheckpoint: Checkpoint = {
      respawn: { x: 8, y: 1.5, z: 0 },
      trigger: { center: { x: 0, y: 0.5, z: 0 }, halfExtents: { x: 4, y: 2, z: 1 }, rotation: yawQuat(Math.PI / 2) },
    };
    const sim = new RapierSimulation({
      spawn: { x: 0, y: 1.5, z: 3 },
      statics: [PLATFORM],
      checkpoints: [rotatedCheckpoint],
      killPlaneY: -8,
    });
    tick(sim, 0.5);
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.checkpointIndex).toBe(0);
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

describe("RapierSimulation — what a Fall does is a RoundRules field (M5 tickets 03/04, ADR 0042)", () => {
  const PLATFORM: Box = { center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 4, y: 0.5, z: 4 } };
  const eliminatingSim = () =>
    new RapierSimulation({
      spawn: { x: 0, y: 1.5, z: 0 },
      statics: [PLATFORM],
      killPlaneY: -8,
      roundRules: { timeLimitMs: 60_000, fallBehavior: "eliminate", survivorTarget: 1 },
    });

  it("still loses control on a Fall — the Fall itself never varies, and it happens immediately (M5 ticket 04: never stepped again to land a deferred one)", () => {
    const sim = eliminatingSim();
    tick(sim, 0.5);
    tickUntilFall(sim);

    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.motionState).toBe("Ragdoll");
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.ragdollCause).toBe("Fall");
  });

  it("queues no Respawn — the Character keeps falling through the void instead of returning", () => {
    const sim = eliminatingSim();
    tick(sim, 0.5);
    tickUntilFall(sim);
    const atFall = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position.y;

    tick(sim, 1); // a full second of continuing to fall

    const after = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position.y;
    expect(after).toBeLessThan(atFall); // still falling, never lifted back above the kill plane
  });

  it("does not re-trigger every tick while already down — fallCount stays exactly 1", () => {
    const sim = eliminatingSim();
    tick(sim, 0.5);
    tickUntilFall(sim);
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.fallCount).toBe(1);

    tick(sim, 1); // well inside RAGDOLL_MAX_MS (4s) — no forced recovery to race this

    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.fallCount).toBe(1);
  });

  it("ignores Checkpoints crossed before the Fall — a Round with no Respawn never reads respawnPoint", () => {
    const sim = new RapierSimulation({
      spawn: { x: 0, y: 1.5, z: 6 },
      statics: [{ center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 3, y: 0.5, z: 12 } }],
      checkpoints: [{ respawn: { x: -8, y: 1.5, z: 4 }, trigger: { center: { x: 0, y: 0.5, z: 4 }, halfExtents: { x: 3, y: 2, z: 1.5 } } }],
      killPlaneY: -8,
      roundRules: { timeLimitMs: 60_000, fallBehavior: "eliminate", survivorTarget: 1 },
    });
    tick(sim, 0.5);
    tick(sim, 1, NORTH); // walk through the Checkpoint
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.checkpointIndex).toBe(0); // reached, tracked as ever

    tickUntilFall(sim);
    tick(sim, 1);

    // Never teleported to the Checkpoint's respawn point (x = -8) — ignored, not rejected.
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position.x).toBeCloseTo(0, 0);
  });

  it("a Race (fallBehavior: respawn) resolves to exactly today's behaviour, pinned by the existing suite", () => {
    // The existing "Fall & Respawn" describe block above already covers this
    // exhaustively against the RoundRules-less default; this is the one
    // targeted check that an *explicit* respawn RoundRules resolves
    // identically to no RoundRules opinion at all.
    const sim = new RapierSimulation({
      spawn: { x: 0, y: 1.5, z: 0 },
      statics: [PLATFORM],
      killPlaneY: -8,
      roundRules: { timeLimitMs: 60_000, fallBehavior: "respawn", survivorTarget: 1 },
    });
    tick(sim, 0.5);
    tickUntilFall(sim);
    tickUntilControlled(sim);

    const character = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!;
    expect(character.fallCount).toBe(1);
    expect(character.position.y).toBeGreaterThan(-8);
    expect(Math.hypot(character.position.x, character.position.z)).toBeLessThan(3);
  });

  it("stays eliminated forever — well past RAGDOLL_MAX_MS + GETUP_MS, never cycles back to Controlled (code review, ticket 03)", () => {
    // The exact bug caught reviewing ticket 03: without ticket 04's "not
    // stepped at all", the state machine's own unconditional Ragdoll →
    // GettingUp → Controlled timers (RAGDOLL_MAX_MS=4000, GETUP_MS=450)
    // fire regardless of settling, so a Character eliminated into an open
    // void would cycle back to Controlled while still falling and
    // detectFall would fire again. Being marked eliminated stops it from
    // ever being stepped again, so those timers can never advance.
    const sim = eliminatingSim();
    tick(sim, 0.5);
    tickUntilFall(sim);

    tick(sim, 6); // well past 4.45s

    const character = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!;
    expect(character.motionState).toBe("Ragdoll");
    expect(character.fallCount).toBe(1);
  });
});

describe("RapierSimulation — an eliminated Character is marked, not removed (M5 ticket 04, ADR 0042)", () => {
  const MOVER = DEFAULT_CHARACTER_ID;
  const TARGET = "target";
  const onGround = (z: number) => ({ x: 0, y: CAPSULE_BOTTOM_OFFSET + 0.1, z });

  it("stays in the Character collection and the snapshot — marked, not removed", () => {
    const sim = new RapierSimulation({ spawn: onGround(0), statics: [GROUND] });
    sim.addCharacter(TARGET, onGround(-3));
    tick(sim, 0.3);

    sim.eliminateCharacter(TARGET);
    tick(sim, 0.3);

    expect(Object.keys(sim.snapshot().characters).sort()).toEqual([MOVER, TARGET].sort());
  });

  it("is not stepped — input can no longer move it, only its own ragdoll settling can", () => {
    // Its `position` keeps reading from the ragdoll's own body (`snapshot`
    // already does this for anyone down, ticket-04 or not) — a genuinely
    // separate dynamic Rapier body `world.step()` still simulates every
    // tick regardless of `beginTick`/`endTick` ever running again, so a
    // *little* settle drift is real and expected. What "not stepped" rules
    // out is 2 seconds of continued WALK_SPEED-driven travel (12 units) if
    // this Character's own controller were still reading `NORTH`.
    const sim = new RapierSimulation({ spawn: onGround(0), statics: [GROUND] });
    sim.addCharacter(TARGET, onGround(-3));
    tick(sim, 0.3);
    sim.eliminateCharacter(TARGET);
    const at = sim.snapshot().characters[TARGET]!.position;

    for (let n = 0; n < 60; n += 1) sim.tick({ [TARGET]: NORTH }); // input it can no longer receive

    const after = sim.snapshot().characters[TARGET]!.position;
    expect(Math.hypot(after.x - at.x, after.z - at.z)).toBeLessThan(2);
  });

  it("goes down immediately — motionState Ragdoll from the moment it is eliminated", () => {
    const sim = new RapierSimulation({ spawn: onGround(0), statics: [GROUND] });
    sim.addCharacter(TARGET, onGround(-3));
    tick(sim, 0.3);

    sim.eliminateCharacter(TARGET);

    expect(sim.snapshot().characters[TARGET]!.motionState).toBe("Ragdoll");
  });

  it("is a no-op on an unknown id or an already-eliminated Character", () => {
    const sim = new RapierSimulation({ spawn: onGround(0), statics: [GROUND] });
    sim.addCharacter(TARGET, onGround(-3));
    tick(sim, 0.3);

    expect(() => sim.eliminateCharacter("nobody")).not.toThrow();
    sim.eliminateCharacter(TARGET);
    expect(() => sim.eliminateCharacter(TARGET)).not.toThrow(); // already eliminated
  });

  it("nobody can shove a corpse — a live Character walks straight through where its disabled collider was", () => {
    const sim = new RapierSimulation({ spawn: onGround(0), statics: [GROUND] });
    sim.addCharacter(TARGET, onGround(-1));
    tick(sim, 0.3);
    sim.eliminateCharacter(TARGET);
    const eliminatedAt = sim.snapshot().characters[TARGET]!.position;

    for (let n = 0; n < Math.round(2 * TICK_RATE_HZ); n += 1) sim.tick({ [MOVER]: NORTH }); // walk straight at it

    // Not blocked — the mover's own centre passes well beyond where a solid
    // Character would have stopped it (compare the Bump-collision test above:
    // "centres never get closer than roughly two capsule radii").
    expect(sim.snapshot().characters[MOVER]!.position.z).toBeLessThan(eliminatedAt.z - 0.6);
  });

  it("a corpse cannot shove anybody — eliminating a Character mid-Impact leaves nothing behind to knock others around", () => {
    const sim = new RapierSimulation({ spawn: onGround(0), statics: [GROUND] });
    sim.addCharacter(TARGET, onGround(-1));
    tick(sim, 0.3);
    sim.eliminateCharacter(TARGET);
    const moverBefore = sim.snapshot().characters[MOVER]!.position;

    for (let n = 0; n < Math.round(2 * TICK_RATE_HZ); n += 1) sim.tick({ [MOVER]: NORTH });

    // The mover's own trajectory is undisturbed by whatever the corpse is
    // doing (ragdolling from Impact groups, which never collide with a live
    // Character's capsule) — it moves the same distance a clear walk would.
    const moverAfter = sim.snapshot().characters[MOVER]!.position;
    expect(moverBefore.z - moverAfter.z).toBeGreaterThan(1.5);
  });

  it("eliminating an already-Ragdolling Character (a disconnect mid-Impact) never re-snaps its ragdoll (code review)", () => {
    // A guard was missing here: eliminateNow used to force a *fresh* Ragdoll
    // entry unconditionally, even over one already in progress — discarding
    // its real tumbling velocity, overwriting ragdollCause, and double-
    // bumping ragdollEpoch for what was really the same knockdown.
    const sim = new RapierSimulation({ spawn: onGround(0), statics: [GROUND] });
    sim.addCharacter(TARGET, onGround(-3));
    tick(sim, 0.3);

    sim.applyImpact(TARGET, { x: IMPACT_RAGDOLL_MIN + 5, y: 0, z: 0 });
    sim.tick({}); // the Impact's own Ragdoll entry lands
    const afterImpact = sim.snapshot().characters[TARGET]!;
    expect(afterImpact.motionState).toBe("Ragdoll");
    expect(afterImpact.ragdollCause).toBe("Bump");
    expect(afterImpact.ragdollEpoch).toBe(1);

    sim.eliminateCharacter(TARGET);

    const afterEliminate = sim.snapshot().characters[TARGET]!;
    expect(afterEliminate.ragdollCause).toBe("Bump"); // not overwritten to "Disconnect"
    expect(afterEliminate.ragdollEpoch).toBe(1); // not double-bumped
  });

  it("a Fall while already Ragdolling from an unrelated Impact eliminates without disturbing the ragdoll in progress (code review)", () => {
    // Spawned already off any solid ground (no statics under it at all) and
    // Impacted on literally the first tick — the fall to the kill plane
    // below is gravity alone, under a Ragdoll whose cause is genuinely the
    // Impact, not the Fall this test is really about.
    const sim = new RapierSimulation({
      spawn: { x: 0, y: 1.5, z: 0 },
      statics: [],
      killPlaneY: -8,
      roundRules: { timeLimitMs: 60_000, fallBehavior: "eliminate", survivorTarget: 1 },
    });

    sim.applyImpact(MOVER, { x: IMPACT_RAGDOLL_MIN + 5, y: 0, z: 0 });
    sim.tick({});
    const afterImpact = sim.snapshot().characters[MOVER]!;
    expect(afterImpact.motionState).toBe("Ragdoll");
    expect(afterImpact.ragdollCause).toBe("Bump");

    for (let n = 0; n < Math.round(3 * TICK_RATE_HZ) && sim.snapshot().characters[MOVER]!.fallCount === 0; n += 1) {
      sim.tick({});
    }

    const afterFall = sim.snapshot().characters[MOVER]!;
    expect(afterFall.fallCount).toBe(1); // still recorded, for stats
    expect(afterFall.eliminated).toBe(true); // still eliminated
    expect(afterFall.ragdollCause).toBe("Bump"); // the real cause survives, not silently rewritten to "Fall"
    expect(afterFall.ragdollEpoch).toBe(afterImpact.ragdollEpoch); // one knockdown, not two
  });
});

describe("RapierSimulation — qualifySurvivors (M5 ticket 05, ADR 0042)", () => {
  const MOVER = DEFAULT_CHARACTER_ID;
  const TARGET = "target";
  const onGround = (z: number) => ({ x: 0, y: CAPSULE_BOTTOM_OFFSET + 0.1, z });

  it("Qualifies every Character still standing, at the given Tick", () => {
    const sim = new RapierSimulation({ spawn: onGround(0), statics: [GROUND] });
    sim.addCharacter(TARGET, onGround(-1));
    tick(sim, 0.3);

    sim.qualifySurvivors(sim.snapshot().tick);

    expect(sim.snapshot().characters[MOVER]!.finishTick).toBe(sim.snapshot().tick);
    expect(sim.snapshot().characters[TARGET]!.finishTick).toBe(sim.snapshot().tick);
  });

  it("never Qualifies an eliminated Character", () => {
    const sim = new RapierSimulation({ spawn: onGround(0), statics: [GROUND] });
    sim.addCharacter(TARGET, onGround(-1));
    tick(sim, 0.3);
    sim.eliminateCharacter(TARGET);

    sim.qualifySurvivors(sim.snapshot().tick);

    expect(sim.snapshot().characters[MOVER]!.finishTick).not.toBeNull();
    expect(sim.snapshot().characters[TARGET]!.finishTick).toBeNull();
  });

  it("keeps a Character's own earlier finishTick rather than overwriting it", () => {
    const sim = new RapierSimulation({ spawn: onGround(0), statics: [GROUND] });
    tick(sim, 0.3);
    sim.reconcileCharacter(MOVER, { ...sim.snapshot().characters[MOVER]!, finishTick: 5 });

    sim.qualifySurvivors(50);

    expect(sim.snapshot().characters[MOVER]!.finishTick).toBe(5);
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

  it("a routine reconcile mid-burst kills the dash outright — even a no-op correction that fully agrees with the client (regression)", () => {
    // Reconciliation now fires far more readily (ADR 0026's epsilon-gated
    // sim correction replaces the old one-walk-step "correct or ignore" gate)
    // — and a dash's high speed (15 u/s vs 6 u/s walking) makes even a tiny
    // same-tick phase slip cross that epsilon almost every tick during a
    // burst. `reconcileTo` restores `dashCooldownMs` unconditionally on every
    // non-down reconcile, and `DashController.restoreCooldownMs` always zeros
    // `ticksLeft` — even though `CharacterSnapshot` separately reports
    // `dashing`/`dashSpeed`, which `reconcileCharacter`'s `base` type doesn't
    // even accept. So a reconcile that agrees with the client on literally
    // everything (position, velocity, motionState, cooldown) still ends the
    // burst outright.
    const sim = settled();
    sim.tick({ [DEFAULT_CHARACTER_ID]: input({ ...NORTH, dashHeld: true }) }); // dash press
    tick(sim, 0.1, NORTH); // a few ticks into the burst, well before it ends
    const midBurst = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!;
    expect(midBurst.dashing).toBe(true); // still actively dashing going into the reconcile

    // Reconcile with a "server" snapshot that is the client's own current
    // state, verbatim — the strongest form of "this correction should be
    // invisible": nothing about position, velocity, motionState, or cooldown
    // disagrees.
    sim.reconcileCharacter(DEFAULT_CHARACTER_ID, {
      position: { ...midBurst.position },
      velocity: { ...midBurst.velocity },
      grounded: midBurst.grounded,
      motionState: midBurst.motionState,
      dashCooldownMs: midBurst.dashCooldownMs,
      dashing: midBurst.dashing,
      speedPadMsLeft: midBurst.speedPadMsLeft,
      speedPadCapMultiplier: midBurst.speedPadCapMultiplier,
      finishTick: midBurst.finishTick,
      eliminated: midBurst.eliminated,
    });

    const afterReconcile = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!;
    expect(afterReconcile.dashing).toBe(true); // the burst must survive an agreeing reconcile
    expect(afterReconcile.dashSpeed).toBeGreaterThan(0);
  });

  it("reconcile-then-replay mid-burst does not double-count elapsed ticks — the burst must not end early (regression)", () => {
    // The previous test reconciles directly against the client's OWN current
    // state and never replays afterward — it can't catch a bug in how
    // `ticksLeft` carries across a reconcile that targets an OLDER (acked)
    // tick, which `main.ts` always immediately follows with a replay of the
    // ticks since. That's the real shape every reconcile actually takes.
    //
    // `truth` plays out one, uninterrupted dash burst — the ground truth for
    // "how far into the burst have N ticks actually gotten". `client` predicts
    // the same K ticks ahead, then gets reconciled to `truth`'s OLDER state at
    // tick `acked` (a few ticks behind, simulating latency) and replays the
    // `unacked` inputs forward — exactly `main.ts`'s reconcile() + replayLocalCharacter().
    // If `ticksLeft` isn't correctly rolled back to its value AS OF the acked
    // tick before replay re-advances it, replay double-decrements: the dash
    // ends early on the client while `truth` (and thus the real server) is
    // still mid-burst — surfacing next reconcile as the server suddenly
    // reporting a position AHEAD of the client's (now prematurely stopped)
    // one, i.e. a forward pop, worst right at the tail of the burst.
    const truth = settled();
    const client = settled();
    const K = 20; // well into the burst, comfortably before it ends
    const ACKED_LAG = 5; // ticks of latency between "acked" and "current"

    let ackedSnapshot: ReturnType<typeof truth.snapshot>["characters"][string] | null = null;
    const unackedInputs: SimInputs[] = [];
    for (let t = 1; t <= K; t += 1) {
      const dashInput = input({ ...NORTH, dashHeld: t === 1 });
      truth.tick({ [DEFAULT_CHARACTER_ID]: dashInput });
      client.tick({ [DEFAULT_CHARACTER_ID]: dashInput });
      if (t === K - ACKED_LAG) ackedSnapshot = truth.snapshot().characters[DEFAULT_CHARACTER_ID]!;
      if (t > K - ACKED_LAG) unackedInputs.push(dashInput);
    }
    if (!ackedSnapshot) throw new Error("unreachable");

    // Reconcile the client to the server's OLDER (acked) report, then replay
    // exactly the inputs since — `main.ts`'s real reconcile() + replayLocalCharacter().
    client.reconcileCharacter(DEFAULT_CHARACTER_ID, {
      position: { ...ackedSnapshot.position },
      velocity: { ...ackedSnapshot.velocity },
      grounded: ackedSnapshot.grounded,
      motionState: ackedSnapshot.motionState,
      dashCooldownMs: ackedSnapshot.dashCooldownMs,
      dashing: ackedSnapshot.dashing,
      speedPadMsLeft: ackedSnapshot.speedPadMsLeft,
      speedPadCapMultiplier: ackedSnapshot.speedPadCapMultiplier,
      finishTick: ackedSnapshot.finishTick,
      eliminated: ackedSnapshot.eliminated,
    });
    client.replayLocalCharacter(DEFAULT_CHARACTER_ID, unackedInputs);

    const truthNow = truth.snapshot().characters[DEFAULT_CHARACTER_ID]!;
    const clientNow = client.snapshot().characters[DEFAULT_CHARACTER_ID]!;
    // A true no-op correction (truth and client never actually disagreed on
    // anything real) must land the client at the exact same point in the
    // burst as the undisturbed ground truth — same dashing state, same speed
    // (within float noise), same position. Any drift here is the client's
    // OWN reconcile/replay bookkeeping diverging, not a real discrepancy.
    expect(clientNow.dashing).toBe(truthNow.dashing);
    expect(clientNow.dashSpeed).toBeCloseTo(truthNow.dashSpeed, 2);
    expect(clientNow.position.z).toBeCloseTo(truthNow.position.z, 2);
  });

  it("reconciles EVERY tick, across two back-to-back dashes — dashSpeed/dashCooldownMs always land exactly on truth's own, everywhere (regression)", () => {
    // The single-reconcile test above proves the bookkeeping is *correct* at
    // one point; this proves it stays correct under continuous reconciliation
    // (the realistic case under ADR 0026's low epsilon — see the ADR 0026
    // amendment) across MULTIPLE dashes in a row, the reported symptom
    // ("několikrát po sobě... lehký jump dopředu na konci" — several times in
    // a row, a slight forward jump at the end).
    //
    // This asserts `dashSpeed`/`dashCooldownMs` specifically, not position.
    // Investigating an earlier draft's position-based assertion (which failed
    // even after the fixes below) traced the residual to something else
    // entirely: reconciling literally EVERY tick — an unrealistically extreme
    // stress no real jitter/LEAD ever produces — surfaces a small (~1 tick's
    // worth of current speed) position residual from `reconcileTo`'s
    // `body.setTranslation(...)` (a teleport) not perfectly matching a
    // continuously-simulated capsule's contact/solver state one tick later.
    // Confirmed pre-existing and NOT dash-specific: the identical residual,
    // at the identical ~1-walk-step scale, appears reconciling plain walking
    // (no dash at all) this hard too. That is ADR 0026's render-offset's job
    // to hide (ticket 12) and ADR 0027's job to make rare (ticket 13) — both
    // already shipped — not something to chase inside `DashController`. What
    // IS specific to dash, and what regressed here, is `dashSpeed`/
    // `dashCooldownMs` themselves ever disagreeing with truth — which they
    // must not, at any point in either burst, including the tail where the
    // reported "lehký jump dopředu" was seen.
    const LONG_GROUND: Box = { center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 20, y: 0.5, z: 100 } };
    const longGround = () => {
      const sim = new RapierSimulation({ spawn: RESTING_SPAWN, statics: [LONG_GROUND] });
      tick(sim, 0.5);
      return sim;
    };
    const truth = longGround();
    const client = longGround();
    const LAG = 3; // ticks of simulated latency
    const TOTAL = 100; // comfortably covers two full dashes (30 ticks) + the 45-tick cooldown between them
    const SECOND_PRESS_TICK = DASH_COOLDOWN_TICKS + 2; // cooldown has just cleared — press again immediately

    const truthHistory: ReturnType<typeof truth.snapshot>["characters"][string][] = [];
    const inputHistory: SimInputs[] = [];
    let worstDashSpeedGap = 0;
    let worstCooldownGapMs = 0;
    let dashingMismatches = 0;

    for (let t = 1; t <= TOTAL; t += 1) {
      const dashInput = input({ ...NORTH, dashHeld: t === 1 || t === SECOND_PRESS_TICK });
      truth.tick({ [DEFAULT_CHARACTER_ID]: dashInput });
      client.tick({ [DEFAULT_CHARACTER_ID]: dashInput });
      truthHistory.push(truth.snapshot().characters[DEFAULT_CHARACTER_ID]!);
      inputHistory.push(dashInput);

      if (t > LAG) {
        const ackedIdx = t - LAG - 1; // 0-based index into truthHistory for tick (t - LAG)
        const acked = truthHistory[ackedIdx]!;
        client.reconcileCharacter(DEFAULT_CHARACTER_ID, {
          position: { ...acked.position },
          velocity: { ...acked.velocity },
          grounded: acked.grounded,
          motionState: acked.motionState,
          dashCooldownMs: acked.dashCooldownMs,
          dashing: acked.dashing,
          speedPadMsLeft: acked.speedPadMsLeft,
          speedPadCapMultiplier: acked.speedPadCapMultiplier,
          finishTick: acked.finishTick,
          eliminated: acked.eliminated,
        });
        client.replayLocalCharacter(DEFAULT_CHARACTER_ID, inputHistory.slice(ackedIdx + 1));
        const afterSnap = client.snapshot().characters[DEFAULT_CHARACTER_ID]!;
        const truthAtT = truthHistory[t - 1]!;
        if (afterSnap.dashing !== truthAtT.dashing) dashingMismatches += 1;
        worstDashSpeedGap = Math.max(worstDashSpeedGap, Math.abs(afterSnap.dashSpeed - truthAtT.dashSpeed));
        worstCooldownGapMs = Math.max(worstCooldownGapMs, Math.abs(afterSnap.dashCooldownMs - truthAtT.dashCooldownMs));
      }
    }

    expect(dashingMismatches).toBe(0);
    expect(worstDashSpeedGap).toBeLessThan(0.01);
    expect(worstCooldownGapMs).toBeLessThan(1); // float-noise floor only, not a whole tick's worth
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

  it("a Prop marked predicted simulates freely — it is not re-pinned to the snapshot (ADR 0022)", () => {
    const client = new RapierSimulation({
      spawn: RESTING_SPAWN,
      statics: [GROUND],
      props: [airborneProp],
      authoritative: false,
    });
    // Server keeps saying "the box hasn't moved" — a pinned Prop would obey.
    client.setPredictedProps([0]);
    for (let i = 0; i < 30; i += 1) {
      client.syncPropsToSnapshot([serverPose({ x: 6, y: 5, z: 0 })]);
      client.tick({});
    }
    expect(client.snapshot().props[0]!.position.y).toBeLessThan(4); // fell under local gravity

    // Un-predict it and it snaps back under the server's pin.
    client.setPredictedProps([]);
    client.syncPropsToSnapshot([serverPose({ x: 6, y: 5, z: 0 })]);
    client.tick({});
    expect(client.snapshot().props[0]!.position.y).toBeCloseTo(5, 3);
  });

  it("a shove on the very tick a Prop is first contacted survives that tick — it isn't re-pinned away before the render layer can mark it predicted (regression)", () => {
    const groundProp = {
      shape: { kind: "box" as const, halfExtents: { x: 0.4, y: 0.4, z: 0.4 } },
      center: { x: 0, y: 0.4, z: -1.2 },
    };
    const client = new RapierSimulation({
      spawn: RESTING_SPAWN,
      statics: [GROUND],
      props: [groundProp],
      authoritative: false,
    });
    client.syncPropsToSnapshot([serverPose(groundProp.center)]);
    tick(client, 0.5); // settle

    // Walk toward the box, re-pinning every tick from the (unchanged) server
    // pose exactly like main.ts's per-frame prop sync — but crucially,
    // WITHOUT ever calling setPredictedProps: the render layer only learns a
    // contact happened AFTER this tick, via consumeContactedProps(), so
    // predictedProps stays empty through the very tick contact first occurs.
    let contactTick = -1;
    let posBeforeContact = { ...client.snapshot().props[0]!.position };
    let posAfterContact = { ...posBeforeContact };
    for (let i = 0; i < 60 && contactTick < 0; i += 1) {
      client.syncPropsToSnapshot([serverPose(groundProp.center)]);
      posBeforeContact = { ...client.snapshot().props[0]!.position };
      client.tick({ [DEFAULT_CHARACTER_ID]: NORTH });
      posAfterContact = { ...client.snapshot().props[0]!.position };
      if (client.consumeContactedProps().includes(0)) contactTick = i;
    }

    expect(contactTick).toBeGreaterThanOrEqual(0); // contact actually happened
    // The shove moved the box within this same tick — it must not have been
    // silently discarded by the every-tick pin before the render layer had
    // any chance to mark the Prop predicted (which only happens next frame).
    const moved = Math.hypot(posAfterContact.x - posBeforeContact.x, posAfterContact.z - posBeforeContact.z);
    expect(moved).toBeGreaterThan(0.001);
  });

  it("reports the Prop the local capsule contacted, once, and clears on read (ADR 0022)", () => {
    const groundProp = {
      shape: { kind: "box" as const, halfExtents: { x: 0.4, y: 0.4, z: 0.4 } },
      center: { x: 0, y: 0.4, z: -1.2 },
    };
    const client = new RapierSimulation({
      spawn: RESTING_SPAWN,
      statics: [GROUND],
      props: [groundProp],
      authoritative: false,
    });
    client.setPredictedProps([0]);
    expect(client.consumeContactedProps()).toEqual([]); // nothing yet

    for (let i = 0; i < 30; i += 1) client.tick({ [DEFAULT_CHARACTER_ID]: NORTH }); // walk into it
    expect(client.consumeContactedProps()).toEqual([0]);
    expect(client.consumeContactedProps()).toEqual([]); // consumed
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

  it("an authoritative pose reporting atRest (no velocity field) does not zero a predicted Prop's fresh push (ADR 0022)", () => {
    const groundProp = {
      shape: { kind: "box" as const, halfExtents: { x: 0.4, y: 0.4, z: 0.4 } },
      center: { x: 0, y: 0.4, z: -1.2 },
    };
    const client = new RapierSimulation({
      spawn: RESTING_SPAWN,
      statics: [GROUND],
      props: [groundProp],
      authoritative: false,
    });
    client.setPredictedProps([0]);
    for (let i = 0; i < 10; i += 1) client.tick({ [DEFAULT_CHARACTER_ID]: NORTH }); // push it moving
    const pushed = client.snapshot().props[0]!;
    expect(pushed.atRest).toBe(false);
    expect(Math.abs(pushed.velocity!.z)).toBeGreaterThan(0);

    // A stale server snapshot still says the box hasn't moved yet (no `velocity`
    // field at all, not a reported zero) — reconciling to it must not stomp the
    // fresh local push back to a standstill.
    client.applyAuthoritativePropState(0, { position: groundProp.center, rotation: { x: 0, y: 0, z: 0, w: 1 }, atRest: true });
    expect(Math.abs(client.snapshot().props[0]!.velocity!.z)).toBeGreaterThan(0);
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

  it("a dash-wall Ragdoll advances ragdollEpoch and records cause WallImpact (ADR 0023)", () => {
    const sim = new RapierSimulation({ spawn: RESTING_SPAWN, statics: [GROUND, WALL] });
    tick(sim, 0.5);
    sim.tick({ [DEFAULT_CHARACTER_ID]: input({ moveDirection: { x: 1, y: 0, z: 0 }, dashHeld: true }) });
    tick(sim, 1, input({ moveDirection: { x: 1, y: 0, z: 0 } }));

    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.motionState).toBe("Ragdoll");
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.ragdollEpoch).toBe(1);
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.ragdollCause).toBe("WallImpact");
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

  it("across a sweep of approach angles: where the Character falls vs where it stands once Controlled resumes after GettingUp", () => {
    // Single authoritative sim (this is a server-side physics question, not a
    // client-reconcile one) — dash into the same wall at increasingly oblique
    // angles and record three points in the episode: the tick motionState
    // first becomes "Ragdoll" (impact), the tick it becomes "GettingUp" (the
    // ragdoll has settled — `beginGettingUp` reports `getupStartRoot`
    // verbatim at elapsed=0, per `getupBlendedPosition`), and the tick it's
    // back to "Controlled" (recovery complete). A wide-enough wall (z ±5)
    // keeps every angle in this sweep hitting the same face.
    //
    // Bounded at 45° (M3.7 ticket 03): the sweep used to go to 60°, but once
    // wall-Impact is re-expressed as *closing* speed (the Character's own
    // velocity projected onto the wall's normal) rather than raw dash
    // magnitude, a 60° dash is glancing enough that its closing-speed
    // component never crosses {@link WALL_IMPACT_MIN_SPEED} while still in
    // contact — the Character correctly slides along the wall and clears it
    // instead of Ragdolling, exactly the behavior "impact magnitude scales
    // with closing speed" is supposed to produce (a real hit needs real
    // speed *into* the wall, not just overall speed). See the dedicated
    // "slides past a sufficiently glancing hit" test below for that case —
    // caught empirically (not hand-derived): an earlier draft of this sweep
    // still included 60° and got a wildly-out-of-pattern "fall" position
    // back near spawn, which traced to the Character clearing the wall
    // entirely, continuing straight off the edge of this test's own
    // (deliberately finite) ground, and hitting the kill plane — a Fall/
    // Respawn's own flop-to-Ragdoll, unrelated to the wall at all.
    //
    // `fall → recovered` (logged, not asserted) grows with approach angle —
    // confirmed intentional, not a bug: `wallImpactKnockback` bounces off
    // the wall's own normal regardless of approach angle, but
    // `beginRagdoll`'s launch velocity is `this.velocity *
    // RAGDOLL_IMPACT_VELOCITY_SCALE` — the Character's OWN velocity at
    // impact, whose lateral (Z, along-the-wall) component grows with
    // `sin(angle)`. A glancing hit keeps more sideways momentum than a
    // square one, carrying the ragdoll further along the wall before it
    // settles — a reasonable "physical chaos" outcome for this game, not
    // something to clamp. Left unasserted here on purpose so a future
    // `RAGDOLL_IMPACT_VELOCITY_SCALE` retune isn't fighting a brittle bound.
    type Pos = { x: number; y: number; z: number };
    const dist = (a: Pos, b: Pos) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    const ANGLES_DEG = [0, 15, 30, 45];
    const results: { angleDeg: number; fall: Pos; settled: Pos; recovered: Pos }[] = [];

    for (const angleDeg of ANGLES_DEG) {
      const rad = (angleDeg * Math.PI) / 180;
      const moveDir = { x: Math.cos(rad), y: 0, z: Math.sin(rad) };
      const sim = new RapierSimulation({ spawn: RESTING_SPAWN, statics: [GROUND, WALL] });
      tick(sim, 0.5); // settle
      sim.tick({ [DEFAULT_CHARACTER_ID]: input({ moveDirection: moveDir, dashHeld: true }) }); // dash press, angled

      let fall: Pos | null = null;
      let settled: Pos | null = null;
      let recovered: Pos | null = null;
      let prevState = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.motionState;
      // RAGDOLL_MAX_MS (4 s) + GETUP_MS (0.45 s) worst case, comfortably covered.
      for (let i = 0; i < 200 && !recovered; i += 1) {
        sim.tick({ [DEFAULT_CHARACTER_ID]: input({ moveDirection: moveDir }) });
        const c = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!;
        if (prevState !== "Ragdoll" && c.motionState === "Ragdoll") fall = { ...c.position };
        if (prevState === "Ragdoll" && c.motionState === "GettingUp") settled = { ...c.position };
        if (prevState === "GettingUp" && c.motionState === "Controlled") recovered = { ...c.position };
        prevState = c.motionState;
      }

      if (!fall || !settled || !recovered) {
        throw new Error(`angle ${angleDeg}°: episode did not complete within budget (fall=${!!fall} settled=${!!settled} recovered=${!!recovered})`);
      }
      results.push({ angleDeg, fall, settled, recovered });
    }

    // Horizontal (x/z) distance only — NOT full 3D. `settled` is the ragdoll's
    // pelvis root, lying at roughly ground height (~0.2); `recovered` is the
    // STANDING capsule's own centre (~CAPSULE_BOTTOM_OFFSET ≈ 0.85 above
    // ground). A ~0.6-0.7 *vertical* rise between them is `getupBlendedPosition`
    // working exactly as designed — the getup animation standing the
    // Character up from flat on the ground — not a bug. What must NOT move is
    // the horizontal footprint: nothing accepts fresh movement input again
    // until Controlled resumes, so a real bug here would show up as sideways
    // drift, not vertical rise.
    const horiz = (a: Pos, b: Pos) => Math.hypot(a.x - b.x, a.z - b.z);
    console.log(
      results
        .map((r) => {
          const fallToRecovered = dist(r.fall, r.recovered);
          const settledToRecoveredVertical = r.recovered.y - r.settled.y;
          const settledToRecoveredHoriz = horiz(r.settled, r.recovered);
          return (
            `  ${r.angleDeg}°: fall=(${r.fall.x.toFixed(2)},${r.fall.y.toFixed(2)},${r.fall.z.toFixed(2)}) ` +
            `settled=(${r.settled.x.toFixed(2)},${r.settled.y.toFixed(2)},${r.settled.z.toFixed(2)}) ` +
            `recovered=(${r.recovered.x.toFixed(2)},${r.recovered.y.toFixed(2)},${r.recovered.z.toFixed(2)}) ` +
            `|fall→recovered|=${fallToRecovered.toFixed(3)} settled→recovered: vertical(rise)=${settledToRecoveredVertical.toFixed(3)} horizontal=${settledToRecoveredHoriz.toFixed(3)}`
          );
        })
        .join("\n"),
    );

    for (const r of results) {
      // The Character stands up roughly on the spot — no sideways drift
      // during the getup blend, regardless of approach angle.
      expect(horiz(r.settled, r.recovered)).toBeLessThan(0.3);
      // The vertical rise is real and expected (standing up), bounded to a
      // sane range around GETUP_CAPSULE_LIFT rather than asserted away.
      expect(r.recovered.y - r.settled.y).toBeGreaterThan(0.4);
      expect(r.recovered.y - r.settled.y).toBeLessThan(0.9);
      // And the Character must not still be embedded in/past the wall (x=3,
      // half-extent 0.5, so the near face is x=2.5) — it settles on the near
      // side, roughly where it hit, not through it.
      expect(r.recovered.x).toBeLessThan(2.5);
    }
  });

  it("slides past a sufficiently glancing hit instead of forcing Ragdoll — closing speed, not raw speed, is what counts (M3.7 ticket 03)", () => {
    // A generously large ground (unlike the module-level GROUND used by the
    // rest of this describe block) — this Character is EXPECTED to clear
    // the wall's own z-extent (±5) and keep going, so it needs somewhere to
    // land that isn't past the edge of a small platform (the exact "unrelated
    // Fall/Respawn" artifact the sweep test's own comment above documents
    // discovering).
    const bigGround: Box = { center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 30, y: 0.5, z: 30 } };
    const rad = (60 * Math.PI) / 180; // a shallow, mostly-tangential approach
    const moveDir = { x: Math.cos(rad), y: 0, z: Math.sin(rad) };
    const sim = new RapierSimulation({ spawn: RESTING_SPAWN, statics: [bigGround, WALL] });
    tick(sim, 0.5);
    sim.tick({ [DEFAULT_CHARACTER_ID]: input({ moveDirection: moveDir, dashHeld: true }) });

    let sawWallContact = false;
    let clearedTheWall = false;
    for (let i = 0; i < 40; i += 1) {
      sim.tick({ [DEFAULT_CHARACTER_ID]: input({ moveDirection: moveDir }) });
      const c = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!;
      // Sanity: it's genuinely sliding along the wall's face at some point
      // (blocked right at the near face, x ≈ 2.5 − CAPSULE_RADIUS), not
      // simply never reaching it at all.
      if (Math.abs(c.position.x - 2.14) < 0.05) sawWallContact = true;
      // ...and eventually clears the wall's own z-extent while still moving.
      if (c.position.z > 5) clearedTheWall = true;
      expect(c.motionState).not.toBe("Ragdoll");
      expect(c.motionState).not.toBe("Stagger");
      if (clearedTheWall) break;
    }
    expect(sawWallContact).toBe(true);
    expect(clearedTheWall).toBe(true);
  });
});

describe("RapierSimulation — wall-Impact is a speed threshold, not a Dash-specific rule (M3.7 ticket 03, ADR 0037)", () => {
  const WALL: Box = { center: { x: 3, y: 1, z: 0 }, halfExtents: { x: 0.5, y: 1, z: 5 } };
  // Where a walking Character's capsule centre rests against WALL's near
  // face: WALL.center.x - WALL.halfExtents.x - CAPSULE_RADIUS.
  const WALL_CONTACT_X = 3 - 0.5 - CAPSULE_RADIUS;

  it("a launch pad firing a Character into a wall knocks it down — no Dash involved at all", () => {
    // The pad sits right up against the wall's own contact line. This is
    // deliberate, not arbitrary: a launch pad's SET velocity (like a speed
    // pad's boost) survives only the ONE tick it's applied on — the very
    // next tick's ordinary accelerateVelocity() pipeline (which runs every
    // tick, grounded or airborne, per CharacterController) recomputes
    // horizontal velocity from scratch, decaying a purely-horizontal launch
    // to at most WALK_SPEED (matching input) or 0 (none) — confirmed
    // directly while designing this test. So the wall hit must land on the
    // very tick the SET applies, which placing the pad flush against the
    // wall guarantees regardless of exactly which tick crosses the trigger.
    const trigger: OrientedBox = {
      center: { x: WALL_CONTACT_X - 0.1, y: 0, z: 0 },
      halfExtents: { x: 0.1, y: 1, z: 2 },
    };
    const sim = new RapierSimulation({
      spawn: RESTING_SPAWN,
      statics: [GROUND, WALL],
      launchPads: [{ trigger, velocity: { x: 25, y: 0, z: 0 } }], // well above WALL_IMPACT_MIN_SPEED (9)
    });
    tick(sim, 0.5);
    const EAST = input({ moveDirection: { x: 1, y: 0, z: 0 } });
    while (sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.launchPadEpoch === 0) {
      sim.tick({ [DEFAULT_CHARACTER_ID]: EAST });
    }
    // The queued SET applies this tick and immediately drives the Character
    // into the wall at full launch speed.
    let ragdolled = false;
    for (let i = 0; i < 10 && !ragdolled; i += 1) {
      sim.tick({ [DEFAULT_CHARACTER_ID]: IDLE_INPUTS });
      if (sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.motionState === "Ragdoll") ragdolled = true;
    }
    expect(ragdolled).toBe(true);
    const c = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!;
    expect(c.ragdollCause).toBe("WallImpact");
    expect(c.dashing).toBe(false); // never dashed — the rule fired purely from closing speed
  });
});

describe("RapierSimulation — client/server dash-wall knockdown desync (2026-09 playtest, ADR 0015)", () => {
  const WALL: Box = { center: { x: 3, y: 1, z: 0 }, halfExtents: { x: 0.5, y: 1, z: 5 } };
  const EAST = input({ moveDirection: { x: 1, y: 0, z: 0 } });
  const DASH_EAST = input({ moveDirection: { x: 1, y: 0, z: 0 }, dashHeld: true });
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
      const serverDown = isDownMotionState(s.motionState);
      const predictedAtAck = positionHistory.get(acked);
      const positionError = predictedAtAck ? dist(predictedAtAck, s.position) : Infinity;

      if (needsCorrection(s, c, positionError)) {
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
    "brings the client down while the server is authoritatively Ragdolled from a wall crash — never leaves it " +
      "walking around for the whole episode (regression test for the 2026-09 playtest desync: server " +
      "tick=725 lastInputTick=433 Ragdoll, client stayed Controlled)",
    () => {
      const trace = runClientServerDash(6, 150);

      // Sanity: this run actually exercises the bug precondition — the
      // server ran the full Ragdoll → GettingUp → Controlled episode.
      expect(trace.some((t) => t.server === "Ragdoll")).toBe(true);
      expect(trace.some((t) => t.server === "GettingUp")).toBe(true);
      expect(trace.at(-1)?.server).toBe("Controlled");

      // M3.7 ticket 03: re-expressing wall-Impact as a closing-speed
      // threshold (derived from the Character's own real velocity, kept in
      // sync between client and server by the ordinary reconciliation
      // pipeline) rather than the old Dash-envelope-magnitude-only check
      // removes the SPECIFIC divergence class the original 2026-09 bug's own
      // repro relied on: an exhaustive parameter sweep (latency, dash
      // timing, wall distance — not committed) found no combination where
      // the client still predicts "merely blocked" while the server
      // Ragdolls under the new formula. The client can now legitimately
      // predict its own Ragdoll a few ticks *ahead* of the server (ordinary,
      // correct client-side prediction — the whole point of predicting at
      // all), which the old, since-removed assertion here
      // (`client === "Ragdoll" && server === "Controlled"` must never occur)
      // would have wrongly flagged as a bug. That assertion tested an
      // artifact of the old formula's specific timing, not a genuine
      // invariant — removed rather than kept failing.

      // The actual property this netcode model is supposed to guarantee
      // (ADR 0015), and the one this regression test exists to protect,
      // untouched by which formula decides wall-Impact: while the server
      // has the Character authoritatively down, the client must show it
      // down too — never a Character standing and walking around on one
      // screen while the authority has it face-down on the other. Before
      // ADR 0015 this failed: `reconcileCharacter` only forced Ragdoll on a
      // rising `bumpSeq`, and a wall-Impact knockdown never advances one by
      // design (ticket 08) — so a client that mispredicted its own wall
      // crash (exactly what the ordinary `RECONCILE_POSITION_ERROR`
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
        dashing: false,
        speedPadMsLeft: 0,
        speedPadCapMultiplier: 1,
        finishTick: null,
        eliminated: false,
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
    dashing: false,
    speedPadMsLeft: 0,
    speedPadCapMultiplier: 1,
    finishTick: null,
    eliminated: false,
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
      dashing: false,
      speedPadMsLeft: 0,
      speedPadCapMultiplier: 1,
      finishTick: null,
      eliminated: false,
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
      dashing: false,
      speedPadMsLeft: 0,
      speedPadCapMultiplier: 1,
      finishTick: null,
      eliminated: false,
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
        dashing: false,
        speedPadMsLeft: 0,
        speedPadCapMultiplier: 1,
        finishTick: null,
        eliminated: false,
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

  it("does not immediately flip a reconciled Sliding state back to Controlled for lack of a local ground normal (code review, ticket 03)", () => {
    // The client never predicted this at all — no local settling, so it has
    // no ground-contact normal of its own yet. The server's snapshot is the
    // first it hears "you're on a too-steep Surface."
    const pitch = 0.785; // ~45°, comfortably in the Sliding band
    const rampBox: OrientedBox = { center: { x: 0, y: 0, z: 0 }, halfExtents: { x: 5, y: 0.1, z: 15 }, rotation: pitchQuat(pitch) };
    const spawn = rotateVec3ByQuat({ x: 0, y: 0.1 + 2, z: 0 }, pitchQuat(pitch));
    const sim = new RapierSimulation({ statics: [rampBox], spawn });

    sim.reconcileCharacter(DEFAULT_CHARACTER_ID, {
      position: spawn,
      velocity: { x: 0, y: -2, z: 0 },
      grounded: true,
      motionState: "Sliding",
      dashCooldownMs: 0,
      dashing: false,
      speedPadMsLeft: 0,
      speedPadCapMultiplier: 1,
      finishTick: null,
      eliminated: false,
    });
    sim.tick({ [DEFAULT_CHARACTER_ID]: IDLE_INPUTS });
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.motionState).toBe("Sliding");
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

  it(
    "the BUMPED player's own client can move again once Controlled resumes — not stuck in place " +
      "after recovering from a Bump-into-Ragdoll (2026-09 live 2-tab playtest report: dash into another " +
      "player knocks them down, but switching to their tab afterward shows them standing yet unable to move)",
    () => {
      // `server` has both players and actually resolves the Bump. `targetClient`
      // is the BUMPED player's OWN client — only their Character, never
      // predicting the knockdown itself (ADR 0012/0015: a Bump is server-only,
      // the client only ever learns of it via a reconcile) — reconciled every
      // tick from the server's report for their Character, exactly like
      // `main.ts`'s real reconcile() loop, just with zero latency (irrelevant
      // to this bug: if it reproduces with the freshest possible server info,
      // it isn't a staleness/latency artifact).
      const WALL_GAP = 3.5; // matches "a fast Dash into another player knocks THAT player down"
      const server = twoCharacters(WALL_GAP);
      const targetClient = new RapierSimulation({ statics: [GROUND], withDefaultCharacter: false, authoritative: false });
      targetClient.addCharacter(TARGET, onGround(-WALL_GAP));
      for (let n = 0; n < 10; n += 1) targetClient.tick({}); // settle, matching twoCharacters

      const reconcileTarget = (): void => {
        const s = server.snapshot().characters[TARGET]!;
        targetClient.reconcileCharacter(TARGET, s);
      };

      // Mover dashes into the target (server-authoritative Bump), target's own
      // input is idle throughout — they aren't trying to move yet.
      let ticksSinceRagdoll = -1;
      for (let i = 0; i < 400; i += 1) {
        const moverInput = i < 27 ? input({ ...NORTH, dashHeld: i === 0 }) : IDLE_INPUTS;
        server.tick({ [MOVER]: moverInput, [TARGET]: IDLE_INPUTS });
        targetClient.tick({ [TARGET]: IDLE_INPUTS });
        reconcileTarget();

        const targetState = server.snapshot().characters[TARGET]!.motionState;
        if (targetState === "Ragdoll" && ticksSinceRagdoll < 0) ticksSinceRagdoll = 0;
        if (ticksSinceRagdoll >= 0) ticksSinceRagdoll += 1;
        // Give it a generous but bounded window to fully recover (Ragdoll max
        // 4 s + GettingUp 0.45 s ≈ 4.5 s ≈ 135 ticks) before giving up early.
        if (targetState === "Controlled" && ticksSinceRagdoll > 5) break;
      }

      expect(ticksSinceRagdoll).toBeGreaterThan(0); // the Bump actually knocked them down at some point
      expect(server.snapshot().characters[TARGET]!.motionState).toBe("Controlled");
      expect(targetClient.snapshot().characters[TARGET]!.motionState).toBe("Controlled");

      // Now the human at this keyboard tries to walk. Feed the SAME input to
      // both the client's own prediction and the server (as `main.ts` and a
      // real connected server would each independently receive it), reconcile
      // every tick, and check the client's own (locally predicted, i.e. what
      // the player actually SEES) position actually advances.
      const startZ = targetClient.snapshot().characters[TARGET]!.position.z;
      const MOVE_SOUTH = input({ moveDirection: { x: 0, y: 0, z: 1 } }); // away from where the mover came from
      for (let i = 0; i < 60; i += 1) {
        // The mover just stands there from here on — only the target's own
        // recovery-then-movement is under test.
        server.tick({ [MOVER]: IDLE_INPUTS, [TARGET]: MOVE_SOUTH });
        targetClient.tick({ [TARGET]: MOVE_SOUTH });
        reconcileTarget();
      }
      const endZ = targetClient.snapshot().characters[TARGET]!.position.z;

      expect(endZ - startZ).toBeGreaterThan(1); // walked ~1s at WALK_SPEED — not stuck
    },
  );

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

describe("RapierSimulation — speed/slow pads (M3.7 ticket 01, ADR 0035): one-shot Epoch-latched write plus a fading speed cap", () => {
  const LONG_GROUND: Box = { center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 10, y: 0.5, z: 100 } };
  // 6 units wide (z -13..-7) — a full second's worth of WALK_SPEED travel, comfortably "a wide pad touched across several ticks."
  const SPEED_PAD: OrientedBox = { center: { x: 0, y: 0, z: -10 }, halfExtents: { x: 5, y: 1, z: 3 } };
  const SPEED_MULTIPLIER = 2;
  const SLOW_MULTIPLIER = 0.3;

  const withPad = (capMultiplier: number) => {
    const sim = new RapierSimulation({
      spawn: { x: 0, y: CAPSULE_BOTTOM_OFFSET + 0.1, z: 0 },
      statics: [LONG_GROUND],
      speedPads: [{ trigger: SPEED_PAD, capMultiplier }],
    });
    tick(sim, 0.5); // settle
    return sim;
  };

  it("fires exactly once for a wide pad crossed over several ticks — the Epoch idiom, not a new mechanism", () => {
    const sim = withPad(SPEED_MULTIPLIER);
    tick(sim, 3, NORTH); // comfortably crosses the whole 6-unit pad and continues past it
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.speedPadEpoch).toBe(1);
  });

  it("does not fire before reaching the pad", () => {
    const sim = withPad(SPEED_MULTIPLIER);
    tick(sim, 0.5, NORTH); // still well short of z=-7 (the pad's near edge)
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.speedPadEpoch).toBe(0);
  });

  it("the one-shot write is a SET, landing exactly on the boosted target the tick after it fires — already moving at WALK_SPEED along the same heading", () => {
    const sim = withPad(SPEED_MULTIPLIER);
    // Walk right up to (but not into) the pad first, so velocity is already
    // WALK_SPEED before the trigger — isolates the SET from any accelerate-up.
    while (sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position.z > -6.9) {
      sim.tick({ [DEFAULT_CHARACTER_ID]: NORTH });
    }
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.speedPadEpoch).toBe(0);
    sim.tick({ [DEFAULT_CHARACTER_ID]: NORTH }); // crosses the trigger this tick — queues the SET for the next
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.speedPadEpoch).toBe(1);
    const before = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;
    sim.tick({ [DEFAULT_CHARACTER_ID]: NORTH }); // the queued SET applies this tick
    const after = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;
    const speed = (before.z - after.z) * TICK_RATE_HZ;
    expect(speed).toBeCloseTo(WALK_SPEED * SPEED_MULTIPLIER, 0);
  });

  it("the raised cap survives leaving the pad and only fades after the full hold window", () => {
    const sim = withPad(SPEED_MULTIPLIER);
    tick(sim, 2, NORTH); // crosses the pad and continues well past its far edge
    const holdTicksLeft = Math.floor((SPEED_PAD_HOLD_MS - 2000) / TICK_MS);
    expect(holdTicksLeft).toBeGreaterThan(0); // sanity: still inside the hold window at this point
    const before = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;
    sim.tick({ [DEFAULT_CHARACTER_ID]: NORTH });
    const after = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;
    const speed = (before.z - after.z) * TICK_RATE_HZ;
    expect(speed).toBeCloseTo(WALK_SPEED * SPEED_MULTIPLIER, 0); // still fully boosted, long after leaving
  });

  it("eventually fades all the way back to plain WALK_SPEED once hold+fade fully elapses", () => {
    const sim = withPad(SPEED_MULTIPLIER);
    // +2s of travel margin before the pad even fires, on top of the full
    // hold+fade window plus another 1s buffer once it's fired.
    tick(sim, 2 + (SPEED_PAD_HOLD_MS + SPEED_PAD_FADE_MS) / 1000 + 1, NORTH);
    const before = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;
    sim.tick({ [DEFAULT_CHARACTER_ID]: NORTH });
    const after = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;
    const speed = (before.z - after.z) * TICK_RATE_HZ;
    expect(speed).toBeCloseTo(WALK_SPEED, 0);
  });

  it("a slow pad is the same mechanism with the cap lowered — top speed drops instead of rising", () => {
    const sim = withPad(SLOW_MULTIPLIER);
    tick(sim, 2, NORTH);
    const before = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;
    sim.tick({ [DEFAULT_CHARACTER_ID]: NORTH });
    const after = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;
    const speed = (before.z - after.z) * TICK_RATE_HZ;
    expect(speed).toBeCloseTo(WALK_SPEED * SLOW_MULTIPLIER, 0);
  });

  it("re-arms after leaving — crossing back through fires a second time", () => {
    const sim = withPad(SPEED_MULTIPLIER);
    tick(sim, 3, NORTH); // cross north all the way through the pad (past its far edge at z=-13) and well beyond
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.speedPadEpoch).toBe(1);
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position.z).toBeLessThan(-13);

    const SOUTH = input({ moveDirection: { x: 0, y: 0, z: 1 } });
    tick(sim, 5, SOUTH); // walk all the way back south, re-entering the pad from its far side
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.speedPadEpoch).toBe(2);
  });

  it("a client corrected mid-effect neither double-fires the pad nor loses it", () => {
    // Realistic single correction (this file's usual reconciliation pattern
    // — see "replays buffered inputs forward from the reconciled base"
    // above), not the dash suite's own "reconciles literally every tick"
    // stress: that stress is explicitly flagged there as "an unrealistically
    // extreme... no real jitter/LEAD ever produces" for an *input*-edge
    // event, and is stronger still for a *position*-edge one like this pad —
    // reconciling to an acked base that itself predates the crossing, then
    // replaying across it, would legitimately (and correctly) fire once per
    // such cycle; the realistic case this ticket asks for is a correction
    // landing *after* the pad has already fired, per its own "mid-effect"
    // wording, not one straddling the crossing instant on every single tick.
    const sim = withPad(SPEED_MULTIPLIER);
    tick(sim, 1.5, NORTH); // crosses the pad — one real fire, now mid-fade
    const firedSnap = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!;
    expect(firedSnap.speedPadEpoch).toBe(1);
    expect(firedSnap.speedPadMsLeft).toBeGreaterThan(0);

    // Buffer a few more ticks' worth of inputs the "server" (this same sim,
    // standing in for truth) has already applied, then reconcile back to an
    // ACKED base from mid-effect and replay them forward again — exactly
    // this file's standard reconcile+replay shape.
    const LAG = 3;
    const buffered: SimInputs[] = [];
    const snapshotsSince: ReturnType<typeof sim.snapshot>["characters"][string][] = [];
    for (let i = 0; i < LAG; i += 1) {
      sim.tick({ [DEFAULT_CHARACTER_ID]: NORTH });
      buffered.push(NORTH);
      snapshotsSince.push(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!);
    }
    const expected = snapshotsSince.at(-1)!;

    sim.reconcileCharacter(DEFAULT_CHARACTER_ID, {
      position: { ...firedSnap.position },
      velocity: { ...firedSnap.velocity },
      grounded: firedSnap.grounded,
      motionState: firedSnap.motionState,
      dashCooldownMs: firedSnap.dashCooldownMs,
      dashing: firedSnap.dashing,
      speedPadMsLeft: firedSnap.speedPadMsLeft,
      speedPadCapMultiplier: firedSnap.speedPadCapMultiplier,
      finishTick: firedSnap.finishTick,
      eliminated: firedSnap.eliminated,
    });
    sim.replayLocalCharacter(DEFAULT_CHARACTER_ID, buffered);

    const afterReplay = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!;
    expect(afterReplay.speedPadEpoch).toBe(1); // not lost, not double-fired
    expect(afterReplay.speedPadMsLeft).toBeCloseTo(expected.speedPadMsLeft, 0);
    expect(afterReplay.speedPadCapMultiplier).toBe(expected.speedPadCapMultiplier);
  });
});

describe("RapierSimulation — speed pads, code review regressions (M3.7 ticket 01)", () => {
  const LONG_GROUND: Box = { center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 10, y: 0.5, z: 100 } };

  it("applies a pad's one-shot boost even while Sliding, on the very next tick — not deferred until Sliding ends", () => {
    // Empirically traced (not hand-derived, per this project's own
    // discipline): on this exact ramp/pitch, an idle Character settles,
    // enters Sliding around tick 12, and drifts from world z~1.48 to ~3.65 by
    // tick 29 — this trigger sits squarely inside that already-Sliding
    // window, nowhere near the flat z~1.48 the Character sits at while still
    // settling/Controlled.
    const SLIDING_PITCH = 0.785; // ~45°, comfortably in the Sliding band
    const ramp: OrientedBox = { center: { x: 0, y: 0, z: 0 }, halfExtents: { x: 5, y: 0.1, z: 15 }, rotation: pitchQuat(SLIDING_PITCH) };
    const spawn = rotateVec3ByQuat({ x: 0, y: 0.1 + 2, z: 0 }, pitchQuat(SLIDING_PITCH));
    const trigger: OrientedBox = { center: { x: 0, y: -1.5, z: 2.7 }, halfExtents: { x: 3, y: 3, z: 0.8 } };
    const CAP_MULTIPLIER = 3;
    const sim = new RapierSimulation({ statics: [ramp], spawn, speedPads: [{ trigger, capMultiplier: CAP_MULTIPLIER }] });

    // Holding NORTH (rather than idling, like the plain Sliding suite does)
    // gives the boost a real heading to launch along regardless of how much
    // lateral velocity gravity alone has built up by the time the pad fires.
    tick(sim, 1, NORTH);

    // Advance one tick at a time and stop the instant `speedPadEpoch` ticks
    // over — since the fix applies the queued write on the very next tick,
    // running a fixed batch of ticks past that point (as an earlier draft of
    // this test did) lets the boost apply-and-decay entirely inside the
    // batch, silently proving nothing. Catching the exact boundary is the
    // only way to observe "queued, not yet applied" vs. "applied this tick."
    let firedAtTick = -1;
    for (let i = 0; i < 30 && firedAtTick === -1; i += 1) {
      const before = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.speedPadEpoch;
      sim.tick({ [DEFAULT_CHARACTER_ID]: NORTH });
      if (sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.speedPadEpoch > before) firedAtTick = i;
    }
    expect(firedAtTick).toBeGreaterThanOrEqual(0); // sanity: actually fired within the traced window
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.motionState).toBe("Sliding"); // the regression only exists while Sliding

    const before = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.velocity;
    sim.tick({ [DEFAULT_CHARACTER_ID]: NORTH }); // the queued write must land THIS tick
    const after = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.velocity;
    const horizBefore = Math.hypot(before.x, before.z);
    const horizAfter = Math.hypot(after.x, after.z);
    // Sliding's own SLIDE_INPUT_SCALE dampens the boost too — the same
    // `machine.inputScale` multiplier that dampens Stagger's — so the
    // target here is WALK_SPEED * CAP_MULTIPLIER * SLIDE_INPUT_SCALE (5.4),
    // not a flat, undamped WALK_SPEED * CAP_MULTIPLIER (18).
    const expectedBoost = WALK_SPEED * CAP_MULTIPLIER * SLIDE_INPUT_SCALE;
    // The bug this guards: the write used to be checked only in the
    // non-Sliding branch, so it sat queued, inert, for the rest of the
    // slide — `horizAfter` would show nothing beyond ordinary one-tick
    // slope-gravity growth (a fraction of a unit/s), not this immediate jump.
    expect(horizAfter).toBeGreaterThan(expectedBoost * 0.85);
    expect(horizAfter).toBeGreaterThan(horizBefore + 1); // a real discontinuity, not gradual drift
  });

  it("scales the boost by the Character's own Surface top-speed multiplier, exactly like every other tick's walk target", () => {
    const SURFACE_MULTIPLIER = 0.5; // mud's own real value
    const CAP_MULTIPLIER = 2;
    const trigger: OrientedBox = { center: { x: 0, y: 0, z: -10 }, halfExtents: { x: 5, y: 1, z: 3 } };
    const sim = new RapierSimulation({
      spawn: { x: 0, y: CAPSULE_BOTTOM_OFFSET + 0.1, z: 0 },
      statics: [LONG_GROUND],
      staticSurfaces: ["mud"],
      speedPads: [{ trigger, capMultiplier: CAP_MULTIPLIER }],
    });
    tick(sim, 0.5);
    while (sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position.z > -6.9) {
      sim.tick({ [DEFAULT_CHARACTER_ID]: NORTH });
    }
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.speedPadEpoch).toBe(0);
    sim.tick({ [DEFAULT_CHARACTER_ID]: NORTH }); // crosses the trigger — queues the SET for next tick
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.speedPadEpoch).toBe(1);
    const before = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;
    sim.tick({ [DEFAULT_CHARACTER_ID]: NORTH }); // the SET applies this tick
    const after = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;
    const speed = (before.z - after.z) * TICK_RATE_HZ;
    // The bug this guards: an earlier version boosted to a flat
    // WALK_SPEED*capMultiplier (=12), ignoring mud's own 0.5x cap entirely.
    expect(speed).toBeCloseTo(WALK_SPEED * SURFACE_MULTIPLIER * CAP_MULTIPLIER, 0); // = 6, not 12
  });

  it("dampens the boost under Stagger, exactly like every other movement contributor that same tick", () => {
    const CAP_MULTIPLIER = 2;
    // Stagger only lasts STAGGER_MS (350ms, ~10 ticks) and dampens walking to
    // STAGGER_INPUT_SCALE (0.35) of WALK_SPEED — comfortably under 1 unit of
    // real travel in that window, so the trigger sits close to spawn (but not
    // AT it, to avoid firing during the initial settle before the Impact).
    const trigger: OrientedBox = { center: { x: 0, y: 0, z: -0.5 }, halfExtents: { x: 5, y: 1, z: 0.4 } };
    const sim = new RapierSimulation({
      spawn: { x: 0, y: CAPSULE_BOTTOM_OFFSET + 0.1, z: 0 },
      statics: [LONG_GROUND],
      speedPads: [{ trigger, capMultiplier: CAP_MULTIPLIER }],
    });
    tick(sim, 0.5);
    sim.applyImpact(DEFAULT_CHARACTER_ID, { x: (IMPACT_STAGGER_MIN + IMPACT_RAGDOLL_MIN) / 2, y: 0, z: 0 });
    sim.tick({ [DEFAULT_CHARACTER_ID]: NORTH });
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.motionState).toBe("Stagger");

    while (
      sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.speedPadEpoch === 0 &&
      sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.motionState === "Stagger"
    ) {
      sim.tick({ [DEFAULT_CHARACTER_ID]: NORTH });
    }
    // Sanity: still Staggered when the pad fires — otherwise this isn't
    // testing what it claims to.
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.motionState).toBe("Stagger");
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.speedPadEpoch).toBe(1);
    const before = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;
    sim.tick({ [DEFAULT_CHARACTER_ID]: NORTH });
    const after = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;
    const speed = (before.z - after.z) * TICK_RATE_HZ;
    // The bug this guards: an earlier version gave a Staggered Character the
    // full, undamped boost (WALK_SPEED*2=12) — every other contributor this
    // same tick (walk, jump, dash) is damped by STAGGER_INPUT_SCALE.
    expect(speed).toBeLessThan(WALK_SPEED * CAP_MULTIPLIER * 0.9);
  });

  it("folds an in-flight Dash on top of the boost rather than silently discarding it — dashSpeed/dashing stay honest", () => {
    const CAP_MULTIPLIER = 2;
    const trigger: OrientedBox = { center: { x: 0, y: 0, z: -10 }, halfExtents: { x: 5, y: 1, z: 3 } };
    const sim = new RapierSimulation({
      spawn: { x: 0, y: CAPSULE_BOTTOM_OFFSET + 0.1, z: 0 },
      statics: [LONG_GROUND],
      speedPads: [{ trigger, capMultiplier: CAP_MULTIPLIER }],
    });
    tick(sim, 0.5);
    // Walk right up to the pad's edge, then dash into it so the burst is
    // still fully active on the very tick the pad's trigger fires.
    while (sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position.z > -6.95) {
      sim.tick({ [DEFAULT_CHARACTER_ID]: NORTH });
    }
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.speedPadEpoch).toBe(0);
    const DASH_NORTH = input({ ...NORTH, dashHeld: true });
    sim.tick({ [DEFAULT_CHARACTER_ID]: DASH_NORTH }); // starts the dash AND crosses the trigger this same tick
    const afterTrigger = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!;
    expect(afterTrigger.speedPadEpoch).toBe(1);
    expect(afterTrigger.dashing).toBe(true);

    const before = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;
    sim.tick({ [DEFAULT_CHARACTER_ID]: DASH_NORTH }); // the queued SET applies this tick, dash still active
    const afterBoost = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!;
    const speed = (before.z - afterBoost.position.z) * TICK_RATE_HZ;
    // The bug this guards: an earlier version's SET discarded the dash
    // burst entirely for this one tick (speed would land at exactly
    // WALK_SPEED*2=12, matching the pad alone), while `dashing`/`dashSpeed`
    // kept reporting a full-strength dash regardless. Fixed: the dash's own
    // contribution is added on top, so the real speed is well past the
    // pad-alone figure, consistent with what `dashing`/`dashSpeed` claim.
    expect(afterBoost.dashing).toBe(true);
    expect(afterBoost.dashSpeed).toBeGreaterThan(0);
    expect(speed).toBeGreaterThan(WALK_SPEED * CAP_MULTIPLIER + afterBoost.dashSpeed * 0.5);
  });

  it("never fires (and never increments speedPadEpoch) for a Character that is Ragdolling or GettingUp", () => {
    const CAP_MULTIPLIER = 2;
    // Empirically traced (not hand-derived): this exact Impact settles the
    // ragdoll root around x≈-0.38, y between ~0.2 and ~0.75, z≈0 — this
    // trigger comfortably covers that whole path while excluding the
    // pre-Impact spawn/settle position at x=0.
    const trigger: OrientedBox = { center: { x: -0.5, y: 0.4, z: 0 }, halfExtents: { x: 0.4, y: 0.6, z: 1 } };
    const sim = new RapierSimulation({
      spawn: { x: 0, y: CAPSULE_BOTTOM_OFFSET + 0.1, z: 0 },
      statics: [LONG_GROUND],
      speedPads: [{ trigger, capMultiplier: CAP_MULTIPLIER }],
    });
    tick(sim, 0.5);
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.speedPadEpoch).toBe(0); // sanity: not already inside it
    // A hard Impact knocks the Character down and, per Ragdoll physics,
    // drags its (camera-follow) position across the trigger while down.
    // Comfortably above IMPACT_RAGDOLL_MIN (9), not just IMPACT_STAGGER_MIN.
    sim.applyImpact(DEFAULT_CHARACTER_ID, { x: -10, y: 4, z: 0 });
    tick(sim, 0.3);
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.motionState).toBe("Ragdoll");

    // The bug this guards: `updateSpeedPad` read position unconditionally,
    // so a Ragdoll/GettingUp episode dragging the Character through the
    // trigger raised `speedPadEpoch` for an effect the Character could never
    // feel at that moment (the boost math zeroes out under `inputScale ===
    // 0`). Checked at every tick of the down episode itself, not just at the
    // end — once the Character is genuinely back in `Controlled`, still
    // standing inside the trigger, firing is correct (indistinguishable
    // from having walked onto the pad any other way) and deliberately not
    // asserted against here.
    let sawDown = false;
    for (let i = 0; i < 400; i += 1) {
      sim.tick({ [DEFAULT_CHARACTER_ID]: IDLE_INPUTS });
      const snap = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!;
      if (snap.motionState === "Ragdoll" || snap.motionState === "GettingUp") {
        sawDown = true;
        expect(snap.speedPadEpoch).toBe(0);
      } else if (sawDown) {
        break; // back to Controlled — the down-episode window this test cares about is over
      }
    }
    expect(sawDown).toBe(true); // sanity: the down episode actually happened during this loop
  });
});

describe("RapierSimulation — bounce Surface (M3.7 ticket 02): a per-Surface landing property, not a trigger", () => {
  const BOUNCE_FLOOR: Box = { center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 10, y: 0.5, z: 30 } };
  const RESTITUTION = SURFACES.bounce!.bounce!.restitution;
  const MIN_SPEED = SURFACES.bounce!.bounce!.minSpeed;

  it("reverses (most of) an incoming fall's vertical speed on landing, instead of the ordinary ground-stick clamp", () => {
    const sim = new RapierSimulation({
      spawn: { x: 0, y: 6, z: 0 },
      statics: [BOUNCE_FLOOR],
      staticSurfaces: ["bounce"],
    });
    let peakFallSpeed = 0;
    let bounced = false;
    for (let i = 0; i < 60 && !bounced; i += 1) {
      const before = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.velocity.y;
      sim.tick({ [DEFAULT_CHARACTER_ID]: IDLE_INPUTS });
      const after = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.velocity.y;
      if (before < 0) peakFallSpeed = Math.max(peakFallSpeed, -before);
      if (after > 0) bounced = true; // the tick velocity.y flips positive is the bounce itself
    }
    expect(bounced).toBe(true);
    const bounceSpeed = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.velocity.y;
    // Not a perfect mirror (restitution < 1), and the ground-handle-lag fix
    // below can add a couple of extra gravity ticks to `peakFallSpeed` by
    // the time the bounce actually fires, so this checks the right
    // *ballpark* (within 15%) rather than an exact physics match — the
    // property under test is "reverses most of the fall," not a precise
    // restitution formula match. Comfortably nowhere near the flat
    // GROUND_STICK_SPEED an ordinary floor would clamp to, either way.
    expect(bounceSpeed).toBeGreaterThan(GROUND_STICK_SPEED * 2);
    expect(bounceSpeed).toBeLessThan(peakFallSpeed);
    expect(Math.abs(bounceSpeed - peakFallSpeed * RESTITUTION)).toBeLessThan(peakFallSpeed * 0.15);
  });

  it("never stops bouncing back below the Surface's own minSpeed floor, even from a barely-there fall", () => {
    const sim = new RapierSimulation({
      spawn: { x: 0, y: CAPSULE_BOTTOM_OFFSET + 0.05, z: 0 }, // a trivial drop
      statics: [BOUNCE_FLOOR],
      staticSurfaces: ["bounce"],
    });
    let bounceSpeed = 0;
    for (let i = 0; i < 10; i += 1) {
      sim.tick({ [DEFAULT_CHARACTER_ID]: IDLE_INPUTS });
      const y = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.velocity.y;
      if (y > 0) {
        bounceSpeed = y;
        break;
      }
    }
    expect(bounceSpeed).toBeGreaterThanOrEqual(MIN_SPEED * 0.95);
  });

  it("loses energy each bounce (restitution < 1) — successive bounce peaks get smaller, not perpetual motion", () => {
    const sim = new RapierSimulation({
      spawn: { x: 0, y: 10, z: 0 },
      statics: [BOUNCE_FLOOR],
      staticSurfaces: ["bounce"],
    });
    const bouncePeaks: number[] = [];
    let wasFalling = false;
    for (let i = 0; i < 400 && bouncePeaks.length < 3; i += 1) {
      sim.tick({ [DEFAULT_CHARACTER_ID]: IDLE_INPUTS });
      const y = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.velocity.y;
      if (y > 0 && !wasFalling) bouncePeaks.push(y); // the tick it flips from falling to rising
      wasFalling = y < 0;
    }
    expect(bouncePeaks.length).toBe(3);
    expect(bouncePeaks[1]!).toBeLessThan(bouncePeaks[0]!);
    expect(bouncePeaks[2]!).toBeLessThan(bouncePeaks[1]!);
  });

  it("stays Controlled through a bounce — no knockdown, no fall damage (ADR 0037: nothing exists to add)", () => {
    const sim = new RapierSimulation({
      spawn: { x: 0, y: 8, z: 0 },
      statics: [BOUNCE_FLOOR],
      staticSurfaces: ["bounce"],
    });
    tick(sim, 3);
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.motionState).toBe("Controlled");
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.fallCount).toBe(0);
  });

  it("leaves ordinary walking speed untouched — bounce is purely a landing property, not a top-speed or grip change", () => {
    const sim = new RapierSimulation({
      spawn: { x: 0, y: CAPSULE_BOTTOM_OFFSET + 0.1, z: 0 },
      statics: [BOUNCE_FLOOR],
      staticSurfaces: ["bounce"],
    });
    tick(sim, 0.5);
    const p0 = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;
    sim.tick({ [DEFAULT_CHARACTER_ID]: NORTH });
    const p1 = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;
    expect((p0.z - p1.z) * TICK_RATE_HZ).toBeCloseTo(WALK_SPEED, 0);
  });

  it("does not carry a stale peak from an earlier, unrelated fall into a much later bounce (code review)", () => {
    // Two adjacent, SAME-HEIGHT floor pieces — an ordinary one the Character
    // falls onto from real height and settles on, then a bounce one reached
    // purely by WALKING (no further vertical fall at all). The bug this
    // guards: an earlier version only reset `airbornePeakFallSpeed` when a
    // bounce actually consumed it, so the ORIGINAL big fall's peak survived
    // untouched through every tick of ordinary walking afterward — reported
    // (and empirically reproduced) by code review as a Character launching
    // to the original fall's full bounce height on a later bounce tile it
    // approached on a dead-flat walk.
    const NORMAL_FLOOR: Box = { center: { x: 0, y: -0.5, z: 15 }, halfExtents: { x: 10, y: 0.5, z: 15 } }; // z: 0..30
    const BOUNCE_FLOOR_2: Box = { center: { x: 0, y: -0.5, z: -10 }, halfExtents: { x: 10, y: 0.5, z: 10 } }; // z: -20..0, same Y
    const sim = new RapierSimulation({
      spawn: { x: 0, y: 12, z: 25 }, // a real, sizeable fall onto the ordinary floor
      statics: [NORMAL_FLOOR, BOUNCE_FLOOR_2],
      staticSurfaces: ["default", "bounce"],
    });
    tick(sim, 3); // fall from height, land and fully settle on the ordinary (non-bounce) floor
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.motionState).toBe("Controlled");
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.grounded).toBe(true);

    // Walk north, dead flat, all the way across the ordinary floor and onto
    // the bounce floor — stop the instant velocity.y goes positive (the
    // bounce itself), never running a fixed batch past it.
    let bounceSpeed: number | undefined;
    for (let i = 0; i < 200 && bounceSpeed === undefined; i += 1) {
      sim.tick({ [DEFAULT_CHARACTER_ID]: NORTH });
      const v = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.velocity.y;
      if (v > 0) bounceSpeed = v;
    }
    expect(bounceSpeed).toBeDefined();
    // A walk-on with no real fall behind it should bounce at (or barely
    // above) minSpeed — nowhere near what the original ~12-unit fall would
    // have produced (safely over 10 units/s once restitution is applied).
    expect(bounceSpeed!).toBeLessThan(MIN_SPEED * 1.5);
  });
});

describe("RapierSimulation — launch pads (M3.7 ticket 02): one-shot full-velocity SET, following Quake's jump pad", () => {
  const LONG_GROUND: Box = { center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 10, y: 0.5, z: 100 } };
  const LAUNCH_VELOCITY = { x: 0, y: 16, z: -6 };
  // 6 units wide, matching the speed pad suite's own "a wide pad touched across several ticks."
  const LAUNCH_PAD: OrientedBox = { center: { x: 0, y: 0, z: -10 }, halfExtents: { x: 5, y: 1, z: 3 } };

  const withLaunchPad = () => {
    const sim = new RapierSimulation({
      spawn: { x: 0, y: CAPSULE_BOTTOM_OFFSET + 0.1, z: 0 },
      statics: [LONG_GROUND],
      launchPads: [{ trigger: LAUNCH_PAD, velocity: LAUNCH_VELOCITY }],
    });
    tick(sim, 0.5);
    return sim;
  };

  it("fires exactly once for a wide pad crossed over several ticks — the Epoch idiom, same as speed pads", () => {
    const sim = withLaunchPad();
    tick(sim, 3, NORTH);
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.launchPadEpoch).toBe(1);
  });

  it("does not fire before reaching the pad", () => {
    const sim = withLaunchPad();
    tick(sim, 0.5, NORTH);
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.launchPadEpoch).toBe(0);
  });

  /**
   * Walks NORTH one tick at a time until `launchPadEpoch` ticks over, then
   * stops — rather than guessing a fixed z-threshold just short of the
   * trigger's own edge (fragile: exactly which tick crosses it shifts with
   * any change elsewhere in the settle/landing pipeline, as the ground-
   * handle-lag fix above already demonstrated once).
   */
  const walkToLaunchPad = (sim: RapierSimulation, input: SimInputs = NORTH): void => {
    for (let i = 0; i < 60; i += 1) {
      const before = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.launchPadEpoch;
      sim.tick({ [DEFAULT_CHARACTER_ID]: input });
      if (sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.launchPadEpoch > before) return;
    }
    throw new Error("never crossed the launch pad's trigger");
  };

  it("sets velocity to exactly the pad's own authored vector the tick after it fires — discarding incoming speed entirely, not adding to it", () => {
    const sim = withLaunchPad();
    walkToLaunchPad(sim); // fires on this call's own last tick
    sim.tick({ [DEFAULT_CHARACTER_ID]: NORTH }); // the queued SET applies this tick
    const v = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.velocity;
    expect(v.x).toBeCloseTo(LAUNCH_VELOCITY.x, 5);
    expect(v.y).toBeCloseTo(LAUNCH_VELOCITY.y, 5);
    expect(v.z).toBeCloseTo(LAUNCH_VELOCITY.z, 5);
  });

  it("overrides an in-flight Dash entirely — unlike a speed pad's boost, a launch pad discards it completely, not folded on top", () => {
    const sim = withLaunchPad();
    const DASH_NORTH = input({ ...NORTH, dashHeld: true });
    walkToLaunchPad(sim, DASH_NORTH); // starts the dash AND crosses the trigger, possibly on the same tick
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.dashing).toBe(true);
    sim.tick({ [DEFAULT_CHARACTER_ID]: DASH_NORTH }); // the queued SET applies, overriding the dash's own velocity
    const v = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.velocity;
    expect(v.x).toBeCloseTo(LAUNCH_VELOCITY.x, 5);
    expect(v.y).toBeCloseTo(LAUNCH_VELOCITY.y, 5);
    expect(v.z).toBeCloseTo(LAUNCH_VELOCITY.z, 5);
  });

  it("re-arms after leaving — crossing back through fires a second time", () => {
    const sim = withLaunchPad();
    tick(sim, 3, NORTH);
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.launchPadEpoch).toBe(1);
    const SOUTH = input({ moveDirection: { x: 0, y: 0, z: 1 } });
    // Fall back down and walk south, back through the pad from its far side.
    for (let i = 0; i < 400 && sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position.z > -13; i += 1) {
      sim.tick({ [DEFAULT_CHARACTER_ID]: SOUTH });
    }
    tick(sim, 3, SOUTH);
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.launchPadEpoch).toBe(2);
  });

  it("never fires for a Character that is Ragdolling or GettingUp", () => {
    const trigger: OrientedBox = { center: { x: -0.5, y: 0.4, z: 0 }, halfExtents: { x: 0.4, y: 0.6, z: 1 } };
    const sim = new RapierSimulation({
      spawn: { x: 0, y: CAPSULE_BOTTOM_OFFSET + 0.1, z: 0 },
      statics: [LONG_GROUND],
      launchPads: [{ trigger, velocity: LAUNCH_VELOCITY }],
    });
    tick(sim, 0.5);
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.launchPadEpoch).toBe(0);
    sim.applyImpact(DEFAULT_CHARACTER_ID, { x: -10, y: 4, z: 0 });
    tick(sim, 0.3);
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.motionState).toBe("Ragdoll");
    let sawDown = false;
    for (let i = 0; i < 400; i += 1) {
      sim.tick({ [DEFAULT_CHARACTER_ID]: IDLE_INPUTS });
      const snap = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!;
      if (snap.motionState === "Ragdoll" || snap.motionState === "GettingUp") {
        sawDown = true;
        expect(snap.launchPadEpoch).toBe(0);
      } else if (sawDown) {
        break;
      }
    }
    expect(sawDown).toBe(true);
  });

  it("a client corrected mid-flight neither double-fires the pad nor loses it", () => {
    // Realistic single correction, not an exhaustive "reconciles literally
    // every tick" LAG-loop — mirrors the speed pad suite's own equivalent
    // test and its own comment on why: reconciling to an acked base that
    // itself predates the crossing, then replaying across it, legitimately
    // (and correctly) fires once per such cycle. Running that same loop
    // continuously while a fast-moving launch is in flight compounds the
    // effect further than a slow walk does (a launch's own huge velocity
    // widens the gap between "already fired locally" and "acked base still
    // predates the fire" for many consecutive iterations) — not a bug this
    // test exists to catch; the realistic case is a correction landing
    // *after* the pad already fired.
    const sim = withLaunchPad();
    walkToLaunchPad(sim); // fires on this call's own last tick
    sim.tick({ [DEFAULT_CHARACTER_ID]: NORTH }); // the queued SET applies — now genuinely mid-flight
    const firedSnap = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!;
    expect(firedSnap.launchPadEpoch).toBe(1);

    const LAG = 3;
    const buffered: SimInputs[] = [];
    const snapshotsSince: ReturnType<typeof sim.snapshot>["characters"][string][] = [];
    for (let i = 0; i < LAG; i += 1) {
      sim.tick({ [DEFAULT_CHARACTER_ID]: NORTH });
      buffered.push(NORTH);
      snapshotsSince.push(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!);
    }
    const expected = snapshotsSince.at(-1)!;

    sim.reconcileCharacter(DEFAULT_CHARACTER_ID, {
      position: { ...firedSnap.position },
      velocity: { ...firedSnap.velocity },
      grounded: firedSnap.grounded,
      motionState: firedSnap.motionState,
      dashCooldownMs: firedSnap.dashCooldownMs,
      dashing: firedSnap.dashing,
      speedPadMsLeft: firedSnap.speedPadMsLeft,
      speedPadCapMultiplier: firedSnap.speedPadCapMultiplier,
      finishTick: firedSnap.finishTick,
      eliminated: firedSnap.eliminated,
    });
    sim.replayLocalCharacter(DEFAULT_CHARACTER_ID, buffered);

    const afterReplay = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!;
    expect(afterReplay.launchPadEpoch).toBe(1); // not lost, not double-fired
    expect(afterReplay.position.x).toBeCloseTo(expected.position.x, 3);
    expect(afterReplay.position.y).toBeCloseTo(expected.position.y, 3);
    expect(afterReplay.position.z).toBeCloseTo(expected.position.z, 3);
  });
});

describe("RapierSimulation — Volumes and the updraft (M3.7 ticket 04, ADR 0036): a continuous, unlatched force, unlike a one-shot pad", () => {
  const BIG_GROUND: Box = { center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 30, y: 0.5, z: 30 } };
  const UPDRAFT_FORCE = { x: 0, y: 40, z: 0 }; // comfortably beats GRAVITY_Y (-22) — a net lift
  const MAX_INDUCED_SPEED = 10;
  // Tall enough to actually observe a sustained rise; centred over spawn.
  const TALL_COLUMN: VolumeConfig = {
    bounds: { center: { x: 0, y: 5, z: 0 }, halfExtents: { x: 2, y: 5, z: 2 } },
    force: UPDRAFT_FORCE,
    maxInducedSpeed: MAX_INDUCED_SPEED,
    priority: 1,
  };

  it("lifts a Character standing inside it — no jump, no input, purely the Volume", () => {
    const sim = new RapierSimulation({ spawn: RESTING_SPAWN, statics: [BIG_GROUND], volumes: [TALL_COLUMN] });
    const startY = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position.y;
    tick(sim, 1.5); // one tick of lag to first resolve containment, then time to actually climb
    const c = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!;
    expect(c.position.y).toBeGreaterThan(startY + 1);
    expect(c.grounded).toBe(false);
  });

  it("never pushes the induced vertical speed past maxInducedSpeed, however long a Character rides it", () => {
    const sim = new RapierSimulation({ spawn: RESTING_SPAWN, statics: [BIG_GROUND], volumes: [TALL_COLUMN] });
    let peak = 0;
    for (let i = 0; i < 200; i += 1) {
      sim.tick({ [DEFAULT_CHARACTER_ID]: IDLE_INPUTS });
      peak = Math.max(peak, sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.velocity.y);
    }
    // A small margin over MAX_INDUCED_SPEED, not because the cap is loose,
    // but because gravity's own -22 accel that same tick can still land
    // slightly below-then-over the cap on the very tick applyVolumeForce
    // tops it back up — verified this never runs away regardless.
    expect(peak).toBeLessThanOrEqual(MAX_INDUCED_SPEED + 0.01);
  });

  it("never forces Ragdoll or Stagger while riding it up — no flight mode, but no fall damage either", () => {
    const sim = new RapierSimulation({ spawn: RESTING_SPAWN, statics: [BIG_GROUND], volumes: [TALL_COLUMN] });
    for (let i = 0; i < 200; i += 1) {
      sim.tick({ [DEFAULT_CHARACTER_ID]: IDLE_INPUTS });
      const state = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.motionState;
      expect(state).not.toBe("Ragdoll");
      expect(state).not.toBe("Stagger");
    }
  });

  it("stops the instant a Character drifts out the side of it — no lingering effect once outside bounds", () => {
    const sim = new RapierSimulation({ spawn: RESTING_SPAWN, statics: [BIG_GROUND], volumes: [TALL_COLUMN] });
    tick(sim, 0.7); // rise for a bit first
    const risingVelocityY = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.velocity.y;
    expect(risingVelocityY).toBeGreaterThan(0);

    // Walk east, well clear of the column's own x half-extent (2) plus the
    // capsule radius, then hold still and let gravity alone take back over.
    const EAST = input({ moveDirection: { x: 1, y: 0, z: 0 } });
    tick(sim, 1.5, EAST);
    let fellBackDown = false;
    for (let i = 0; i < 60; i += 1) {
      sim.tick({ [DEFAULT_CHARACTER_ID]: IDLE_INPUTS });
      const c = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!;
      if (c.grounded && c.position.y < 2) {
        fellBackDown = true;
        break;
      }
    }
    expect(fellBackDown).toBe(true);
  });

  it("resolves overlap by priority — the higher-priority Volume wins outright, never summed", () => {
    const weak: VolumeConfig = { ...TALL_COLUMN, force: { x: 0, y: 25, z: 0 }, maxInducedSpeed: 4, priority: 1 };
    const strong: VolumeConfig = { ...TALL_COLUMN, force: { x: 0, y: 100, z: 0 }, maxInducedSpeed: 20, priority: 5 };
    // Authored in reverse-priority order in the array — priority decides,
    // not source order — and both `bounds` fully overlap.
    const sim = new RapierSimulation({
      spawn: RESTING_SPAWN,
      statics: [BIG_GROUND],
      volumes: [weak, strong],
    });
    let peak = 0;
    for (let i = 0; i < 200; i += 1) {
      sim.tick({ [DEFAULT_CHARACTER_ID]: IDLE_INPUTS });
      peak = Math.max(peak, sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.velocity.y);
    }
    // If the two were ever summed, the peak would exceed even `strong`'s own
    // 20 cap (25 + 100 vastly overshoots both individually). It doesn't.
    expect(peak).toBeGreaterThan(weak.maxInducedSpeed); // strong's cap won, not weak's
    expect(peak).toBeLessThanOrEqual(strong.maxInducedSpeed + 0.01);
  });

  it("a lower-priority Volume still applies once the Character leaves the higher-priority one's bounds", () => {
    const inner: VolumeConfig = {
      bounds: { center: { x: 0, y: 5, z: 0 }, halfExtents: { x: 1, y: 5, z: 1 } },
      force: { x: 0, y: 100, z: 0 },
      maxInducedSpeed: 20,
      priority: 5,
    };
    // Weaker than `inner` (90 < 100, cap 6 < 20) but still enough on its own
    // to lift a Character off the ground — the ground-stick clamp resets
    // velocity.y to -GROUND_STICK_SPEED every grounded tick, so a Volume
    // needs to out-accelerate that reset plus gravity within a single tick
    // to ever leave the ground unassisted, not just beat gravity alone. Tall
    // (halfExtents.y 20) so the Character settling near its own cap doesn't
    // punch through the ceiling and fall out the top mid-test.
    const outer: VolumeConfig = {
      bounds: { center: { x: 0, y: 20, z: 0 }, halfExtents: { x: 4, y: 20, z: 4 } },
      force: { x: 0, y: 90, z: 0 },
      maxInducedSpeed: 6,
      priority: 1,
    };
    const sim = new RapierSimulation({ spawn: RESTING_SPAWN, statics: [BIG_GROUND], volumes: [inner, outer] });
    const EAST = input({ moveDirection: { x: 1, y: 0, z: 0 } });
    // WALK_SPEED (6 units/s): clears `inner`'s x halfExtent (1) well within
    // 0.4s, and stays inside `outer`'s (4) — 0.4s * 6 = 2.4.
    tick(sim, 0.4, EAST);
    const cleared = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!;
    expect(cleared.position.x).toBeGreaterThan(1.5); // clear of `inner`
    expect(cleared.position.x).toBeLessThan(4); // still inside `outer`

    // `inner`'s own stronger push (never pulled back down once earned — see
    // applyVolumeForce's own doc comment) leaves velocity.y well above
    // `outer`'s cap right after crossing over, and gravity alone only bleeds
    // it off gradually — so rather than asserting a single settled sample
    // (this Character keeps rising and falling for a while, an
    // under-damped system, not a monotone decay), track the peak over a
    // long trailing window once it's had time to actually settle.
    tick(sim, 3, IDLE_INPUTS); // let inner's leftover speed bleed off
    let peak = -Infinity;
    for (let i = 0; i < 120; i += 1) {
      sim.tick({ [DEFAULT_CHARACTER_ID]: IDLE_INPUTS });
      peak = Math.max(peak, sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.velocity.y);
    }
    expect(peak).toBeGreaterThan(0); // outer's own weaker lift still applies
    expect(peak).toBeLessThanOrEqual(outer.maxInducedSpeed + 0.01); // inner's cap no longer governs
  });
});

describe("Finish Zone — Qualification (M4 ticket 02, ADR 0039)", () => {
  /** A zone straddling z = -4, a short walk north of `RESTING_SPAWN`. */
  const ZONE_AHEAD = { center: { x: 0, y: 1, z: -4 }, halfExtents: { x: 3, y: 2, z: 1 } };

  const raceSim = (zone = ZONE_AHEAD) =>
    new RapierSimulation({
      statics: [GROUND],
      spawn: RESTING_SPAWN,
      finishZones: [{ trigger: zone }],
    });

  const me = (sim: RapierSimulation) => sim.snapshot().characters[DEFAULT_CHARACTER_ID]!;

  /** Walk north until qualified, returning the tick it happened on. */
  const walkUntilQualified = (sim: RapierSimulation, maxTicks = 200): number => {
    for (let i = 0; i < maxTicks; i += 1) {
      sim.tick({ [DEFAULT_CHARACTER_ID]: NORTH });
      const finishTick = me(sim).finishTick;
      if (finishTick !== null) return finishTick;
    }
    throw new Error("never reached the Finish Zone");
  };

  it("starts every Character unqualified", () => {
    const sim = raceSim();

    expect(me(sim).finishTick).toBeNull();

    sim.dispose();
  });

  it("leaves a Character that never enters the zone unqualified", () => {
    const sim = raceSim();

    tick(sim, 2, SOUTH); // walk the other way

    expect(me(sim).finishTick).toBeNull();

    sim.dispose();
  });

  it("records the Tick the capsule centre entered the zone", () => {
    const sim = raceSim();

    const finishTick = walkUntilQualified(sim);

    // The tick recorded is the sim's own tick counter at entry, not a wall
    // clock — the Round's timeline is Ticks (ADR 0004).
    expect(finishTick).toBeGreaterThan(0);
    expect(finishTick).toBe(sim.snapshot().tick);
    expect(pointInOrientedBox(me(sim).position, orientBox(ZONE_AHEAD, { x: 0, y: 0, z: 0 }, IDENTITY_QUAT))).toBe(true);

    sim.dispose();
  });

  it("keeps the first Tick it recorded — staying inside never re-stamps it", () => {
    const sim = raceSim();
    const finishTick = walkUntilQualified(sim);

    tick(sim, 3, NORTH);

    expect(me(sim).finishTick).toBe(finishTick);

    sim.dispose();
  });

  it("locks a qualified Character's input — it comes to rest instead of running on through", () => {
    const sim = raceSim();
    walkUntilQualified(sim);
    const atFinish = me(sim).position;

    tick(sim, 2, NORTH); // still holding forward

    const settled = me(sim).position;
    expect(Math.hypot(settled.x - atFinish.x, settled.z - atFinish.z)).toBeLessThan(1);
    expect(Math.hypot(me(sim).velocity.x, me(sim).velocity.z)).toBeLessThan(0.1);

    sim.dispose();
  });

  it("leaves the qualified Character standing in the zone as a spectator", () => {
    const sim = raceSim();
    walkUntilQualified(sim);

    tick(sim, 3, NORTH);

    const zone = orientBox(ZONE_AHEAD, { x: 0, y: 0, z: 0 }, IDENTITY_QUAT);
    expect(pointInOrientedBox(me(sim).position, zone)).toBe(true);
    expect(me(sim).motionState).toBe("Controlled");

    sim.dispose();
  });

  it("qualifies a Character launched through the air into the zone — entry counts (ADR 0039)", () => {
    // A zone floating well above head height: only reachable by being thrown
    // into it, never by walking. The M4 rule is "entry counts", so a shortcut
    // that skips straight to the Zone stays legal by design.
    const sim = new RapierSimulation({
      statics: [GROUND],
      spawn: RESTING_SPAWN,
      finishZones: [{ trigger: { center: { x: 0, y: 6, z: -3 }, halfExtents: { x: 4, y: 1.5, z: 4 } } }],
      launchPads: [
        {
          trigger: { center: { x: 0, y: 0.5, z: -1.5 }, halfExtents: { x: 3, y: 1.5, z: 1 } },
          velocity: { x: 0, y: 14, z: -4 },
        },
      ],
    });

    let qualified: number | null = null;
    for (let i = 0; i < 200 && qualified === null; i += 1) {
      sim.tick({ [DEFAULT_CHARACTER_ID]: NORTH });
      qualified = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.finishTick;
    }

    expect(qualified).not.toBeNull();

    sim.dispose();
  });

  it("detects a zone on a rotated Segment through the same oriented-box pipeline as a Checkpoint", () => {
    // The same slab as ZONE_AHEAD, but authored long-across-Z and then yawed
    // 90° into place — so its own half-extents are the wrong way round for
    // the walker's approach, and only un-rotating the query point
    // (`pointInOrientedBox`) finds him inside it. An axis-aligned
    // approximation of this box would be 1 wide and 3 deep: the walker,
    // coming straight up the middle, would sail through the gap either side.
    const rotated = orientBox(
      { center: { x: 0, y: 1, z: 0 }, halfExtents: { x: 1, y: 2, z: 3 } },
      { x: 0, y: 0, z: -4 },
      yawQuat(Math.PI / 2),
    );
    expect(rotated.center).toEqual(ZONE_AHEAD.center);
    const sim = raceSim(rotated);

    expect(walkUntilQualified(sim)).toBeGreaterThan(0);

    sim.dispose();
  });

  it("qualifies each Character independently, at its own Tick", () => {
    const sim = new RapierSimulation({
      statics: [GROUND],
      finishZones: [{ trigger: ZONE_AHEAD }],
      withDefaultCharacter: false,
    });
    sim.addCharacter("early", { x: 0, y: RESTING_SPAWN.y, z: -2.5 });
    sim.addCharacter("late", { x: 2, y: RESTING_SPAWN.y, z: 2 });

    for (let i = 0; i < 120; i += 1) sim.tick({ early: NORTH, late: NORTH });

    const { early, late } = sim.snapshot().characters;
    expect(early!.finishTick).not.toBeNull();
    expect(late!.finishTick).not.toBeNull();
    expect(early!.finishTick!).toBeLessThan(late!.finishTick!);

    sim.dispose();
  });

  it("takes the server's answer on reconciliation — a mispredicted Qualification is not latched forever", () => {
    // A client that wrongly predicted itself into the zone would otherwise
    // lock its own input for the rest of the Round while the server kept
    // running: the authoritative snapshot has to be able to clear it, the
    // same way only the server can end a knockdown (ADR 0015).
    const sim = new RapierSimulation({ statics: [GROUND], spawn: RESTING_SPAWN, finishZones: [{ trigger: ZONE_AHEAD }], authoritative: false });
    walkUntilQualified(sim);
    expect(me(sim).finishTick).not.toBeNull();

    const server = me(sim);
    sim.reconcileCharacter(DEFAULT_CHARACTER_ID, {
      ...server,
      position: { x: 0, y: RESTING_SPAWN.y, z: 5 }, // nowhere near the zone
      finishTick: null,
    });

    expect(me(sim).finishTick).toBeNull();

    sim.dispose();
  });
});

describe("RapierSimulation — input lock is one rule at one layer (M5 ticket 01, ADR 0044)", () => {
  const raceSim = () => new RapierSimulation({ statics: [GROUND], spawn: RESTING_SPAWN });
  const me = (sim: RapierSimulation) => sim.snapshot().characters[DEFAULT_CHARACTER_ID]!;

  it("defaults to unlocked — every existing caller that never passes phase keeps working", () => {
    const sim = raceSim();

    tick(sim, 1, NORTH);

    expect(me(sim).position.z).toBeLessThan(RESTING_SPAWN.z);

    sim.dispose();
  });

  it("locks every Character's input outside RUNNING, in the shared step itself", () => {
    const sim = raceSim();
    const before = me(sim).position;

    for (let n = 0; n < Math.round(1 * TICK_RATE_HZ); n += 1) sim.tick({ [DEFAULT_CHARACTER_ID]: NORTH }, "COUNTDOWN");

    const after = me(sim).position;
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeLessThan(0.05);

    sim.dispose();
  });

  it("releases on the exact tick the phase becomes RUNNING — no half-tick of leftover lock", () => {
    const sim = raceSim();

    sim.tick({ [DEFAULT_CHARACTER_ID]: NORTH }, "COUNTDOWN");
    const stillLocked = me(sim).position;
    sim.tick({ [DEFAULT_CHARACTER_ID]: NORTH }, "RUNNING");
    const firstRunningTick = me(sim).position;

    expect(firstRunningTick.z).toBeLessThan(stillLocked.z);

    sim.dispose();
  });

  it("locks again once the Round has ended (ROUND_END / RESULTS), same as before it started", () => {
    const sim = raceSim();
    tick(sim, 1, NORTH); // RUNNING, moving
    const atEnd = me(sim).position;

    for (let n = 0; n < Math.round(1 * TICK_RATE_HZ); n += 1) sim.tick({ [DEFAULT_CHARACTER_ID]: NORTH }, "ROUND_END");

    const after = me(sim).position;
    expect(Math.hypot(after.x - atEnd.x, after.z - atEnd.z)).toBeLessThan(0.05);

    sim.dispose();
  });

  it("still locks a Qualified Character even while the Match phase itself is unlocked (RUNNING)", () => {
    const zone = { center: { x: 0, y: 1, z: -4 }, halfExtents: { x: 3, y: 2, z: 1 } };
    const sim = new RapierSimulation({ statics: [GROUND], spawn: RESTING_SPAWN, finishZones: [{ trigger: zone }] });
    for (let i = 0; i < 200 && me(sim).finishTick === null; i += 1) sim.tick({ [DEFAULT_CHARACTER_ID]: NORTH }, "RUNNING");
    expect(me(sim).finishTick).not.toBeNull();
    const atFinish = me(sim).position;

    for (let n = 0; n < Math.round(1 * TICK_RATE_HZ); n += 1) sim.tick({ [DEFAULT_CHARACTER_ID]: NORTH }, "RUNNING");

    const after = me(sim).position;
    expect(Math.hypot(after.x - atFinish.x, after.z - atFinish.z)).toBeLessThan(0.05);

    sim.dispose();
  });

  it("replayLocalCharacter applies the same lock to every replayed tick", () => {
    const sim = raceSim();
    const before = me(sim).position;

    sim.replayLocalCharacter(DEFAULT_CHARACTER_ID, [NORTH, NORTH, NORTH], "COUNTDOWN");

    const after = me(sim).position;
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeLessThan(0.05);

    sim.dispose();
  });
});

describe("RapierSimulation — RoundRules (M5 ticket 02, ADR 0041/0043)", () => {
  const me = (sim: RapierSimulation) => sim.snapshot().characters[DEFAULT_CHARACTER_ID]!;

  it("accepts a Round's own RoundRules at construction — a Race resolves to today's behaviour exactly", () => {
    // `timeLimitMs` is never read by the step at all (a Match-authority
    // concern, `matchLoop.ts`), and `fallBehavior: "respawn"` here on both
    // is exactly today's Race — so movement must be identical regardless of
    // the RoundRules opinion, right down to a different Time Limit.
    const plain = new RapierSimulation({ statics: [GROUND], spawn: RESTING_SPAWN });
    const withRules = new RapierSimulation({
      statics: [GROUND],
      spawn: RESTING_SPAWN,
      roundRules: { timeLimitMs: 5_000, fallBehavior: "respawn", survivorTarget: 1 },
    });

    tick(plain, 1, NORTH);
    tick(withRules, 1, NORTH);

    expect(me(withRules).position).toEqual(me(plain).position);
    plain.dispose();
    withRules.dispose();
  });

  it("syncRoundRules adopts a new record without disturbing anything already simulated", () => {
    const sim = new RapierSimulation({ statics: [GROUND], spawn: RESTING_SPAWN });
    const before = me(sim).position;

    sim.syncRoundRules({ timeLimitMs: 30_000, fallBehavior: "respawn", survivorTarget: 1 });

    expect(me(sim).position).toEqual(before);
    tick(sim, 1, NORTH); // still simulates normally afterward
    expect(me(sim).position.z).toBeLessThan(before.z);

    sim.dispose();
  });
});

describe("dispose (M4 ticket 01)", () => {
  it("frees the Rapier world so a client can start, stop and start again without leaking it", () => {
    const sim = new RapierSimulation();
    sim.tick({ [DEFAULT_CHARACTER_ID]: IDLE_INPUTS });

    sim.dispose();

    // A freed world is WASM memory that is gone — the guard is what turns a
    // use-after-free into a clear error instead of a crash inside Rapier.
    expect(() => sim.tick({ [DEFAULT_CHARACTER_ID]: IDLE_INPUTS })).toThrow(/disposed/);
  });

  it("is idempotent — a teardown that runs twice must not double-free", () => {
    const sim = new RapierSimulation();

    sim.dispose();

    expect(() => sim.dispose()).not.toThrow();
  });

  it("leaves a fresh simulation completely unaffected", () => {
    const first = new RapierSimulation();
    first.dispose();

    const second = new RapierSimulation();
    second.tick({ [DEFAULT_CHARACTER_ID]: IDLE_INPUTS });

    expect(second.snapshot().characters[DEFAULT_CHARACTER_ID]).toBeDefined();
    second.dispose();
  });
});
