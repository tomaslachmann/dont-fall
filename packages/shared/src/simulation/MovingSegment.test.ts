import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { IDENTITY_QUAT } from "../math/quat.js";
import { addVec3, rotateVec3ByQuat, subVec3 } from "../math/vec3.js";
import { CAPSULE_BOTTOM_OFFSET, CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS } from "../tuning/character.js";
import { TICK_RATE_HZ } from "../tuning/clock.js";
import type { Module } from "../track/Module.js";
import { loadAssetModule } from "../track/asset.js";
import { ASSET_MODULE_DEFS, attachAssetGeometry } from "../track/assetModules.js";
import { resolveTrack } from "../track/resolveTrack.js";
import { type Track } from "../track/Track.js";
import {
  impactOutcome,
  motionTwist,
  MOVING_SEGMENT_RAGDOLL_SPEED,
  MOVING_SEGMENT_STAGGER_SPEED,
  movingSegmentImpactMagnitude,
  movingSegmentPose,
} from "./MovingSegment.js";
import { motionPointVelocity, motionPose } from "../track/Motion.js";
import { DEFAULT_CHARACTER_ID, RapierSimulation, initPhysics } from "./RapierSimulation.js";
import { IDLE_INPUTS } from "./SimInputs.js";

beforeAll(async () => {
  await initPhysics();
});

// A 4 × 0.5 × 4 deck, top face at y = 0 in its own frame.
const DECK: Module = {
  id: "deck",
  statics: [{ center: { x: 0, y: -0.25, z: 0 }, halfExtents: { x: 2, y: 0.25, z: 2 } }],
  sockets: [],
  footprint: { bounds: { center: { x: 0, y: -0.25, z: 0 }, halfExtents: { x: 2, y: 0.25, z: 2 } }, clearance: 0.5 },
};
const MODULES = { deck: DECK };

// Slides 20 along +x and back over 40 s — 1 unit per second, linear.
const SLIDING: Track = [
  {
    moduleId: "deck",
    position: { x: 0, y: 0, z: 0 },
    rotation: 0,
    motion: { slide: { offset: { x: 20, y: 0, z: 0 }, period: 40, easing: "linear" } },
  },
];

const simFor = (track: Track): RapierSimulation =>
  new RapierSimulation({ ...resolveTrack(MODULES, track), withDefaultCharacter: false });

const settle = (sim: RapierSimulation, seconds: number): void => {
  for (let n = 0; n < Math.round(seconds * TICK_RATE_HZ); n += 1) sim.tick({ [DEFAULT_CHARACTER_ID]: IDLE_INPUTS });
};

describe("resolveTrack with a Motion", () => {
  it("keeps a moving Segment's collision local, on its own, and out of the still world", () => {
    const resolved = resolveTrack(MODULES, [...SLIDING, { moduleId: "deck", position: { x: 0, y: 0, z: 30 }, rotation: 0 }]);

    expect(resolved.statics).toHaveLength(1); // only the still deck
    expect(resolved.movingSegments).toHaveLength(1);
    const [moving] = resolved.movingSegments;
    expect(moving!.segmentIndex).toBe(0);
    expect(moving!.boxes[0]!.box).toEqual(DECK.statics[0]);
    expect(moving!.orientation).toEqual(IDENTITY_QUAT);
  });

  it("poses a moving Segment by its Motion, then its placement", () => {
    const [moving] = resolveTrack(MODULES, [{ ...SLIDING[0]!, position: { x: 1, y: 2, z: 3 }, rotation: Math.PI / 2 }]).movingSegments;
    // 10 s in: slid 10 along its own +x, which a quarter turn points along world −z.
    const pose = movingSegmentPose(moving!, 10 * TICK_RATE_HZ);
    expect(pose.position.x).toBeCloseTo(1);
    expect(pose.position.y).toBeCloseTo(2);
    expect(pose.position.z).toBeCloseTo(3 - 10);
  });
});

describe("a Moving Segment in the simulation", () => {
  it("is collided with where its Motion says, not where it rests", () => {
    const sim = simFor(SLIDING);
    settle(sim, 10); // the deck is now centred on x ≈ 10

    sim.addCharacter("onDeck", { x: 10, y: CAPSULE_BOTTOM_OFFSET + 1, z: 0 });
    sim.addCharacter("atRest", { x: 0, y: CAPSULE_BOTTOM_OFFSET + 1, z: 0 });
    for (let n = 0; n < 20; n += 1) sim.tick({});

    const { characters } = sim.snapshot();
    expect(characters.onDeck!.grounded).toBe(true);
    expect(characters.onDeck!.position.y).toBeCloseTo(CAPSULE_BOTTOM_OFFSET, 1);
    expect(characters.atRest!.grounded).toBe(false);
    expect(characters.atRest!.position.y).toBeLessThan(0);
    sim.dispose();
  });

  it("agrees across simulations that only share the Tick — including one that jumped to it", () => {
    const stepped = simFor(SLIDING);
    settle(stepped, 10);
    const jumped = simFor(SLIDING);
    jumped.syncTick(10 * TICK_RATE_HZ);

    for (const sim of [stepped, jumped]) sim.addCharacter("dropped", { x: 11.5, y: CAPSULE_BOTTOM_OFFSET + 1, z: 0 });
    for (let n = 0; n < 20; n += 1) {
      stepped.tick({});
      jumped.tick({});
    }

    const a = stepped.snapshot().characters.dropped!;
    const b = jumped.snapshot().characters.dropped!;
    expect(a.grounded).toBe(true);
    expect(b.grounded).toBe(true);
    expect(b.position.y).toBeCloseTo(a.position.y, 4);
    stepped.dispose();
    jumped.dispose();
  });
});

describe("riding a Moving Segment (ticket 03)", () => {
  const deckTrack = (motion: NonNullable<Track[number]["motion"]>): Track => [
    { moduleId: "deck", position: { x: 0, y: 0, z: 0 }, rotation: 0, motion },
  ];
  const standOn = (track: Track, at = { x: 0, y: 0, z: 0 }): RapierSimulation => {
    const sim = simFor(track);
    sim.addCharacter(DEFAULT_CHARACTER_ID, { x: at.x, y: CAPSULE_BOTTOM_OFFSET + 0.05, z: at.z });
    return sim;
  };
  const me = (sim: RapierSimulation) => sim.snapshot().characters[DEFAULT_CHARACTER_ID]!;

  it("carries a Character standing still on a sliding deck, all the way out and back", () => {
    // 3 units/s along x, out 12 over 4 s, back over 4 s.
    const sim = standOn(deckTrack({ slide: { offset: { x: 12, y: 0, z: 0 }, period: 8, easing: "linear" } }));
    let worstGap = 0;
    for (let n = 0; n < 8 * TICK_RATE_HZ; n += 1) {
      sim.tick({ [DEFAULT_CHARACTER_ID]: IDLE_INPUTS });
      const deckX = 12 * Math.min((n + 1) / (4 * TICK_RATE_HZ), 2 - (n + 1) / (4 * TICK_RATE_HZ));
      worstGap = Math.max(worstGap, Math.abs(me(sim).position.x - deckX));
      expect(me(sim).fallCount).toBe(0);
    }
    expect(me(sim).grounded).toBe(true);
    expect(worstGap).toBeLessThan(0.25);
    sim.dispose();
  });

  it("rides a deck up and down without leaving it", () => {
    const sim = standOn(deckTrack({ slide: { offset: { x: 0, y: 4, z: 0 }, period: 4, easing: "easeInOut" } }));
    for (let n = 0; n < 4 * TICK_RATE_HZ; n += 1) {
      sim.tick({ [DEFAULT_CHARACTER_ID]: IDLE_INPUTS });
      if (n > 3) expect(me(sim).grounded).toBe(true);
    }
    // One full period later the deck is back at rest, and so is its rider.
    expect(me(sim).position.y).toBeCloseTo(CAPSULE_BOTTOM_OFFSET, 1);
    sim.dispose();
  });

  it("carries a Character round a carousel's pivot", () => {
    // A quarter turn per second about the deck's centre.
    const sim = standOn(deckTrack({ spin: { axis: { x: 0, y: 1, z: 0 }, pivot: { x: 0, y: 0, z: 0 }, speed: Math.PI / 2 } }), {
      x: 1.2,
      y: 0,
      z: 0,
    });
    settle(sim, 1);
    // (1.2, 0) turned a quarter right-handed about +y lands on (0, -1.2).
    expect(me(sim).position.x).toBeCloseTo(0, 0);
    expect(me(sim).position.z).toBeCloseTo(-1.2, 0);
    expect(Math.hypot(me(sim).position.x, me(sim).position.z)).toBeCloseTo(1.2, 0);
    expect(me(sim).grounded).toBe(true);
    sim.dispose();
  });

  it("keeps the deck's speed after jumping off it", () => {
    const moving = deckTrack({ slide: { offset: { x: 12, y: 0, z: 0 }, period: 8, easing: "linear" } });
    const still: Track = [{ moduleId: "deck", position: { x: 0, y: 0, z: 0 }, rotation: 0 }];
    const airborneDrift = (track: Track): number => {
      const sim = standOn(track);
      settle(sim, 0.5); // on the move (or not), at full deck speed
      const before = me(sim).position.x;
      const jump = { ...IDLE_INPUTS, jumpHeld: true };
      for (let n = 0; n < 12; n += 1) sim.tick({ [DEFAULT_CHARACTER_ID]: jump });
      expect(me(sim).grounded).toBe(false);
      const drift = me(sim).position.x - before;
      sim.dispose();
      return drift;
    };
    // 12 ticks at 3 units/s is ~1.2 units the still jump never covers.
    expect(airborneDrift(moving) - airborneDrift(still)).toBeGreaterThan(1);
  });

  it("keeps riding through a reconcile that forgets which floor it stood on", () => {
    const track = deckTrack({ slide: { offset: { x: 12, y: 0, z: 0 }, period: 8, easing: "linear" } });
    const reference = standOn(track);
    const replayed = standOn(track);
    settle(reference, 1);
    settle(replayed, 1);
    // The client's correction path: sync the Tick, reset to the same state.
    replayed.syncTick(reference.snapshot().tick);
    replayed.reconcileCharacter(DEFAULT_CHARACTER_ID, me(replayed));
    settle(reference, 1);
    settle(replayed, 1);
    expect(me(replayed).position.x).toBeCloseTo(me(reference).position.x, 1);
    reference.dispose();
    replayed.dispose();
  });
});

describe("pushed and hit by a Moving Segment (ticket 04)", () => {
  // A 6 × 1 × 0.5 bar from its pivot at the origin out along +x.
  const BAR: Module = {
    id: "bar",
    statics: [{ center: { x: 3, y: 0.5, z: 0 }, halfExtents: { x: 3, y: 0.5, z: 0.25 } }],
    sockets: [],
    footprint: { bounds: { center: { x: 3, y: 0.5, z: 0 }, halfExtents: { x: 3, y: 0.5, z: 0.25 } }, clearance: 0.5 },
  };
  // A wall 0.5 thick and 4 wide/tall, centred on its origin.
  const WALL: Module = {
    id: "wall",
    statics: [{ center: { x: 0, y: 1, z: 0 }, halfExtents: { x: 0.25, y: 1, z: 2 } }],
    sockets: [],
    footprint: { bounds: { center: { x: 0, y: 1, z: 0 }, halfExtents: { x: 0.25, y: 1, z: 2 } }, clearance: 0.5 },
  };
  const FLOOR: Module = {
    id: "floor",
    statics: [{ center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 20, y: 0.5, z: 20 } }],
    sockets: [],
    footprint: { bounds: { center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 20, y: 0.5, z: 20 } }, clearance: 0.5 },
  };
  const LIBRARY = { bar: BAR, wall: WALL, floor: FLOOR };
  const floor = { moduleId: "floor", position: { x: 0, y: 0, z: 0 }, rotation: 0 };
  const worldWith = (segment: Track[number], standers: Record<string, { x: number; z: number }>): RapierSimulation => {
    const sim = new RapierSimulation({ ...resolveTrack(LIBRARY, [floor, segment]), withDefaultCharacter: false });
    for (const [id, at] of Object.entries(standers)) sim.addCharacter(id, { x: at.x, y: CAPSULE_BOTTOM_OFFSET + 0.05, z: at.z });
    return sim;
  };
  const run = (sim: RapierSimulation, seconds: number, watch: string[]): Set<string> => {
    const downed = new Set<string>();
    for (let n = 0; n < Math.round(seconds * TICK_RATE_HZ); n += 1) {
      sim.tick({});
      for (const id of watch) {
        const c = sim.snapshot().characters[id]!;
        if (c.motionState === "Ragdoll" && c.ragdollCause === "Obstacle") downed.add(id);
      }
    }
    return downed;
  };

  it("pushes a Character out of the way of a slow slide, without knocking it", () => {
    // Walking pace, 1.5 units/s along +x, starting 1 unit short of the Character.
    const sim = worldWith(
      { moduleId: "wall", position: { x: -1, y: 0, z: 0 }, rotation: 0, motion: { slide: { offset: { x: 6, y: 0, z: 0 }, period: 8, easing: "linear" } } },
      { me: { x: 0.5, z: 0 } },
    );
    const downed = run(sim, 2, ["me"]);
    const me = sim.snapshot().characters.me!;
    expect(downed.size).toBe(0);
    expect(me.motionState).not.toBe("Ragdoll");
    // The wall's front face is at -1 + 3 + 0.25 = 2.25 by now; the capsule is in front of it.
    expect(me.position.x).toBeGreaterThan(2.25);
    sim.dispose();
  });

  it("knocks a Character down with a fast swing", () => {
    // A swing through ±90° about y every second: the tip passes at ~30 units/s.
    const sim = worldWith(
      {
        moduleId: "bar",
        position: { x: 0, y: 0, z: 0 },
        rotation: 0,
        motion: { swing: { axis: { x: 0, y: 1, z: 0 }, pivot: { x: 0, y: 0, z: 0 }, amplitude: Math.PI / 2, period: 1, easing: "linear" } },
      },
      { me: { x: 4.5, z: 0 } },
    );
    expect(run(sim, 1, ["me"])).toContain("me");
    sim.dispose();
  });

  it("hits harder at the rim of a spin than near its hub", () => {
    // 3 rad/s: 15 units/s at 5 from the hub, 2.4 at 0.8.
    const sim = worldWith(
      { moduleId: "bar", position: { x: 0, y: 0, z: 0 }, rotation: 0, motion: { spin: { axis: { x: 0, y: 1, z: 0 }, pivot: { x: 0, y: 0, z: 0 }, speed: 3, startAngle: -0.6 } } },
      { rim: { x: 5, z: 0 }, hub: { x: 0.9, z: -0.1 } },
    );
    const hubBefore = sim.snapshot().characters.hub!.position;
    const downed = run(sim, 0.5, ["rim", "hub"]);
    expect(downed).toContain("rim");
    expect(downed).not.toContain("hub");
    // …and the bar really did reach the hub Character: it was shoved, not missed.
    const hubAfter = sim.snapshot().characters.hub!.position;
    expect(Math.hypot(hubAfter.x - hubBefore.x, hubAfter.z - hubBefore.z)).toBeGreaterThan(0.1);
    sim.dispose();
  });

  it("never hits the Character riding on top of it", () => {
    // A fast carousel raised off the floor: the deck under the rider moves at 4.5 units/s.
    const carousel = { spin: { axis: { x: 0, y: 1, z: 0 }, pivot: { x: 0, y: 0, z: 0 }, speed: 3 } };
    const rideSim = new RapierSimulation({
      ...resolveTrack({ ...LIBRARY, deck: DECK }, [floor, { moduleId: "deck", position: { x: 0, y: 1, z: 0 }, rotation: 0, motion: carousel }]),
      withDefaultCharacter: false,
    });
    rideSim.addCharacter("rider", { x: 1.5, y: 1 + CAPSULE_BOTTOM_OFFSET + 0.05, z: 0 });
    expect(run(rideSim, 2, ["rider"]).size).toBe(0);
    expect(rideSim.snapshot().characters.rider!.grounded).toBe(true);
    rideSim.dispose();
  });
});

describe("Spiked Assets (ticket 05)", () => {
  /** A closed, outward-wound box trimesh — what a converted spike plate's collision is, minus the spikes. */
  const boxMesh = (h: { x: number; y: number; z: number }, c: { x: number; y: number; z: number }) => {
    const positions = [
      [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
      [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
    ].map(([x, y, z]) => ({ x: c.x + x! * h.x, y: c.y + y! * h.y, z: c.z + z! * h.z }));
    const indices = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5];
    return { positions, indices, surface: "default" as const };
  };
  const plate = (hazard: "spiked" | undefined, h = { x: 2, y: 0.25, z: 2 }, c = { x: 0, y: 0.25, z: 0 }): Module => ({
    id: hazard ? "spikes" : "plate",
    statics: [],
    asset: { meshes: [boxMesh(h, c)] },
    sockets: [],
    footprint: { bounds: { center: c, halfExtents: h }, clearance: 0.5 },
    ...(hazard ? { hazard } : {}),
  });
  const FLOOR: Module = {
    id: "floor",
    statics: [{ center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 30, y: 0.5, z: 30 } }],
    sockets: [],
    footprint: { bounds: { center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 30, y: 0.5, z: 30 } }, clearance: 0.5 },
  };
  const LIBRARY = { spikes: plate("spiked"), plate: plate(undefined), floor: FLOOR, wall: plate("spiked", { x: 0.25, y: 1, z: 2 }, { x: 0, y: 1, z: 0 }) };
  const floor = { moduleId: "floor", position: { x: 0, y: 0, z: 0 }, rotation: 0 };
  const knockedByObstacle = (sim: RapierSimulation, id: string, seconds: number, input = IDLE_INPUTS): boolean => {
    for (let n = 0; n < Math.round(seconds * TICK_RATE_HZ); n += 1) {
      sim.tick({ [id]: input });
      const c = sim.snapshot().characters[id]!;
      if (c.motionState === "Ragdoll" && c.ragdollCause === "Obstacle") return true;
    }
    return false;
  };

  it("knocks down a Character that stands on it, and not one standing on the same plate unspiked", () => {
    for (const [moduleId, expected] of [["spikes", true], ["plate", false]] as const) {
      const sim = new RapierSimulation({ ...resolveTrack(LIBRARY, [floor, { moduleId, position: { x: 0, y: 0, z: 0 }, rotation: 0 }]), withDefaultCharacter: false });
      sim.addCharacter("me", { x: 0, y: 0.5 + CAPSULE_BOTTOM_OFFSET + 0.05, z: 0 });
      expect(knockedByObstacle(sim, "me", 1), moduleId).toBe(expected);
      sim.dispose();
    }
  });

  it("knocks down a Character that walks into it, at walking pace", () => {
    const sim = new RapierSimulation({ ...resolveTrack(LIBRARY, [floor, { moduleId: "wall", position: { x: 0, y: 0, z: -3 }, rotation: Math.PI / 2 }]), withDefaultCharacter: false });
    sim.addCharacter("me", { x: 0, y: CAPSULE_BOTTOM_OFFSET + 0.05, z: 0 });
    expect(knockedByObstacle(sim, "me", 2, { ...IDLE_INPUTS, moveDirection: { x: 0, y: 0, z: -1 } })).toBe(true);
    sim.dispose();
  });

  it("knocks down a Character a slowly moving spiked Segment reaches", () => {
    // Half a unit per second — far below any Stagger, and still a knockdown.
    const sim = new RapierSimulation({
      ...resolveTrack(LIBRARY, [
        floor,
        { moduleId: "wall", position: { x: -1, y: 0, z: 0 }, rotation: 0, motion: { slide: { offset: { x: 4, y: 0, z: 0 }, period: 16, easing: "linear" } } },
      ]),
      withDefaultCharacter: false,
    });
    sim.addCharacter("me", { x: 0, y: CAPSULE_BOTTOM_OFFSET + 0.05, z: 0 });
    expect(knockedByObstacle(sim, "me", 3)).toBe(true);
    sim.dispose();
  });
});

describe("the Impact rule the builder tint shares (ticket 07)", () => {
  it("maps closing speed to the same outcomes the simulation delivers", () => {
    expect(impactOutcome(movingSegmentImpactMagnitude(MOVING_SEGMENT_STAGGER_SPEED - 0.01))).toBe("none");
    expect(impactOutcome(movingSegmentImpactMagnitude(MOVING_SEGMENT_STAGGER_SPEED))).toBe("stagger");
    expect(impactOutcome(movingSegmentImpactMagnitude(MOVING_SEGMENT_RAGDOLL_SPEED))).toBe("ragdoll");
    expect(movingSegmentImpactMagnitude(-5)).toBe(0); // moving away never hits
  });

  it("describes a motion by a twist whose point velocities match the simulation's", () => {
    const motion = {
      spin: { axis: { x: 0, y: 1, z: 0 }, pivot: { x: 1, y: 0, z: 0 }, speed: 2 },
      slide: { offset: { x: 0, y: 0, z: 6 }, period: 4, easing: "linear" as const },
    };
    const tick = 7;
    const twist = motionTwist((t) => motionPose(motion, t), tick);
    expect(twist.angular.y).toBeCloseTo(2, 3);
    for (const local of [{ x: 3, y: 0, z: 0 }, { x: 0, y: 1, z: -2 }]) {
      const now = motionPose(motion, tick);
      const world = addVec3(rotateVec3ByQuat(local, now.rotation), now.position);
      const r = subVec3(world, twist.origin);
      const fromTwist = addVec3(twist.linear, {
        x: twist.angular.y * r.z - twist.angular.z * r.y,
        y: twist.angular.z * r.x - twist.angular.x * r.z,
        z: twist.angular.x * r.y - twist.angular.y * r.x,
      });
      const exact = motionPointVelocity(motion, tick, local);
      // First-order in a 2/30 rad step: within a few percent of the chord.
      expect(fromTwist.x).toBeCloseTo(exact.x, 0);
      expect(fromTwist.z).toBeCloseTo(exact.z, 0);
    }
  });
});

describe("a scaled Moving Segment (ADR 0062)", () => {
  it("scales its collision and its Motion together — the same piece, zoomed", () => {
    const [moving] = resolveTrack(MODULES, [{ ...SLIDING[0]!, scale: 2 }]).movingSegments;
    expect(moving!.boxes[0]!.box.halfExtents).toEqual({ x: 4, y: 0.5, z: 4 });
    // 10 s in, a 1× deck has slid 10; at 2× it has slid 20.
    expect(movingSegmentPose(moving!, 10 * TICK_RATE_HZ).position.x).toBeCloseTo(20);
  });

  it("is ridden and collided with at its scaled pose", () => {
    const sim = new RapierSimulation({ ...resolveTrack(MODULES, [{ ...SLIDING[0]!, scale: 2 }]), withDefaultCharacter: false });
    settle(sim, 5); // deck centred on x ≈ 10 at 2×
    sim.addCharacter("onDeck", { x: 10, y: CAPSULE_BOTTOM_OFFSET + 1, z: 0 });
    for (let n = 0; n < 20; n += 1) sim.tick({});
    const me = sim.snapshot().characters.onDeck!;
    expect(me.grounded).toBe(true);
    expect(me.position.y).toBeCloseTo(CAPSULE_BOTTOM_OFFSET, 1);
    sim.dispose();
  });
});

describe("pressed from above by a Moving Segment (collision-shapes research, push-out fix)", () => {
  /** A closed, outward-wound UV sphere trimesh — how `trap_trapball`'s ball collides today. */
  const sphereMesh = (radius: number, centre: { x: number; y: number; z: number }) => {
    const rings = 12;
    const segments = 24;
    const positions: { x: number; y: number; z: number }[] = [];
    for (let r = 0; r <= rings; r += 1) {
      const phi = (r / rings) * Math.PI;
      for (let g = 0; g < segments; g += 1) {
        const theta = (g / segments) * Math.PI * 2;
        positions.push({
          x: centre.x + radius * Math.sin(phi) * Math.cos(theta),
          y: centre.y + radius * Math.cos(phi),
          z: centre.z + radius * Math.sin(phi) * Math.sin(theta),
        });
      }
    }
    const indices: number[] = [];
    const at = (r: number, g: number) => r * segments + (g % segments);
    for (let r = 0; r < rings; r += 1) {
      for (let g = 0; g < segments; g += 1) {
        indices.push(at(r, g), at(r, g + 1), at(r + 1, g), at(r, g + 1), at(r + 1, g + 1), at(r + 1, g));
      }
    }
    return { positions, indices, surface: "default" as const };
  };
  // A ball of radius 1.16 hanging from a pivot 5.2 up: at the bottom of the swing its underside is
  // at y = 1.6 — into the head of a Character standing below (capsule top ≈ 1.8).
  const BALL: Module = {
    id: "ball",
    statics: [],
    asset: { meshes: [sphereMesh(1.16, { x: 0, y: 2.76, z: 0 })] },
    sockets: [],
    footprint: { bounds: { center: { x: 0, y: 2.76, z: 0 }, halfExtents: { x: 1.16, y: 1.16, z: 1.16 } }, clearance: 0.5 },
  };
  const GROUND: Module = {
    id: "ground",
    statics: [{ center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 8, y: 0.5, z: 8 } }],
    sockets: [],
    footprint: { bounds: { center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 8, y: 0.5, z: 8 } }, clearance: 0.5 },
  };
  const swingingBall = (period: number): RapierSimulation => {
    const sim = new RapierSimulation({
      ...resolveTrack({ ball: BALL, ground: GROUND }, [
        { moduleId: "ground", position: { x: 0, y: 0, z: 0 }, rotation: 0 },
        {
          moduleId: "ball",
          position: { x: 0, y: 0, z: 0 },
          rotation: 0,
          motion: { swing: { axis: { x: 0, y: 0, z: 1 }, pivot: { x: 0, y: 5.2, z: 0 }, amplitude: 0.6, period, easing: "linear" } },
        },
      ]),
      withDefaultCharacter: false,
    });
    sim.addCharacter("me", { x: 0.3, y: CAPSULE_BOTTOM_OFFSET + 0.1, z: 0 });
    return sim;
  };

  it("is shoved out along the swing, not held underneath the ball", () => {
    const period = 6; // slow: well under the Stagger speed
    const sim = swingingBall(period);
    const [config] = resolveTrack({ ball: BALL, ground: GROUND }, [
      { moduleId: "ball", position: { x: 0, y: 0, z: 0 }, rotation: 0, motion: { swing: { axis: { x: 0, y: 0, z: 1 }, pivot: { x: 0, y: 5.2, z: 0 }, amplitude: 0.6, period, easing: "linear" } } },
    ]).movingSegments;
    let lowest = Infinity;
    let deepest = 0;
    for (let n = 0; n < period * TICK_RATE_HZ; n += 1) {
      sim.tick({});
      const me = sim.snapshot().characters.me!;
      lowest = Math.min(lowest, me.position.y);
      // How far the capsule sits inside the ball: its axis segment against the ball's centre.
      const pose = movingSegmentPose(config!, sim.snapshot().tick);
      const centre = addVec3(rotateVec3ByQuat({ x: 0, y: 2.76, z: 0 }, pose.rotation), pose.position);
      const nearestY = Math.min(me.position.y + CAPSULE_HALF_HEIGHT, Math.max(me.position.y - CAPSULE_HALF_HEIGHT, centre.y));
      const distance = Math.hypot(me.position.x - centre.x, nearestY - centre.y, me.position.z - centre.z);
      deepest = Math.max(deepest, 1.16 + CAPSULE_RADIUS - distance);
    }
    console.log("pressed-from-above", { lowest, deepest });
    expect(lowest).toBeGreaterThan(CAPSULE_BOTTOM_OFFSET - 0.15); // never pressed down into the floor
    expect(deepest).toBeLessThan(0.35); // never held inside the ball's path
    sim.dispose();
  });

  it("is knocked down when the ball sweeps over it fast", () => {
    // 2·0.6 rad over 0.25 s ≈ 4.8 rad/s: the underside, ~3.6 below the pivot, passes at ~17 units/s.
    const sim = swingingBall(0.5);
    let downed = false;
    for (let n = 0; n < 2 * TICK_RATE_HZ && !downed; n += 1) {
      sim.tick({});
      const me = sim.snapshot().characters.me!;
      downed = me.motionState === "Ragdoll" && me.ragdollCause === "Obstacle";
    }
    expect(downed).toBe(true);
    sim.dispose();
  });
});

describe("the real trap_trapball on a Swing (solid parts, ADR 0065)", () => {
  // Measured before solid parts: its hollow collision trimesh left a knocked-down ragdoll
  // carried *inside* the ball for the whole swing, and never pushed out a Character it reached.
  const assetsRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "assets");
  const def = ASSET_MODULE_DEFS.find((d) => d.id === "trap_trapball")!;
  const BALL = attachAssetGeometry(
    def,
    loadAssetModule(new Uint8Array(readFileSync(join(assetsRoot, "trap_trapball.glb"))), { footprint: def.footprint.bounds }),
  );
  const ballPart = BALL.asset!.solid!.find((part) => part.shape.type === "ball")!;
  const ballRadius = (ballPart.shape as { radius: number }).radius;
  const GROUND: Module = {
    id: "ground",
    statics: [{ center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 8, y: 0.5, z: 8 } }],
    sockets: [],
    footprint: { bounds: { center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 8, y: 0.5, z: 8 } }, clearance: 0.5 },
  };
  /** A pendulum from the chain's top, like the builder's Pendulum shape. */
  const swingWorld = (amplitudeDegrees: number, period: number, standAt: { x: number; z: number }) => {
    const motion = {
      swing: { axis: { x: 1, y: 0, z: 0 }, pivot: { x: 0, y: 7.52, z: 0 }, amplitude: (amplitudeDegrees * Math.PI) / 180, period, easing: "easeInOut" as const },
    };
    const resolved = resolveTrack({ trap_trapball: BALL, ground: GROUND }, [
      { moduleId: "ground", position: { x: 0, y: 0, z: 0 }, rotation: 0 },
      { moduleId: "trap_trapball", position: { x: 0, y: 0.05, z: 0 }, rotation: 0, motion },
    ]);
    const sim = new RapierSimulation({ ...resolved, withDefaultCharacter: false });
    sim.addCharacter("me", { x: standAt.x, y: CAPSULE_BOTTOM_OFFSET + 0.1, z: standAt.z });
    /** How deep the Character's capsule axis sits inside the ball right now. */
    const depthInBall = (): number => {
      const me = sim.snapshot().characters.me!;
      const pose = movingSegmentPose(resolved.movingSegments[0]!, sim.snapshot().tick);
      const centre = addVec3(rotateVec3ByQuat(ballPart.position, pose.rotation), pose.position);
      const nearestY = Math.min(me.position.y + CAPSULE_HALF_HEIGHT, Math.max(me.position.y - CAPSULE_HALF_HEIGHT, centre.y));
      return ballRadius + CAPSULE_RADIUS - Math.hypot(me.position.x - centre.x, nearestY - centre.y, me.position.z - centre.z);
    };
    return { sim, depthInBall };
  };

  it("collides as a ball and a chain, never as its render mesh", () => {
    const [moving] = resolveTrack({ trap_trapball: BALL }, [
      { moduleId: "trap_trapball", position: { x: 0, y: 0, z: 0 }, rotation: 0, motion: { spin: { axis: { x: 0, y: 1, z: 0 }, pivot: { x: 0, y: 0, z: 0 }, speed: 1 } } },
    ]).movingSegments;
    expect(moving!.trimeshes).toEqual([]);
    expect(moving!.solids.map((part) => part.shape.type).sort()).toEqual(["ball", "capsule"]);
  });

  it("knocks a Character in its path clear of it, never carrying the ragdoll inside", () => {
    const { sim, depthInBall } = swingWorld(60, 2, { x: 0, z: 0 });
    let knocked = false;
    let run = 0;
    let longestRunInside = 0;
    for (let n = 0; n < 4 * TICK_RATE_HZ; n += 1) {
      sim.tick({});
      knocked ||= sim.snapshot().characters.me!.motionState === "Ragdoll";
      // A hit overlaps the ball while the body is flung along with it (measured: 4 ticks at this
      // ~26 units/s swing); carried inside the old hollow shell, the run never ended at all.
      run = depthInBall() > 0.5 ? run + 1 : 0;
      longestRunInside = Math.max(longestRunInside, run);
    }
    expect(knocked).toBe(true);
    expect(longestRunInside).toBeLessThanOrEqual(10);
    sim.dispose();
  });

  it("pushes out a Character the ball reaches where it stands", () => {
    // Standing inside the ball's reach at Tick 0: the old hollow shell never pushed it out.
    const { sim, depthInBall } = swingWorld(30, 4, { x: 0, z: 2.5 });
    expect(depthInBall()).toBeGreaterThan(0.3);
    let stillInside = 0;
    for (let n = 0; n < 2 * TICK_RATE_HZ; n += 1) {
      sim.tick({});
      if (n > 6 && depthInBall() > 0.3) stillInside += 1;
    }
    expect(stillInside).toBe(0);
    sim.dispose();
  });
});

describe("profiling the tick (M13 ticket 02)", () => {
  // A Character riding the sliding deck, so the step has real contacts to solve.
  const ridingWorld = (profileClock?: () => number): RapierSimulation => {
    const sim = new RapierSimulation({
      ...resolveTrack(MODULES, SLIDING),
      withDefaultCharacter: false,
      ...(profileClock === undefined ? {} : { profileClock }),
    });
    sim.addCharacter("me", { x: 0, y: CAPSULE_BOTTOM_OFFSET + 0.05, z: 0 });
    return sim;
  };

  it("times nothing without a clock", () => {
    const sim = ridingWorld();
    sim.tick({});
    expect(sim.lastTickTimings()).toBeNull();
    sim.dispose();
  });

  it("times the Moving Segment switching and the Character loops, each on its own", () => {
    let now = 0;
    // Every read moves the fake clock one millisecond: two reads per timed stretch.
    const sim = ridingWorld(() => (now += 1));
    sim.tick({});
    const timings = sim.lastTickTimings()!;
    // Two stretches: the switch to Fixed before the sweeps, the switch back after.
    expect(timings.movingSegmentsMs).toBe(2);
    expect(timings.characterSweepsMs).toBe(1);
    expect(timings.characterUpdatesMs).toBe(1);
    for (const value of Object.values(timings)) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    }
    sim.dispose();
  });

  it("never changes what a tick computes", () => {
    const plain = ridingWorld();
    const profiled = ridingWorld(() => 0);
    const input = { me: { ...IDLE_INPUTS, moveDirection: { x: 0, y: 0, z: -1 }, jumpHeld: true } };
    for (let n = 0; n < 3 * TICK_RATE_HZ; n += 1) {
      plain.tick(input);
      profiled.tick(input);
    }
    expect(profiled.snapshot()).toEqual(plain.snapshot());
    plain.dispose();
    profiled.dispose();
  });
});
