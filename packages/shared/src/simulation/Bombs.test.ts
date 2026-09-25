import { beforeAll, describe, expect, it } from "vitest";
import type { Box } from "../math/box.js";
import { lengthVec3, vec3, type Vec3 } from "../math/vec3.js";
import { bombTicks, type BombDef } from "../track/Bomb.js";
import { CAPSULE_BOTTOM_OFFSET } from "../tuning/character.js";
import { BOMB_BLAST_RADIUS, PROP_LIFT_CONTACT_TICKS, PROP_LIFT_TICKS } from "../tuning/fight.js";
import { isDownMotionState } from "./CharacterStateMachine.js";
import type { PropConfig } from "./Prop.js";
import { DEFAULT_CHARACTER_ID, RapierSimulation, initPhysics } from "./RapierSimulation.js";
import { IDLE_INPUTS, type SimInputs } from "./SimInputs.js";

beforeAll(async () => {
  await initPhysics();
});

const GROUND: Box = { center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 40, y: 0.5, z: 40 } };
const HOLDER = DEFAULT_CHARACTER_ID;
const OTHER = "other";
const onGround = (x: number, z: number): Vec3 => ({ x, y: CAPSULE_BOTTOM_OFFSET + 0.1, z });
const input = (partial: Partial<SimInputs> = {}): SimInputs => ({ ...IDLE_INPUTS, ...partial });
const reach = input({ grabHeld: true });

/** A short clock, so a test burns through it: three seconds of fuse (a Lift takes over one, ADR 0128), two of return. */
const DEF: BombDef = { fuseSeconds: 3, warnSeconds: 0.3, returnSeconds: 2 };
const FUSE = bombTicks(DEF.fuseSeconds);
const RETURN = bombTicks(DEF.returnSeconds);

const bomb = (x = 0, z = -1.2, def: BombDef = DEF): PropConfig => ({
  shape: { kind: "ball", radius: 0.4 },
  center: { x, y: 0.4, z },
  mass: 3,
  bomb: def,
});
const cone = (x: number, z: number): PropConfig => ({ shape: { kind: "ball", radius: 0.3 }, center: { x, y: 0.3, z }, mass: 1.5 });

/** The holder at the origin facing north, `props` around it, `others` standing where given; settled. */
const world = (props: PropConfig[], others: Record<string, Vec3> = {}, killPlaneY?: number): RapierSimulation => {
  const sim = new RapierSimulation({ spawn: onGround(0, 0), statics: [GROUND], props, ...(killPlaneY === undefined ? {} : { killPlaneY }) });
  for (const [id, at] of Object.entries(others)) sim.addCharacter(id, at);
  for (let n = 0; n < 15; n += 1) sim.tick({});
  return sim;
};

const idle = (sim: RapierSimulation, ticks: number): void => {
  for (let n = 0; n < ticks; n += 1) sim.tick({});
};
/** Grab at it, and the whole Lift (ADR 0128) waited out. */
const pickUp = (sim: RapierSimulation, id = HOLDER, grab = reach): void => {
  sim.tick({ [id]: grab });
  idle(sim, PROP_LIFT_TICKS);
};
const char = (sim: RapierSimulation, id: string) => sim.snapshot().characters[id]!;
const rows = (sim: RapierSimulation) => sim.snapshot().bombs ?? [];
const propAt = (sim: RapierSimulation, index = 0) => sim.snapshot().props[index]!;

describe("a bomb's fuse (ADR 0126)", () => {
  it("does not tick while it lies there — an untouched bomb sends nothing", () => {
    const sim = world([bomb()]);
    idle(sim, FUSE * 3);

    expect(sim.snapshot().bombs).toBeUndefined();
    expect(propAt(sim).live).toBe(true);
    sim.dispose();
  });

  it("is lit by being picked up — the moment the hands reach it — to go off a fuse later", () => {
    const sim = world([bomb()]);
    const reached = sim.snapshot().tick + 1 + PROP_LIFT_CONTACT_TICKS;
    pickUp(sim);

    expect(rows(sim)).toEqual([{ propIndex: 0, detonateTick: reached + FUSE }]);
    sim.dispose();
  });

  it("keeps burning once put down, and a second pick-up does not relight it", () => {
    const sim = world([bomb()], { [OTHER]: onGround(0, -2.4) });
    pickUp(sim);
    const detonateTick = rows(sim)[0]!.detonateTick;
    sim.tick({ [HOLDER]: reach }); // put down
    sim.tick({});
    expect(propAt(sim).carriedBy).toBeUndefined();
    idle(sim, 3);
    expect(rows(sim)[0]!.detonateTick).toBe(detonateTick);

    // Hot potato: the other one, facing south, picks it up.
    pickUp(sim, OTHER, input({ grabHeld: true, facing: Math.PI }));
    expect(propAt(sim).carriedBy).toBe(OTHER);
    expect(rows(sim)[0]!.detonateTick).toBe(detonateTick);
    sim.dispose();
  });
});

describe("a bomb going off (ADR 0126)", () => {
  it("in its holder's hands ends the hold and knocks the holder down", () => {
    const sim = world([bomb()]);
    pickUp(sim);
    idle(sim, FUSE);

    const holder = char(sim, HOLDER);
    expect(holder.carryingProp).toBeNull();
    expect(propAt(sim).carriedBy).toBeUndefined();
    expect(holder.motionState).toBe("Ragdoll");
    expect(holder.ragdollCause).toBe("Blast");
    sim.dispose();
  });

  it("knocks down whoever is near, only Staggers the edge, and leaves the rest alone", () => {
    const edge = BOMB_BLAST_RADIUS - 0.2;
    const sim = world([bomb(0, -1.2)], {
      near: onGround(1.5, -1.2),
      edge: onGround(-edge, -1.2),
      far: onGround(BOMB_BLAST_RADIUS + 1.5, -1.2),
    });
    pickUp(sim);
    sim.tick({ [HOLDER]: reach }); // put it down where it was picked up
    idle(sim, FUSE);

    expect(isDownMotionState(char(sim, "near").motionState)).toBe(true);
    expect(char(sim, "near").ragdollCause).toBe("Blast");
    expect(char(sim, "edge").motionState).toBe("Stagger");
    expect(char(sim, "far").motionState).toBe("Controlled");
    sim.dispose();
  });

  it("throws someone beside it metres away, not a Hit's shove (ADR 0126, amended)", () => {
    const sim = world([bomb(0, -1.2)], { near: onGround(1.5, -1.2) });
    pickUp(sim);
    sim.tick({ [HOLDER]: reach });
    idle(sim, FUSE);
    const start = char(sim, "near").position;
    idle(sim, 45);

    const end = char(sim, "near").position;
    const travelled = Math.hypot(end.x - start.x, end.z - start.z);
    expect(end.x - start.x).toBeGreaterThan(0); // away: east of the bomb
    expect(travelled).toBeGreaterThan(4);
    sim.dispose();
  });

  it("pushes a Prop in reach away from it", () => {
    const sim = world([bomb(0, -1.2), cone(2, -1.2)]);
    pickUp(sim);
    sim.tick({ [HOLDER]: reach });
    const before = propAt(sim, 1).position;
    idle(sim, FUSE + 10);

    const moved = vec3(propAt(sim, 1).position.x - before.x, 0, propAt(sim, 1).position.z - before.z);
    expect(lengthVec3(moved)).toBeGreaterThan(0.5);
    expect(moved.x).toBeGreaterThan(0); // away: east of the bomb
    sim.dispose();
  });

  it("is spent: out of play where it went off, then back where it was placed, unlit", () => {
    const sim = world([bomb(0, -1.2)]);
    pickUp(sim);
    sim.tick({ [HOLDER]: input({ moveDirection: vec3(1, 0, 0), facing: Math.PI / 2 }) });
    idle(sim, FUSE);

    const spent = rows(sim)[0]!;
    expect(spent.blasted).toBe(true);
    expect(spent.detonateTick).toBeUndefined();
    expect(propAt(sim).live).toBe(false);
    // Nothing to pick up while it is gone.
    sim.tick({ [HOLDER]: reach });
    expect(propAt(sim).carriedBy).toBeUndefined();

    idle(sim, RETURN + 2);
    expect(sim.snapshot().bombs).toBeUndefined();
    expect(propAt(sim).live).toBe(true);
    expect(propAt(sim).position.x).toBeCloseTo(0, 1);
    expect(propAt(sim).position.z).toBeCloseTo(-1.2, 1);
    sim.dispose();
  });

  it("goes out without a blast when it falls below the kill plane, and comes back all the same", () => {
    const sim = world([{ ...bomb(0, -1.2), center: { x: 60, y: 0.4, z: 0 } }], {}, -5);
    idle(sim, 60); // off the ground's edge, falling

    const spent = rows(sim)[0]!;
    expect(spent.returnTick).toBeDefined();
    expect(spent.blasted).toBeUndefined();
    expect(char(sim, HOLDER).motionState).toBe("Controlled");
    sim.dispose();
  });

  it("switches a spent bomb's colliders off in a client's prediction too", () => {
    const server = world([bomb(0, -1.2)]);
    pickUp(server);
    server.tick({ [HOLDER]: reach });
    idle(server, FUSE);
    const client = world([bomb(0, -1.2)]);
    client.syncPropsToSnapshot(server.snapshot().props);

    expect(propAt(client).live).toBe(false);
    server.dispose();
    client.dispose();
  });
});
