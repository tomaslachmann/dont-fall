import {
  CONVEYOR_SPEEDS,
  eulerQuat,
  IDENTITY_QUAT,
  TICK_DT,
  type ConveyorBelt,
  type MovingSegmentConfig,
  type Vec3,
  type VolumeConfig,
} from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import type { LoopHandle, PlayOptions } from "./engine.js";
import {
  AIR_GAIN_FLOOR,
  airLevel,
  BELT_RATE_FROM,
  BELT_RATE_TO,
  beltDeckAt,
  beltRate,
  FAN_LOUD_FORCE,
  MachineSounds,
  machineSoundSlots,
  nearestPointInColumn,
  nearestPointOnDeck,
} from "./machineSounds.js";
import type { SoundSlot } from "./slots.js";

const fakeEngine = () => {
  const loops: { slot: SoundSlot; options: PlayOptions; sets: PlayOptions[]; stopped: boolean }[] = [];
  return {
    loops,
    engine: {
      loop: (slot: SoundSlot, options: PlayOptions = {}): LoopHandle => {
        const loop = { slot, options, sets: [] as PlayOptions[], stopped: false };
        loops.push(loop);
        return { set: (next) => loop.sets.push(next), stop: () => (loop.stopped = true) };
      },
    },
  };
};

const expectPoint = (actual: Vec3, expected: Vec3): void => {
  expect(actual.x).toBeCloseTo(expected.x, 6);
  expect(actual.y).toBeCloseTo(expected.y, 6);
  expect(actual.z).toBeCloseTo(expected.z, 6);
};

/** A fan: a 2 × 6 × 2 updraft standing on the ground at `x`. */
const fan = (x: number, forceY = FAN_LOUD_FORCE): VolumeConfig => ({
  bounds: { center: { x, y: 3, z: 0 }, halfExtents: { x: 1, y: 3, z: 1 } },
  force: { x: 0, y: forceY, z: 0 },
  maxInducedSpeed: 8,
  priority: 0,
});

const belt = (over: Partial<ConveyorBelt> = {}): ConveyorBelt => ({
  segmentIndex: 4,
  velocity: { x: CONVEYOR_SPEEDS.medium, y: 0, z: 0 },
  deck: { center: { x: 0, y: 1, z: -10 }, yaw: 0, orientation: IDENTITY_QUAT, halfX: 3, halfZ: 1 },
  ...over,
});

describe("machine sounds (M14 ticket 08, ADR 0087)", () => {
  describe("the nearest point", () => {
    it("on a belt is the listener clamped to the deck, in the deck's own plane", () => {
      const deck = belt().deck;
      expectPoint(nearestPointOnDeck({ x: 1, y: 5, z: -10.5 }, deck), { x: 1, y: 1, z: -10.5 });
      expectPoint(nearestPointOnDeck({ x: 20, y: 0, z: 0 }, deck), { x: 3, y: 1, z: -9 });
      // A deck turned a quarter: its long side now runs along z.
      const turned = { ...deck, orientation: eulerQuat(Math.PI / 2, 0, 0) };
      const far = nearestPointOnDeck({ x: 0, y: 1, z: 20 }, turned);
      expect(Math.abs(far.z - -10)).toBeCloseTo(3, 6);
      expect(far.x).toBeCloseTo(0, 6);
    });

    it("in a column is inside its cylinder, along its flow", () => {
      const column = { entry: { x: 0, y: 0, z: 0 }, axis: { x: 0, y: 1, z: 0 }, length: 6, halfWidth: 1 };
      expectPoint(nearestPointInColumn({ x: 0.5, y: 2, z: 0 }, column), { x: 0.5, y: 2, z: 0 });
      expectPoint(nearestPointInColumn({ x: 10, y: 20, z: 0 }, column), { x: 1, y: 6, z: 0 });
      expectPoint(nearestPointInColumn({ x: 0, y: -5, z: -4 }, column), { x: 0, y: 0, z: -1 });
    });

    it("follows a belt a Moving Segment carries", () => {
      const carrier: MovingSegmentConfig = {
        segmentIndex: 4,
        moduleId: "platform",
        position: { x: 0, y: 1, z: -10 },
        orientation: IDENTITY_QUAT,
        scale: 1,
        motion: { slide: { offset: { x: 5, y: 0, z: 0 }, period: 2, easing: "linear" } },
        boxes: [],
        trimeshes: [],
        solids: [],
      };
      const deck = belt().deck;
      expectPoint(beltDeckAt(deck, carrier, 0).center, deck.center);
      // Half a leg out: 2.5 along x.
      expectPoint(beltDeckAt(deck, carrier, 0.5 / TICK_DT).center, { x: 2.5, y: 1, z: -10 });
      expect(beltDeckAt(deck, undefined, 99)).toBe(deck);
    });
  });

  it("is louder for a stronger updraft, and a belt rattles faster for a faster belt", () => {
    expect(airLevel({ x: 0, y: FAN_LOUD_FORCE, z: 0 })).toBe(1);
    expect(airLevel({ x: 0, y: FAN_LOUD_FORCE * 3, z: 0 })).toBe(1);
    expect(airLevel({ x: 0, y: 1, z: 0 })).toBe(AIR_GAIN_FLOOR);
    expect(beltRate(0)).toBe(BELT_RATE_FROM);
    expect(beltRate(CONVEYOR_SPEEDS.fast)).toBe(BELT_RATE_TO);
    expect(beltRate(CONVEYOR_SPEEDS.slow)).toBeLessThan(beltRate(CONVEYOR_SPEEDS.medium));
  });

  it("hums at each fan, rushes in each column, and rattles each belt where the listener is nearest", () => {
    const { engine, loops } = fakeEngine();
    const sideways: VolumeConfig = { ...fan(20), force: { x: 30, y: 0, z: 0 } };
    const sounds = new MachineSounds(engine, { volumes: [fan(0, 30), sideways], conveyors: [belt()], movingSegments: [] });
    expect(loops.map(({ slot }) => slot)).toEqual(["segment.fan", "segment.air_rush", "segment.air_rush", "segment.belt"]);
    // The fan sits at the column's entry, the floor.
    expect(loops[0]!.options).toEqual({ at: { x: 0, y: 0, z: 0 }, gain: airLevel({ x: 0, y: 30, z: 0 }) });
    expect(loops[3]!.options.rate).toBe(beltRate(CONVEYOR_SPEEDS.medium));

    sounds.update(0, { x: 0, y: 4, z: 5 });
    expectPoint(loops[1]!.sets.at(-1)!.at!, { x: 0, y: 4, z: 1 });
    expectPoint(loops[3]!.sets.at(-1)!.at!, { x: 0, y: 1, z: -9 });

    sounds.dispose();
    expect(loops.every((loop) => loop.stopped)).toBe(true);
  });

  it("decodes only what a Track has", () => {
    expect(machineSoundSlots({})).toEqual([]);
    expect(machineSoundSlots({ volumes: [fan(0)], conveyors: [{}], launchPads: [{}] })).toEqual([
      "segment.fan",
      "segment.air_rush",
      "segment.belt",
      "segment.spring_settle",
    ]);
    // A wind too weak to hold anyone up rushes, but has no fan.
    expect(machineSoundSlots({ volumes: [fan(0, 5)] })).toEqual(["segment.air_rush"]);
  });
});
