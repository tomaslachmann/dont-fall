import { beforeAll, describe, expect, it } from "vitest";
import type { Box } from "../math/box.js";
import { wrapAngle } from "../math/angle.js";
import { lengthVec3, normalizeVec3, subVec3, vec3, type Vec3 } from "../math/vec3.js";
import type { CharacterSnapshot } from "../state/SimState.js";
import { CAPSULE_BOTTOM_OFFSET, FACING_TURN_SPEED_MAX, WALK_SPEED } from "../tuning/character.js";
import { TICK_DT, TICK_MS } from "../tuning/clock.js";
import {
  GRAB_CARRY_DISTANCE,
  GRAB_CARRY_LIFT,
  GRAB_CARRY_SPEED_MULTIPLIER,
  GRAB_CARRY_TICKS,
  GRAB_COOLDOWN_TICKS,
  GRAB_IMMUNITY_TICKS,
  GRAB_RANGE,
  GRAB_STRUGGLE_WINDOW_TICKS,
  GRAB_TURN_SPEED_MULTIPLIER,
  SPIN_OVERSPIN_TICKS,
  SPIN_WINDUP_TICKS,
} from "../tuning/fight.js";
import { RAGDOLL_MIN_TICKS } from "../tuning/knockdown.js";
import { hurlDirection } from "./GrabHolds.js";
import { DEFAULT_CHARACTER_ID, RapierSimulation, initPhysics } from "./RapierSimulation.js";
import { IDLE_INPUTS, type SimInputs } from "./SimInputs.js";
import { forwardOf, spinAngleAt, spinTangentOf } from "./spin.js";

beforeAll(async () => {
  await initPhysics();
});

const GROUND: Box = { center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 40, y: 0.5, z: 40 } };
const GRABBER = DEFAULT_CHARACTER_ID;
const HELD = "held";
const onGround = (x: number, z: number): Vec3 => ({ x, y: CAPSULE_BOTTOM_OFFSET + 0.1, z });
const input = (partial: Partial<SimInputs> = {}): SimInputs => ({ ...IDLE_INPUTS, ...partial });
const NORTH = vec3(0, 0, -1);
const EAST = vec3(1, 0, 0);
const WEST = vec3(-1, 0, 0);
const reach = input({ grabHeld: true });
const spin = input({ hitHeld: true });

/** Grabber at the origin facing north, `HELD` at `heldZ` straight ahead of it; both settled. */
const pair = (heldZ = -1, statics: Box[] = [GROUND]): RapierSimulation => {
  const sim = new RapierSimulation({ spawn: onGround(0, 0), statics });
  sim.addCharacter(HELD, onGround(0, heldZ));
  for (let n = 0; n < 10; n += 1) sim.tick({});
  return sim;
};

/** A pair whose hold has started: `HELD` is carried in front of the grabber. */
const caught = (heldZ = -1, statics: Box[] = [GROUND]): RapierSimulation => {
  const sim = pair(heldZ, statics);
  sim.tick({ [GRABBER]: reach });
  sim.tick({}); // the press falls, so a later one is a fresh one
  return sim;
};

const of = (sim: RapierSimulation, id: string): CharacterSnapshot => sim.snapshot().characters[id]!;

/** A client's own prediction world (ADR 0012): only its own Character, never authoritative — settled, so its queries see the ground. */
const clientWorld = (at: Vec3): RapierSimulation => {
  const sim = new RapierSimulation({ spawn: at, statics: [GROUND], authoritative: false });
  for (let n = 0; n < 10; n += 1) sim.tick({});
  return sim;
};
const flat = (v: Vec3): Vec3 => vec3(v.x, 0, v.z);

/** Held A, D, A, D… for `count` ticks — a wiggle on every tick. */
const wiggle = (sim: RapierSimulation, count: number, extra: Record<string, SimInputs> = {}): void => {
  for (let n = 0; n < count; n += 1) sim.tick({ [HELD]: input({ moveDirection: n % 2 === 0 ? WEST : EAST }), ...extra });
};

describe("GrabHolds — carried, not towed (ADR 0104, ticket 01)", () => {
  it("lifts whoever it catches into Held, at arm's length straight ahead of the grabber, feet off the ground", () => {
    const sim = pair();
    sim.tick({ [GRABBER]: reach });

    const held = of(sim, HELD);
    const grabber = of(sim, GRABBER);
    expect(held.motionState).toBe("Held");
    expect(held.heldByGrabberId).toBe(GRABBER);
    expect(held.heldPhase).toBe("struggle");
    expect(grabber.grabbingId).toBe(HELD);
    const offset = subVec3(held.position, grabber.position);
    expect(lengthVec3(flat(offset))).toBeCloseTo(GRAB_CARRY_DISTANCE, 1);
    expect(normalizeVec3(flat(offset)).z).toBeCloseTo(-1, 2); // straight ahead: north
    expect(offset.y).toBeCloseTo(GRAB_CARRY_LIFT, 2);
    expect(held.grounded).toBe(false);
  });

  it("carries the body wherever the grabber goes, and the held Player's own input moves nothing", () => {
    const sim = caught();
    for (let n = 0; n < 20; n += 1) {
      sim.tick({ [GRABBER]: input({ moveDirection: EAST, facing: 0 }), [HELD]: input({ moveDirection: NORTH, jumpHeld: n % 2 === 0 }) });
    }
    const offset = subVec3(of(sim, HELD).position, of(sim, GRABBER).position);
    expect(of(sim, GRABBER).position.x).toBeGreaterThan(1); // it walked east, carrying
    expect(lengthVec3(flat(offset))).toBeCloseTo(GRAB_CARRY_DISTANCE, 1);
    expect(offset.y).toBeCloseTo(GRAB_CARRY_LIFT, 2);
    expect(of(sim, HELD).motionState).toBe("Held");
  });

  it("pulls the carried body in against a wall rather than putting it inside one — a spring arm", () => {
    // A wall whose near face is 0.9 ahead of the grabber's centre.
    const wall: Box = { center: { x: 0, y: 2, z: -1.4 }, halfExtents: { x: 5, y: 2, z: 0.5 } };
    const sim = caught(-0.6, [GROUND, wall]);
    const offset = flat(subVec3(of(sim, HELD).position, of(sim, GRABBER).position));
    expect(lengthVec3(offset)).toBeLessThan(GRAB_CARRY_DISTANCE - 0.3);
    // The body's own front stops short of the wall's face.
    expect(of(sim, HELD).position.z - 0.35).toBeGreaterThan(-0.9 - 0.05);
  });

  it("slows the grabber to GRAB_CARRY_SPEED_MULTIPLIER of its pace", () => {
    const sim = caught();
    const before = of(sim, GRABBER).position.x;
    for (let n = 0; n < 30; n += 1) sim.tick({ [GRABBER]: input({ moveDirection: EAST }) });
    const walked = of(sim, GRABBER).position.x - before;
    expect(walked).toBeCloseTo(WALK_SPEED * GRAB_CARRY_SPEED_MULTIPLIER * 30 * TICK_DT, 0);
  });

  it("turns the grabber no faster than GRAB_TURN_SPEED_MULTIPLIER of the body's own top speed, however far its input jumps", () => {
    const sim = caught();
    const step = FACING_TURN_SPEED_MAX * GRAB_TURN_SPEED_MULTIPLIER * TICK_DT;
    let facing = of(sim, GRABBER).facing;
    for (let n = 0; n < 5; n += 1) {
      sim.tick({ [GRABBER]: input({ facing: Math.PI }) }); // turn right round, at once
      const next = of(sim, GRABBER).facing;
      expect(Math.abs(wrapAngle(next - facing))).toBeCloseTo(step, 5);
      facing = next;
    }
    // …and the body goes round with it: always straight ahead of the grabber.
    const offset = normalizeVec3(flat(subVec3(of(sim, HELD).position, of(sim, GRABBER).position)));
    const ahead = forwardOf(facing);
    expect(offset.x).toBeCloseTo(ahead.x, 1);
    expect(offset.z).toBeCloseTo(ahead.z, 1);
    // The held Character faces its grabber.
    expect(Math.cos(of(sim, HELD).facing - (facing + Math.PI))).toBeCloseTo(1, 5);
  });

  it("gives the grabber nothing to do with its hands but carry: no Jump, no Dash, no Hit", () => {
    const sim = caught();
    sim.tick({ [GRABBER]: input({ jumpHeld: true, dashHeld: true, moveDirection: EAST }) });
    expect(of(sim, GRABBER).velocity.y).toBeLessThanOrEqual(0);
    expect(of(sim, GRABBER).dashing).toBe(false);
    const swings = of(sim, GRABBER).hitEpoch;
    sim.tick({ [GRABBER]: spin });
    sim.tick({});
    expect(of(sim, GRABBER).hitEpoch).toBe(swings); // Hit's button Spun instead
  });

  it("sets a Struggling Character down on its feet, Staggering, when the grabber lets go — and starts the grabber's cooldown", () => {
    const sim = caught();
    sim.tick({ [GRABBER]: reach }); // a second press lets go
    expect(of(sim, HELD).heldByGrabberId).toBeNull();
    expect(of(sim, GRABBER).grabbingId).toBeNull();
    expect(of(sim, GRABBER).grabCooldownMs).toBeGreaterThan(0);
    sim.tick({});
    expect(of(sim, HELD).motionState).toBe("Stagger");
  });

  it("takes no Impact while Held — a swing at the pair lands on the grabber, and nothing waits to fire on release", () => {
    const sim = caught();
    sim.addCharacter("striker", onGround(0, -1.6)); // just past the held body, facing south at the pair
    for (let n = 0; n < 5; n += 1) sim.tick({});
    sim.applyImpact(HELD, vec3(0, 3, 20), "Hit");
    for (let n = 0; n < 6; n += 1) sim.tick({ striker: input({ facing: Math.PI, hitHeld: n < 5 }) });
    expect(of(sim, HELD).hitReactEpoch).toBe(0);
    expect(of(sim, GRABBER).hitReactEpoch).toBe(1);
    sim.tick({ [GRABBER]: reach }); // let go: it lands on its feet, not thrown by the queued Hit
    for (let n = 0; n < 3; n += 1) sim.tick({});
    expect(of(sim, HELD).motionState).not.toBe("Ragdoll");
  });

  it("lets go of whoever it holds the moment the grabber itself goes down", () => {
    const sim = caught();
    sim.applyImpact(GRABBER, vec3(0, 3, 20), "Hit");
    sim.tick({});
    sim.tick({});
    expect(of(sim, GRABBER).motionState).toBe("Ragdoll");
    expect(of(sim, HELD).heldByGrabberId).toBeNull();
    expect(of(sim, HELD).motionState).not.toBe("Held");
  });

  it("moves the whole hold from the server into the grabber's own prediction, once it is told (syncOwnHold)", () => {
    // The server has both; the grabber's client has only itself. Told it is
    // holding, it walks at the carry pace the server does — without, it would
    // run at full speed and be corrected every snapshot.
    const server = caught();
    const client = clientWorld(onGround(0, 0));
    client.reconcileCharacter(GRABBER, of(server, GRABBER));
    client.syncOwnHold(GRABBER, of(server, GRABBER));
    for (let n = 0; n < 20; n += 1) {
      const move = input({ moveDirection: EAST, facing: 0.1 * n });
      server.tick({ [GRABBER]: move });
      client.tick({ [GRABBER]: move });
    }
    // Within contact noise — at full pace it would be 1.6 units ahead.
    expect(of(client, GRABBER).position.x).toBeCloseTo(of(server, GRABBER).position.x, 1);
    expect(of(client, GRABBER).facing).toBeCloseTo(of(server, GRABBER).facing, 5);
  });

  // Carried over from M6 ticket 04 — behaviour this rework keeps.
  it("bumps grabEpoch on every attempt, caught or not — once per press, never while already holding (ADR 0071)", () => {
    const sim = pair(-20);
    sim.tick({ [GRABBER]: reach });
    expect(of(sim, GRABBER).grabbingId).toBeNull();
    expect(of(sim, GRABBER).grabEpoch).toBe(1);
    const hold = caught();
    expect(of(hold, GRABBER).grabEpoch).toBe(1);
    hold.tick({ [GRABBER]: reach }); // lets go rather than reaching again
    expect(of(hold, GRABBER).grabEpoch).toBe(1);
  });

  it("misses a Character outside GRAB_RANGE, even straight ahead", () => {
    const sim = pair(-(GRAB_RANGE + 1));
    sim.tick({ [GRABBER]: reach });
    expect(of(sim, GRABBER).grabbingId).toBeNull();
  });

  it("cannot latch on mid-Dash (M6.1), and cancels the caught Character's own Dash", () => {
    const dashing = pair(-40);
    dashing.tick({ [GRABBER]: input({ moveDirection: NORTH, dashHeld: true, grabHeld: true }) });
    expect(of(dashing, GRABBER).grabbingId).toBeNull();

    const sim = pair();
    sim.tick({ [HELD]: input({ moveDirection: vec3(0, 0, -1), dashHeld: true }) });
    expect(of(sim, HELD).dashing).toBe(true);
    sim.tick({ [GRABBER]: reach });
    expect(of(sim, HELD).dashing).toBe(false);
  });

  it("cannot grab a Character already in another hold", () => {
    const sim = new RapierSimulation({ spawn: onGround(0, 0), statics: [GROUND] });
    sim.addCharacter(HELD, onGround(0, -1));
    sim.addCharacter("third", onGround(0, -2.4));
    for (let n = 0; n < 10; n += 1) sim.tick({});
    sim.tick({ [GRABBER]: reach });
    sim.tick({ third: input({ facing: Math.PI, grabHeld: true }) });
    expect(of(sim, "third").grabbingId).toBeNull();
    expect(of(sim, HELD).heldByGrabberId).toBe(GRABBER);
  });

  it("can grab again once a hold has ended and the cooldown is up (2026-09 audit)", () => {
    const sim = caught();
    sim.tick({ [GRABBER]: reach }); // let go
    for (let n = 0; n < GRAB_COOLDOWN_TICKS + 2; n += 1) sim.tick({});
    sim.addCharacter("other", onGround(0, -1));
    sim.tick({});
    sim.tick({ [GRABBER]: reach });
    expect(of(sim, GRABBER).grabbingId).not.toBeNull();
  });

  it("never targets an eliminated Character (ADR 0042)", () => {
    const sim = pair();
    sim.eliminateCharacter(HELD);
    sim.tick({ [GRABBER]: reach });
    expect(of(sim, GRABBER).grabbingId).toBeNull();
  });

  it("starts the grabber's cooldown when the held Character disconnects mid-hold (code review)", () => {
    const sim = caught();
    expect(of(sim, GRABBER).grabCooldownMs).toBe(0);
    sim.removeCharacter(HELD);
    expect(of(sim, GRABBER).grabCooldownMs).toBeGreaterThan(0);
  });
});

describe("GrabHolds — the Struggle (ADR 0104, ticket 02)", () => {
  it("fills the escape meter on every reversal of the move input, and not on one key held down", () => {
    const sim = caught();
    wiggle(sim, 4);
    const wiggled = of(sim, HELD).escapeProgress;
    expect(wiggled).toBeGreaterThan(0.2);

    const held = caught();
    for (let n = 0; n < 20; n += 1) held.tick({ [HELD]: input({ moveDirection: WEST }) });
    expect(of(held, HELD).escapeProgress).toBe(0);
  });

  it("drains while the Player stops wiggling", () => {
    const sim = caught();
    wiggle(sim, 6);
    const full = of(sim, HELD).escapeProgress;
    for (let n = 0; n < 15; n += 1) sim.tick({});
    expect(of(sim, HELD).escapeProgress).toBeLessThan(full - 0.05);
  });

  it("frees a Character that fills its meter in time on its feet, shoved clear of the grabber, which goes on cooldown", () => {
    const sim = caught();
    let ticks = 0;
    while (of(sim, HELD).motionState === "Held" && ticks < GRAB_STRUGGLE_WINDOW_TICKS) {
      wiggle(sim, 1 + (ticks % 2)); // alternate, even across the loop
      ticks += 1;
    }
    expect(ticks).toBeLessThan(GRAB_STRUGGLE_WINDOW_TICKS);
    expect(of(sim, HELD).motionState).toBe("Controlled");
    expect(of(sim, HELD).heldByGrabberId).toBeNull();
    expect(of(sim, HELD).escapeProgress).toBe(0); // emptied for the next one
    expect(of(sim, GRABBER).grabCooldownMs).toBeGreaterThan(0);
    const apart = lengthVec3(flat(subVec3(of(sim, HELD).position, of(sim, GRABBER).position)));
    for (let n = 0; n < 5; n += 1) sim.tick({});
    expect(lengthVec3(flat(subVec3(of(sim, HELD).position, of(sim, GRABBER).position)))).toBeGreaterThan(apart);
  });

  it("goes Limp when the window runs out, and the grabber's own window starts", () => {
    const sim = pair();
    sim.tick({ [GRABBER]: reach }); // the window's first tick
    expect(of(sim, HELD).holdEndsTick).toBe(sim.snapshot().tick + GRAB_STRUGGLE_WINDOW_TICKS - 1);
    for (let n = 0; n < GRAB_STRUGGLE_WINDOW_TICKS - 2; n += 1) sim.tick({});
    expect(of(sim, HELD).heldPhase).toBe("struggle");
    sim.tick({});
    expect(of(sim, HELD).motionState).toBe("Held");
    expect(of(sim, HELD).heldPhase).toBe("limp");
    expect(of(sim, HELD).holdEndsTick).toBe(sim.snapshot().tick + GRAB_CARRY_TICKS);
    // A Limp Character's wiggles count for nothing.
    wiggle(sim, 6);
    expect(of(sim, HELD).escapeProgress).toBe(0);
  });

  it("does not count wiggles sent while the Match is locked — the input the step actually used (code review)", () => {
    const sim = caught();
    for (let n = 0; n < 10; n += 1) sim.tick({ [HELD]: input({ moveDirection: n % 2 === 0 ? WEST : EAST }) }, "LOBBY");
    expect(of(sim, HELD).escapeProgress).toBe(0);
  });

  it("predicts the meter on the held Player's own client exactly, across a reconcile and replay", () => {
    // The server holds the held Character; its own client has only itself,
    // Held and told so. Reconciled to a snapshot four ticks old, the replay
    // of the four inputs since lands on the server's meter to the last digit.
    const server = caught();
    const client = clientWorld(onGround(0, -1));
    const HELD_CLIENT = DEFAULT_CHARACTER_ID;
    const inputs: SimInputs[] = [];
    let acked: CharacterSnapshot | undefined;
    for (let n = 0; n < 9; n += 1) {
      const move = input({ moveDirection: n % 3 === 0 ? WEST : EAST });
      server.tick({ [HELD]: move });
      if (n === 4) acked = of(server, HELD);
      if (n > 4) inputs.push(move);
    }
    client.reconcileCharacter(HELD_CLIENT, acked!);
    client.syncOwnHold(HELD_CLIENT, acked!);
    client.replayLocalCharacter(HELD_CLIENT, inputs);
    expect(of(client, HELD_CLIENT).motionState).toBe("Held");
    expect(of(client, HELD_CLIENT).escapeProgress).toBe(of(server, HELD).escapeProgress);
  });
});

describe("GrabHolds — Limp, release and Grab immunity (ADR 0104, ticket 03)", () => {
  /** A pair whose hold went Limp on the tick just run. */
  const limp = (): RapierSimulation => {
    const sim = caught();
    while (of(sim, HELD).heldPhase === "struggle") sim.tick({});
    return sim;
  };

  it("carries a Limp body for the whole of GRAB_CARRY_TICKS with no get-up, then lets it go into a fresh knockdown", () => {
    const sim = limp();
    const ends = of(sim, HELD).holdEndsTick;
    for (let n = 0; n < GRAB_CARRY_TICKS - 1; n += 1) {
      sim.tick({});
      expect(of(sim, HELD).motionState).toBe("Held");
    }
    expect(sim.snapshot().tick + 1).toBe(ends);
    const epoch = of(sim, HELD).ragdollEpoch;
    sim.tick({});
    const released = of(sim, HELD);
    expect(released.motionState).toBe("Ragdoll");
    expect(released.ragdollCause).toBe("Grab");
    expect(released.ragdollEpoch).toBe(epoch + 1);
    expect(released.phaseStartTick).toBe(sim.snapshot().tick); // a fresh clock, starting now
    for (let n = 0; n < RAGDOLL_MIN_TICKS - 1; n += 1) sim.tick({});
    expect(of(sim, HELD).motionState).toBe("Ragdoll"); // a whole knockdown, not the tail of one
  });

  it("knocks a Limp body down when the grabber lets go of it", () => {
    const sim = limp();
    sim.tick({ [GRABBER]: reach });
    expect(of(sim, HELD).motionState).toBe("Ragdoll");
    expect(of(sim, HELD).ragdollCause).toBe("Grab");
  });

  it("picks a Character that is already down straight up Limp — and nothing gets up in the grabber's hands", () => {
    const sim = pair();
    sim.applyImpact(HELD, vec3(0, 2, -12), "Hit");
    sim.tick({});
    expect(of(sim, HELD).motionState).toBe("Ragdoll");
    // Walk up to the body and pick it up.
    const at = of(sim, HELD).position;
    const toBody = Math.atan2(at.x, -at.z);
    for (let n = 0; n < 40 && of(sim, GRABBER).grabbingId === null; n += 1) {
      const gap = subVec3(of(sim, HELD).position, of(sim, GRABBER).position);
      sim.tick({ [GRABBER]: input({ facing: toBody, moveDirection: lengthVec3(flat(gap)) > 1.2 ? normalizeVec3(flat(gap)) : vec3(), grabHeld: n % 2 === 0 }) });
    }
    expect(of(sim, HELD).motionState).toBe("Held");
    expect(of(sim, HELD).heldPhase).toBe("limp");
    expect(of(sim, HELD).bones).toHaveLength(0); // the ragdoll is put away
    for (let n = 0; n < GRAB_CARRY_TICKS - 2; n += 1) sim.tick({});
    expect(of(sim, HELD).motionState).toBe("Held");
  });

  it("will not let anyone grab a Character straight back after a hold — only once it has stood for GRAB_IMMUNITY_TICKS", () => {
    const sim = caught();
    sim.tick({ [GRABBER]: reach }); // let go — it lands Staggering
    for (let n = 0; n < GRAB_COOLDOWN_TICKS + 2; n += 1) sim.tick({});
    // Off cooldown, facing it, in range: still immune while it wobbles and for a while after.
    const tryGrab = (): void => {
      sim.tick({ [GRABBER]: reach });
      sim.tick({});
    };
    tryGrab();
    expect(of(sim, GRABBER).grabbingId).toBeNull();
    for (let n = 0; n < GRAB_IMMUNITY_TICKS + 30; n += 1) sim.tick({});
    const gap = flat(subVec3(of(sim, HELD).position, of(sim, GRABBER).position));
    sim.tick({ [GRABBER]: input({ facing: Math.atan2(gap.x, -gap.z) }) });
    tryGrab();
    expect(of(sim, GRABBER).grabbingId).toBe(HELD);
  });
});

describe("GrabHolds — Spin and Hurl (ADR 0104, ticket 04)", () => {
  it("roots the grabber and turns it by exactly spinAngleAt, winding up", () => {
    const sim = caught();
    const start = of(sim, GRABBER).facing;
    const at = of(sim, GRABBER).position;
    for (let n = 1; n <= 20; n += 1) {
      sim.tick({ [GRABBER]: input({ hitHeld: true, moveDirection: EAST }) });
      expect(wrapAngle(of(sim, GRABBER).facing - start - spinAngleAt(n))).toBeCloseTo(0, 6);
      expect(of(sim, GRABBER).spinMs).toBe(n * TICK_MS);
    }
    expect(lengthVec3(flat(subVec3(of(sim, GRABBER).position, at)))).toBeLessThan(0.05);
  });

  it("Hurls along the circle's tangent where it was let go, as a knockdown", () => {
    const sim = caught();
    for (let n = 0; n < 12; n += 1) sim.tick({ [GRABBER]: spin });
    const facing = of(sim, GRABBER).facing;
    sim.tick({});
    const thrown = of(sim, HELD);
    expect(thrown.motionState).toBe("Ragdoll");
    expect(thrown.ragdollCause).toBe("Hurl");
    const leaving = normalizeVec3(flat(thrown.velocity));
    const tangent = spinTangentOf(facing);
    expect(leaving.x * tangent.x + leaving.z * tangent.z).toBeGreaterThan(0.95);
  });

  it("pulls the Hurl onto the direction the grabber steers, within HURL_AIM_SNAP_DEG of the tangent — and not beyond it", () => {
    const tangent = vec3(1, 0, 0);
    const near = normalizeVec3(vec3(1, 0, 0.6)); // ~31° off
    const far = normalizeVec3(vec3(1, 0, 1.5)); // ~56° off
    const snapped = hurlDirection(tangent, near);
    expect(snapped.x).toBeCloseTo(near.x, 9);
    expect(snapped.z).toBeCloseTo(near.z, 9);
    expect(hurlDirection(tangent, far)).toEqual(tangent);
    expect(hurlDirection(tangent, vec3())).toEqual(tangent);
  });

  /** How far (horizontally) a body Hurled after `spinTicks` of Spin ends up from where it was let go. */
  const hurlDistance = (spinTicks: number): number => {
    const sim = caught(-1, [{ center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 80, y: 0.5, z: 80 } }]);
    for (let n = 0; n < spinTicks; n += 1) sim.tick({ [GRABBER]: spin });
    const from = of(sim, HELD).position;
    sim.tick({});
    for (let n = 0; n < 120; n += 1) sim.tick({});
    return lengthVec3(flat(subVec3(of(sim, HELD).position, from)));
  };

  it("carries a Hurl further the longer the Spin wound up — measured (see HURL_MIN_SPEED)", () => {
    const flick = hurlDistance(1);
    const half = hurlDistance(Math.round(SPIN_WINDUP_TICKS / 2));
    const full = hurlDistance(SPIN_WINDUP_TICKS);
    // A full Spin carries about twice a fully charged Hit (3.6, ADR 0093).
    expect(flick).toBeGreaterThan(2);
    expect(half).toBeGreaterThan(flick);
    expect(full).toBeGreaterThan(half);
    expect(full).toBeGreaterThan(6);
  });

  it("makes a grabber that Spins past SPIN_OVERSPIN_TICKS at full speed dizzy: down it goes, and its Character flies off", () => {
    const sim = caught();
    for (let n = 0; n <= SPIN_WINDUP_TICKS + SPIN_OVERSPIN_TICKS; n += 1) sim.tick({ [GRABBER]: spin });
    expect(of(sim, HELD).motionState).toBe("Ragdoll");
    expect(of(sim, HELD).ragdollCause).toBe("Hurl");
    sim.tick({ [GRABBER]: spin });
    expect(of(sim, GRABBER).motionState).toBe("Ragdoll");
    expect(of(sim, GRABBER).ragdollCause).toBe("Dizzy");
  });

  it("flings a Character that wins its Struggle mid-Spin on along the circle, on its feet", () => {
    const sim = caught();
    for (let n = 0; n < SPIN_WINDUP_TICKS; n += 1) sim.tick({ [GRABBER]: spin, [HELD]: input({ moveDirection: n % 2 === 0 ? WEST : EAST }) });
    // Not free yet: finish the wiggling while the Spin keeps going.
    let n = 0;
    while (of(sim, HELD).motionState === "Held" && n < 30) {
      const facing = of(sim, GRABBER).facing;
      sim.tick({ [GRABBER]: spin, [HELD]: input({ moveDirection: n % 2 === 0 ? WEST : EAST }) });
      n += 1;
      if (of(sim, HELD).motionState !== "Held") {
        expect(of(sim, HELD).motionState).toBe("Controlled");
        sim.tick({});
        const leaving = normalizeVec3(flat(of(sim, HELD).velocity));
        const tangent = spinTangentOf(facing);
        expect(leaving.x * tangent.x + leaving.z * tangent.z).toBeGreaterThan(0.3);
      }
    }
    expect(of(sim, HELD).motionState).not.toBe("Held");
  });

  it("predicts the Spin on the grabber's own client exactly, across a reconcile and replay", () => {
    const server = caught();
    const client = clientWorld(onGround(0, 0));
    const inputs: SimInputs[] = [];
    let acked: CharacterSnapshot | undefined;
    for (let n = 0; n < 16; n += 1) {
      server.tick({ [GRABBER]: spin });
      if (n === 10) acked = of(server, GRABBER);
      if (n > 10) inputs.push(spin);
    }
    client.reconcileCharacter(GRABBER, acked!);
    client.syncOwnHold(GRABBER, of(server, GRABBER));
    client.replayLocalCharacter(GRABBER, inputs);
    expect(of(client, GRABBER).spinMs).toBe(of(server, GRABBER).spinMs);
    expect(of(client, GRABBER).facing).toBeCloseTo(of(server, GRABBER).facing, 9);
  });
});

describe("GrabHolds — a swung or hurled body is a weapon (ADR 0104, ticket 05)", () => {
  /** Spin `ticks`, then put a bystander just ahead of where the body is going, and Spin on. */
  const bystanderInTheWay = (ticks: number): RapierSimulation => {
    const sim = caught();
    for (let n = 0; n < ticks; n += 1) sim.tick({ [GRABBER]: spin });
    const g = of(sim, GRABBER);
    const ahead = forwardOf(g.facing + 0.6);
    sim.addCharacter("bystander", onGround(g.position.x + ahead.x * GRAB_CARRY_DISTANCE, g.position.z + ahead.z * GRAB_CARRY_DISTANCE));
    for (let n = 0; n < 12; n += 1) sim.tick({ [GRABBER]: spin });
    return sim;
  };

  it("staggers whoever a slow Spin passes through, and knocks down whoever a full one does", () => {
    const slow = bystanderInTheWay(14); // the body passes at ~5.8 u/s: over IMPACT_STAGGER_MIN, under IMPACT_RAGDOLL_MIN
    expect(of(slow, "bystander").motionState).toBe("Stagger");
    const full = bystanderInTheWay(SPIN_WINDUP_TICKS);
    full.tick({});
    expect(of(full, "bystander").motionState).toBe("Ragdoll");
    expect(of(full, "bystander").ragdollCause).toBe("Hurl");
  });

  it("knocks down whoever a hurled body lands on — never the grabber that threw it", () => {
    const sim = caught(-1, [{ center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 80, y: 0.5, z: 80 } }]);
    for (let n = 0; n < SPIN_WINDUP_TICKS; n += 1) sim.tick({ [GRABBER]: spin });
    // Stand a bystander two units down the line the body is about to leave on.
    const tangent = spinTangentOf(of(sim, GRABBER).facing);
    const from = of(sim, HELD).position;
    sim.addCharacter("bystander", onGround(from.x + tangent.x * 2, from.z + tangent.z * 2));
    sim.tick({});
    for (let n = 0; n < 15; n += 1) sim.tick({});
    expect(of(sim, "bystander").motionState).toBe("Ragdoll");
    expect(of(sim, GRABBER).motionState).toBe("Controlled");
  });
});
