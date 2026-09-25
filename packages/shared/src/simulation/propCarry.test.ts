import { beforeAll, describe, expect, it } from "vitest";
import type { Box } from "../math/box.js";
import { lengthVec3, subVec3, vec3, type Vec3 } from "../math/vec3.js";
import { CAPSULE_BOTTOM_OFFSET, CAPSULE_HALF_HEIGHT, WALK_SPEED } from "../tuning/character.js";
import { TICK_DT } from "../tuning/clock.js";
import {
  HURLED_BODY_MIN_SPEED,
  PROP_CARRY_MASS_MAX,
  PROP_JUMP_MASS_MAX,
  PROP_LIFT_CONTACT_TICKS,
  PROP_LIFT_TICKS,
  PROP_TOSS_RELEASE_TICKS,
  PROP_TOSS_TAP_TICKS,
} from "../tuning/fight.js";
import type { PropConfig } from "./Prop.js";
import { CARRY_GRIP, propCarrySpeed, propGripOffset, propThrowScale, SPIN_GRIP, type Grip } from "./propCarry.js";
import { DEFAULT_CHARACTER_ID, RapierSimulation, initPhysics } from "./RapierSimulation.js";
import { IDLE_INPUTS, type SimInputs } from "./SimInputs.js";

beforeAll(async () => {
  await initPhysics();
});

const GROUND: Box = { center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 40, y: 0.5, z: 40 } };
const CARRIER = DEFAULT_CHARACTER_ID;
const OTHER = "other";
const onGround = (x: number, z: number): Vec3 => ({ x, y: CAPSULE_BOTTOM_OFFSET + 0.1, z });
const input = (partial: Partial<SimInputs> = {}): SimInputs => ({ ...IDLE_INPUTS, ...partial });
const EAST = vec3(1, 0, 0);
const reach = input({ grabHeld: true });

const ball = (mass: number, radius = 0.35, z = -1.2): PropConfig => ({
  shape: { kind: "ball", radius },
  center: { x: 0, y: radius, z },
  mass,
});

/** The carrier at the origin facing north, with `props` around it; settled. */
const world = (props: PropConfig[], opts: { authoritative?: boolean; other?: Vec3 } = {}): RapierSimulation => {
  const sim = new RapierSimulation({
    spawn: onGround(0, 0),
    statics: [GROUND],
    props,
    ...(opts.authoritative === undefined ? {} : { authoritative: opts.authoritative }),
  });
  if (opts.other) sim.addCharacter(OTHER, opts.other);
  for (let n = 0; n < 15; n += 1) sim.tick({});
  return sim;
};

/** Grab pressed at a Prop, and the whole Lift waited out (ADR 0128). */
const lift = (sim: RapierSimulation): void => {
  sim.tick({ [CARRIER]: reach });
  for (let n = 0; n < PROP_LIFT_TICKS; n += 1) sim.tick({});
};

/** `world`, and the ball picked up. */
const carrying = (mass: number, radius = 0.35): RapierSimulation => {
  const sim = world([ball(mass, radius)]);
  lift(sim);
  return sim;
};

const me = (sim: RapierSimulation) => sim.snapshot().characters[CARRIER]!;
const propAt = (sim: RapierSimulation, index = 0) => sim.snapshot().props[index]!;

describe("picking a Prop up (ADR 0125)", () => {
  it("lifts a Prop in reach into its hands — between them, where the hold's arms are", () => {
    const sim = carrying(2);

    expect(me(sim).carryingProp).toBe(0);
    expect(me(sim).grabbingId).toBeNull();
    expect(propAt(sim).carriedBy).toBe(CARRIER);
    const offset = subVec3(propAt(sim).position, me(sim).position);
    const at = propGripOffset(0.35, CARRY_GRIP);
    expect(Math.hypot(offset.x, offset.z)).toBeCloseTo(at.forward, 2);
    expect(offset.y).toBeCloseTo(at.up, 2);
    expect(offset.z).toBeLessThan(0); // straight ahead: north
    sim.dispose();
  });

  it("carries it wherever it goes, turning it with the carrier", () => {
    const sim = carrying(2);
    for (let n = 0; n < 20; n += 1) sim.tick({ [CARRIER]: input({ moveDirection: EAST, facing: Math.PI / 2 }) });

    const offset = subVec3(propAt(sim).position, me(sim).position);
    expect(me(sim).position.x).toBeGreaterThan(1);
    // Facing east now, and the Prop with it.
    expect(offset.x).toBeGreaterThan(0.5);
    sim.dispose();
  });

  it("cannot lift a Prop heavier than PROP_CARRY_MASS_MAX — that one is only shoved", () => {
    const sim = world([ball(PROP_CARRY_MASS_MAX + 1)]);
    sim.tick({ [CARRIER]: reach });

    expect(me(sim).carryingProp).toBeNull();
    expect(propAt(sim).carriedBy).toBeUndefined();
    sim.dispose();
  });

  it("catches a Character before a Prop in the same reach", () => {
    const sim = world([ball(2, 0.35, -1.4)], { other: onGround(0.3, -1) });
    sim.tick({ [CARRIER]: reach });

    expect(me(sim).grabbingId).toBe(OTHER);
    expect(me(sim).carryingProp).toBeNull();
    sim.dispose();
  });

  it("walks its own client's prediction at the carry pace once the snapshot says it carries, with nothing in its hands to collide with", () => {
    const server = carrying(PROP_CARRY_MASS_MAX);
    const client = world([ball(PROP_CARRY_MASS_MAX)], { authoritative: false });
    client.reconcileCharacter(CARRIER, me(server));
    client.syncOwnHold(CARRIER, me(server));
    client.syncPropsToSnapshot(server.snapshot().props);
    for (let n = 0; n < 10; n += 1) {
      server.tick({ [CARRIER]: input({ moveDirection: EAST }) });
      client.tick({ [CARRIER]: input({ moveDirection: EAST }) });
      client.syncPropsToSnapshot(server.snapshot().props);
    }

    // Velocity, not position: the character controller's own occasional
    // one-tick stall on flat ground predates this (GrabHolds' syncOwnHold test).
    expect(me(client).velocity.x).toBeCloseTo(me(server).velocity.x, 2);
    expect(me(client).velocity.x).toBeCloseTo(WALK_SPEED * propCarrySpeed(PROP_CARRY_MASS_MAX), 1);
    expect(propAt(client).carriedBy).toBe(CARRIER);
    server.dispose();
    client.dispose();
  });

  it("never decides a carry in a client's own prediction — it learns one from the snapshot", () => {
    const sim = world([ball(2)], { authoritative: false });
    sim.tick({ [CARRIER]: reach });

    expect(propAt(sim).carriedBy).toBeUndefined();
    sim.dispose();
  });
});

describe("the weight in the carrier's hands (ADR 0125)", () => {
  const walkedIn = (sim: RapierSimulation, ticks: number): number => {
    const before = me(sim).position.x;
    for (let n = 0; n < ticks; n += 1) sim.tick({ [CARRIER]: input({ moveDirection: EAST }) });
    return me(sim).position.x - before;
  };

  it("walks slower the heavier the Prop", () => {
    const light = carrying(1.5);
    const heavy = carrying(PROP_CARRY_MASS_MAX);
    const lightWalk = walkedIn(light, 40);
    const heavyWalk = walkedIn(heavy, 40);

    expect(heavyWalk).toBeLessThan(lightWalk);
    expect(heavyWalk).toBeCloseTo(WALK_SPEED * propCarrySpeed(PROP_CARRY_MASS_MAX) * 40 * TICK_DT, 0);
    light.dispose();
    heavy.dispose();
  });

  const apex = (sim: RapierSimulation): number => {
    const start = me(sim).position.y;
    let top = start;
    sim.tick({ [CARRIER]: input({ jumpHeld: true }) });
    for (let n = 0; n < 30; n += 1) {
      sim.tick({});
      top = Math.max(top, me(sim).position.y);
    }
    return top - start;
  };

  it("jumps lower with a light Prop than without one, and not at all over PROP_JUMP_MASS_MAX", () => {
    const empty = world([]);
    const light = carrying(1.5);
    const tooHeavy = carrying(PROP_JUMP_MASS_MAX + 1);

    const free = apex(empty);
    expect(apex(light)).toBeLessThan(free);
    expect(apex(light)).toBeGreaterThan(0.2);
    expect(apex(tooHeavy)).toBeLessThan(0.05);
    empty.dispose();
    light.dispose();
    tooHeavy.dispose();
  });

  it("never Dashes while carrying", () => {
    const sim = carrying(1.5);
    sim.tick({ [CARRIER]: input({ dashHeld: true, moveDirection: EAST }) });

    expect(me(sim).dashing).toBe(false);
    sim.dispose();
  });
});

describe("letting go of a Prop (ADR 0125)", () => {
  it("puts it down on a second press of Grab, back to a body physics owns", () => {
    const sim = carrying(2);
    sim.tick({ [CARRIER]: reach });
    for (let n = 0; n < 30; n += 1) sim.tick({});

    expect(me(sim).carryingProp).toBeNull();
    expect(propAt(sim).carriedBy).toBeUndefined();
    // Dropped from the carry height onto the ground.
    expect(propAt(sim).position.y).toBeCloseTo(0.35, 1);
    sim.dispose();
  });

  it("drops it when the carrier is knocked down", () => {
    const sim = carrying(2);
    sim.applyImpact(CARRIER, vec3(0, 20, 20), "Hit");
    sim.tick({});

    expect(me(sim).motionState).toBe("Ragdoll");
    expect(propAt(sim).carriedBy).toBeUndefined();
    sim.dispose();
  });

  it("drops it when the carrier is grabbed — nobody takes it out of its hands", () => {
    const sim = world([ball(2)], { other: onGround(0, 1.2) });
    lift(sim);
    // The other one, south of the carrier, reaches north for it.
    sim.tick({ [OTHER]: input({ grabHeld: true, facing: 0 }) });
    sim.tick({});

    expect(sim.snapshot().characters[OTHER]!.grabbingId).toBe(CARRIER);
    expect(propAt(sim).carriedBy).toBeUndefined();
    expect(me(sim).carryingProp).toBeNull();
    sim.dispose();
  });
});

describe("throwing a Prop (ADR 0125)", () => {
  const tap = (sim: RapierSimulation): void => {
    for (let n = 0; n < PROP_TOSS_TAP_TICKS; n += 1) sim.tick({ [CARRIER]: input({ hitHeld: true }) });
    sim.tick({});
    for (let n = 0; n < PROP_TOSS_RELEASE_TICKS; n += 1) sim.tick({});
  };

  it("tosses it straight ahead on a tap of Hit, faster the lighter it is", () => {
    const light = carrying(1.5);
    const heavy = carrying(PROP_CARRY_MASS_MAX);
    tap(light);
    tap(heavy);

    const lightVelocity = propAt(light).velocity!;
    const heavyVelocity = propAt(heavy).velocity!;
    expect(propAt(light).carriedBy).toBeUndefined();
    expect(lightVelocity.z).toBeLessThan(0); // north, where it faced
    expect(Math.abs(lightVelocity.x)).toBeLessThan(0.5);
    expect(-lightVelocity.z / -heavyVelocity.z).toBeCloseTo(propThrowScale(1.5) / propThrowScale(PROP_CARRY_MASS_MAX), 0);
    light.dispose();
    heavy.dispose();
  });

  it("Spins it while Hit is held past a tap, and Hurls it on release", () => {
    const sim = carrying(2);
    for (let n = 0; n < 30; n += 1) sim.tick({ [CARRIER]: input({ hitHeld: true }) });
    expect(me(sim).spinMs).toBeGreaterThan(0);
    sim.tick({});
    sim.tick({});

    expect(propAt(sim).carriedBy).toBeUndefined();
    expect(lengthVec3(vec3(propAt(sim).velocity!.x, 0, propAt(sim).velocity!.z))).toBeGreaterThan(3);
    sim.dispose();
  });
});

describe("a thrown Prop hits by momentum (ADR 0125)", () => {
  /** A Prop tossed at a Character standing 1.8 m ahead of the carrier: what state is it in after? */
  const tossedAt = (mass: number, radius: number, ahead: number): string => {
    const sim = world([ball(mass, radius)], { other: onGround(0, -ahead - radius) });
    lift(sim);
    for (let n = 0; n < PROP_TOSS_TAP_TICKS; n += 1) sim.tick({ [CARRIER]: input({ hitHeld: true }) });
    let worst = "Controlled";
    for (let n = 0; n < 30 + PROP_TOSS_RELEASE_TICKS; n += 1) {
      sim.tick({});
      const state = sim.snapshot().characters[OTHER]!.motionState;
      if (state === "Ragdoll" || (state === "Stagger" && worst === "Controlled")) worst = state;
    }
    sim.dispose();
    return worst;
  };

  it("hits harder with a heavy Prop than with a light one thrown the same way — momentum, not speed", () => {
    // Wherever each one comes down: a Toss arcs, and where it lands is the
    // tuning's, so the target stands at every distance in turn. The light one
    // leaves faster (`propThrowScale`) and still does less at its best.
    const rank = { Controlled: 0, Stagger: 1, Ragdoll: 2 } as Record<string, number>;
    const best = (mass: number): number =>
      Math.max(...Array.from({ length: 13 }, (_, i) => rank[tossedAt(mass, 0.45, 1.5 + i * 0.25)]!));

    expect(best(PROP_CARRY_MASS_MAX)).toBeGreaterThan(0);
    expect(best(PROP_CARRY_MASS_MAX)).toBeGreaterThan(best(1.5));
  });

  it("hurts nobody when it is only shoved — a rolling Prop is not a thrown one", () => {
    const sim = world([ball(PROP_CARRY_MASS_MAX, 0.45, -3)], { other: onGround(0, -5) });
    // Walk into it hard, north, for a second.
    for (let n = 0; n < 30; n += 1) sim.tick({ [CARRIER]: input({ moveDirection: vec3(0, 0, -1) }) });
    for (let n = 0; n < 30; n += 1) sim.tick({});

    expect(sim.snapshot().characters[OTHER]!.motionState).toBe("Controlled");
    sim.dispose();
  });
});

describe("a Lift (ADR 0128)", () => {
  it("leaves the Prop lying until the hands reach it, then has it in them — standing still the whole Lift", () => {
    const sim = world([ball(2)]);
    const lying = propAt(sim).position;
    const start = me(sim).position;
    sim.tick({ [CARRIER]: reach });
    const began = sim.snapshot().tick;
    expect(me(sim).liftStartTick).toBe(began);

    let firstInHands: number | null = null;
    for (let n = 0; n < PROP_LIFT_TICKS; n += 1) {
      // Walking and turning the whole time: none of it moves the carrier.
      sim.tick({ [CARRIER]: input({ moveDirection: EAST, facing: Math.PI / 2 }) });
      if (firstInHands === null && me(sim).carryingProp === 0) firstInHands = sim.snapshot().tick;
      if (firstInHands === null) expect(lengthVec3(subVec3(propAt(sim).position, lying))).toBeLessThan(0.01);
    }

    expect(firstInHands).toBe(began + PROP_LIFT_CONTACT_TICKS);
    expect(Math.hypot(me(sim).position.x - start.x, me(sim).position.z - start.z)).toBeLessThan(0.05);
    expect(me(sim).facing).toBeCloseTo(0, 5);
    expect(me(sim).liftStartTick).toBeNull();
    // Over: it walks again, carrying.
    for (let n = 0; n < 10; n += 1) sim.tick({ [CARRIER]: input({ moveDirection: EAST }) });
    expect(me(sim).position.x).toBeGreaterThan(start.x + 0.5);
    expect(me(sim).carryingProp).toBe(0);
    sim.dispose();
  });

  it("picks nothing up if the carrier is knocked down before the hands reach it", () => {
    const sim = world([ball(2)]);
    sim.tick({ [CARRIER]: reach });
    sim.applyImpact(CARRIER, vec3(0, 20, 20), "Hit");
    for (let n = 0; n < PROP_LIFT_TICKS; n += 1) sim.tick({});

    expect(me(sim).carryingProp).toBeNull();
    expect(me(sim).liftStartTick).toBeNull();
    expect(propAt(sim).carriedBy).toBeUndefined();
    sim.dispose();
  });

  it("catches one flying past instead — straight into the hold, nothing to bend down for", () => {
    const sim = world([{ ...ball(2), center: { x: 0, y: 3.5, z: -1.2 } }]);
    // `world` settles for half a second: it is falling past the carrier's hands by now.
    expect(lengthVec3(propAt(sim).velocity ?? vec3())).toBeGreaterThanOrEqual(HURLED_BODY_MIN_SPEED);
    sim.tick({ [CARRIER]: reach });

    expect(me(sim).carryingProp).toBe(0);
    expect(me(sim).liftStartTick).toBeNull();
    sim.dispose();
  });

  it("stands its own client's prediction still over the same Ticks, once the snapshot says it Lifts", () => {
    const server = world([ball(2)]);
    const client = world([ball(2)], { authoritative: false });
    server.tick({ [CARRIER]: reach });
    client.tick({ [CARRIER]: reach });
    client.reconcileCharacter(CARRIER, me(server));
    client.syncOwnHold(CARRIER, me(server));
    const walk = input({ moveDirection: EAST });
    for (let n = 0; n < PROP_LIFT_TICKS; n += 1) {
      server.tick({ [CARRIER]: walk });
      client.tick({ [CARRIER]: walk });
    }
    expect(Math.abs(me(client).position.x)).toBeLessThan(0.05);
    expect(Math.abs(me(server).position.x)).toBeLessThan(0.05);
    // …and no longer than that.
    for (let n = 0; n < 10; n += 1) client.tick({ [CARRIER]: walk });
    expect(me(client).position.x).toBeGreaterThan(0.3);
    server.dispose();
    client.dispose();
  });
});

describe("a Toss winds up (ADR 0128)", () => {
  it("holds the Prop and stands still for its wind-up, then lets go straight ahead", () => {
    const sim = carrying(2);
    for (let n = 0; n < PROP_TOSS_TAP_TICKS; n += 1) sim.tick({ [CARRIER]: input({ hitHeld: true }) });
    sim.tick({});
    const start = me(sim).position;
    expect(me(sim).tossMs).toBe(0);

    for (let n = 1; n < PROP_TOSS_RELEASE_TICKS; n += 1) {
      sim.tick({ [CARRIER]: input({ moveDirection: EAST }) });
      expect(propAt(sim).carriedBy).toBe(CARRIER);
    }
    expect(Math.abs(me(sim).position.x - start.x)).toBeLessThan(0.05);
    // The Tick it lets go is the carrier's own again.
    sim.tick({});

    expect(propAt(sim).carriedBy).toBeUndefined();
    expect(propAt(sim).velocity!.z).toBeLessThan(-3);
    expect(me(sim).tossMs).toBeNull();
    sim.dispose();
  });

  it("is predicted by its own client, which stands still on the tap rather than a round trip later", () => {
    const server = carrying(2);
    const client = world([ball(2)], { authoritative: false });
    client.reconcileCharacter(CARRIER, me(server));
    client.syncOwnHold(CARRIER, me(server));
    client.syncPropsToSnapshot(server.snapshot().props);
    for (let n = 0; n < PROP_TOSS_TAP_TICKS; n += 1) client.tick({ [CARRIER]: input({ hitHeld: true }) });
    client.tick({});
    const start = me(client).position.x;
    for (let n = 1; n < PROP_TOSS_RELEASE_TICKS; n += 1) client.tick({ [CARRIER]: input({ moveDirection: EAST }) });

    expect(me(client).tossMs).not.toBeNull();
    expect(me(client).position.x - start).toBeLessThan(0.05);
    server.dispose();
    client.dispose();
  });
});

describe("where a Prop sits in the hands (ADR 0128)", () => {
  /** How far a point is from the body's upright axis — the capsule the grip's `bodyFront` wraps. */
  const fromBody = (at: { forward: number; up: number }): number =>
    Math.hypot(at.forward, Math.max(0, Math.abs(at.up) - CAPSULE_HALF_HEIGHT));

  const grips: [string, Grip][] = [
    ["the carry", CARRY_GRIP],
    ["a Spin", SPIN_GRIP],
  ];

  it.each(grips)("never puts a Prop inside its carrier in %s", (_, grip) => {
    for (let radius = 0.05; radius <= 1.2; radius += 0.05) {
      expect(fromBody(propGripOffset(radius, grip))).toBeGreaterThanOrEqual(grip.bodyFront + radius - 1e-9);
    }
  });

  it.each(grips)("lifts one wider than the hands only as high as it can go with part of it still between them in %s", (_, grip) => {
    for (let radius = grip.spread / 2 + 0.05; radius <= 1.2; radius += 0.05) {
      const at = propGripOffset(radius, grip);
      const hand = Math.hypot(grip.spread / 2, at.forward - grip.reach, at.up - grip.lift);
      // Found a tilt: its surface passes through the hands. Found none: pushed out beyond them.
      if (at.up > grip.lift + 1e-9) expect(hand).toBeCloseTo(radius, 6);
      else expect(at.forward).toBeGreaterThanOrEqual(grip.reach);
    }
  });

  it("holds one narrow enough to clear the body right between the hands", () => {
    const grip: Grip = { reach: 1, lift: 0, spread: 0.6, bodyFront: 0.4 };
    expect(propGripOffset(0.2, grip)).toEqual({ forward: 1, up: 0 });
  });

  it("raises a wide one the body leaves room for, rather than pushing it out", () => {
    const grip: Grip = { reach: 1, lift: 0, spread: 0.6, bodyFront: 0.2 };
    const at = propGripOffset(0.5, grip);
    expect(at.up).toBeGreaterThan(0.3);
    expect(at.forward).toBeCloseTo(1, 6);
  });
});
