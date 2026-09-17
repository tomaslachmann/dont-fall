import {
  ASSET_PLACEMENT_MODULES,
  BASE_RACE_TRACK,
  IDENTITY_QUAT,
  TICK_DT,
  type SegmentMotion,
  type Vec3,
} from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import type { LoopHandle, PlayOptions } from "./engine.js";
import { legSeconds, slidePeakSpeed } from "./segmentMotion.js";
import {
  MAX_HEARD_STEP_SECONDS,
  MOTION_GAIN_FLOOR,
  MOTION_SOUNDS,
  SEGMENT_SOUND_OVERRIDES,
  SegmentSounds,
  segmentSoundSlots,
  SPIN_PASS_MIN_TIP_SPEED,
  type SoundedSegment,
} from "./segmentSounds.js";
import { SOUND_SLOTS, type SoundSlot } from "./slots.js";
import { stageSoundSlots } from "./stageSounds.js";

const fakeEngine = () => {
  const played: { slot: SoundSlot; options: PlayOptions }[] = [];
  const loops: { slot: SoundSlot; sets: PlayOptions[]; stopped: boolean }[] = [];
  return {
    played,
    loops,
    engine: {
      play: (slot: SoundSlot, options: PlayOptions = {}) => {
        played.push({ slot, options });
        return true;
      },
      loop: (slot: SoundSlot, options: PlayOptions = {}): LoopHandle => {
        const loop = { slot, sets: [options], stopped: false };
        loops.push(loop);
        return { set: (next) => loop.sets.push(next), stop: () => (loop.stopped = true) };
      },
    },
  };
};

/** A box's corners, centred on `centre` with half extents `half`. */
const box = (centre: Vec3, half: Vec3): Vec3[] =>
  [0, 1, 2, 3, 4, 5, 6, 7].map((c) => ({
    x: centre.x + (c & 1 ? half.x : -half.x),
    y: centre.y + (c & 2 ? half.y : -half.y),
    z: centre.z + (c & 4 ? half.z : -half.z),
  }));

const segment = (moduleId: string, motion: SegmentMotion, corners: Vec3[], position: Vec3 = { x: 0, y: 0, z: 0 }): SoundedSegment => ({
  config: { moduleId, position, orientation: IDENTITY_QUAT, scale: 1, motion },
  corners,
});

/** Runs `sounds` from `fromSeconds` to `toSeconds` a 60 Hz frame at a time. */
const run = (sounds: SegmentSounds, fromSeconds: number, toSeconds: number, listener: Vec3): void => {
  for (let t = fromSeconds; t <= toSeconds; t += 1 / 60) sounds.update(t / TICK_DT, listener);
};

const HAMMER: SegmentMotion = {
  swing: { axis: { x: 1, y: 0, z: 0 }, pivot: { x: 0, y: 6, z: 0 }, amplitude: 1, period: 2, easing: "easeInOut" },
};

describe("Moving Segment sounds (M14 ticket 07, ADR 0087)", () => {
  describe("the sound table", () => {
    it("names only known slots, for Modules that can be placed", () => {
      for (const [moduleId, sounds] of Object.entries(SEGMENT_SOUND_OVERRIDES)) {
        expect(ASSET_PLACEMENT_MODULES[moduleId], moduleId).toBeDefined();
        for (const slot of Object.values(sounds)) if (typeof slot === "string") expect(SOUND_SLOTS[slot as SoundSlot], slot).toBeDefined();
      }
      for (const slot of Object.values(MOTION_SOUNDS)) expect(SOUND_SLOTS[slot as SoundSlot]).toBeDefined();
    });

    it("decodes only the sounds of what a Track moves, overrides included", () => {
      expect(segmentSoundSlots([], [])).toEqual([]);
      expect(segmentSoundSlots([{ moduleId: "trap_hammerbig", motion: HAMMER }], []).sort()).toEqual(["segment.swing_heavy"]);
      expect(
        segmentSoundSlots([{ moduleId: "any", motion: { slide: { offset: { x: 1, y: 0, z: 0 }, period: 2, easing: "linear" } } }], [{}]).sort(),
      ).toEqual(["segment.slide_rumble", "segment.slide_stop", "segment.spin_pass"]);
    });

    it("covers everything the base race moves", () => {
      const movingSegments = BASE_RACE_TRACK.flatMap((s) => (s.motion ? [{ moduleId: s.moduleId, motion: s.motion }] : []));
      const slots = stageSoundSlots({ movingSegments, spinners: [], volumes: [], conveyors: [], launchPads: [] });
      expect(slots).toEqual(expect.arrayContaining(["segment.swing_heavy", "segment.spin_pass", "segment.slide_stop", "segment.slide_rumble"]));
      expect(new Set(slots).size).toBe(slots.length);
    });
  });

  describe("a swing", () => {
    it("wooshes once per pass of its fastest point, at the head, heavy for a big hammer", () => {
      const { engine, played } = fakeEngine();
      const hammer = segment("trap_hammerbig", HAMMER, box({ x: 0, y: 1, z: 0 }, { x: 1, y: 1, z: 1 }), { x: 10, y: 0, z: 0 });
      const sounds = new SegmentSounds(engine, [hammer]);
      run(sounds, 0.1, 0.1 + 2 * HAMMER.swing!.period, { x: 10, y: 1, z: 5 });
      expect(played).toHaveLength(4);
      expect(played.every(({ slot }) => slot === "segment.swing_heavy")).toBe(true);
      // At the bottom of the arc the head hangs straight under the pivot.
      const at = played[0]!.options.at!;
      expect(at.x).toBeCloseTo(10, 6);
      expect(at.y).toBeCloseTo(1, 1);
      expect(played[0]!.options.gain).toBeGreaterThanOrEqual(MOTION_GAIN_FLOOR);
    });

    it("is quieter the slower its tip moves", () => {
      const heard = (period: number): number => {
        const { engine, played } = fakeEngine();
        const motion: SegmentMotion = { swing: { ...HAMMER.swing!, period, amplitude: 0.5 } };
        run(new SegmentSounds(engine, [segment("pendulum", motion, box({ x: 0, y: 3, z: 0 }, { x: 0.5, y: 0.5, z: 0.5 }))]), 0, period, {
          x: 0,
          y: 0,
          z: 0,
        });
        return played[0]!.options.gain!;
      };
      expect(heard(6)).toBeLessThan(heard(1.5));
    });

    it("makes no sound for a frame that jumps the clock, or runs it backwards", () => {
      const { engine, played } = fakeEngine();
      const sounds = new SegmentSounds(engine, [segment("pendulum", HAMMER, box({ x: 0, y: 1, z: 0 }, { x: 1, y: 1, z: 1 }))]);
      sounds.update(0, { x: 0, y: 0, z: 0 });
      sounds.update((MAX_HEARD_STEP_SECONDS + 5) / TICK_DT, { x: 0, y: 0, z: 0 });
      sounds.update(0.1 / TICK_DT, { x: 0, y: 0, z: 0 });
      expect(played).toEqual([]);
    });
  });

  describe("a slide", () => {
    const SLIDE: SegmentMotion = { slide: { offset: { x: 6, y: 0, z: 0 }, period: 4, easing: "easeInOut", pause: 0.5 } };

    it("clunks at each end, and rumbles as fast as it moves", () => {
      const { engine, played, loops } = fakeEngine();
      const sounds = new SegmentSounds(engine, [segment("platform", SLIDE, box({ x: 0, y: 0, z: 0 }, { x: 2, y: 0.5, z: 2 }))]);
      expect(loops).toEqual([expect.objectContaining({ slot: "segment.slide_rumble" })]);
      run(sounds, 0.05, 0.05 + SLIDE.slide!.period, { x: 0, y: 0, z: 0 });
      expect(played.map(({ slot }) => slot)).toEqual(["segment.slide_stop", "segment.slide_stop"]);
      // The far end: the clunk is where the platform arrived.
      expect(played[0]!.options.at!.x).toBeCloseTo(6, 1);

      const gains = loops[0]!.sets.slice(1).map((set) => set.gain!);
      expect(Math.max(...gains)).toBeGreaterThan(0.95);
      expect(Math.min(...gains)).toBe(0);
      expect(slidePeakSpeed(SLIDE.slide!, 1)).toBeGreaterThan(0);

      // Mid-leg the rumble follows the platform.
      sounds.update(legSeconds(SLIDE.slide!) / 2 / TICK_DT, { x: 0, y: 0, z: 0 });
      const last = loops[0]!.sets.at(-1)!;
      expect(last.at!.x).toBeCloseTo(3, 1);
      expect(last.gain).toBeCloseTo(1, 2);
    });

    it("lets its rumble go on dispose", () => {
      const { engine, loops } = fakeEngine();
      new SegmentSounds(engine, [segment("platform", SLIDE, box({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }))]).dispose();
      expect(loops[0]!.stopped).toBe(true);
    });
  });

  describe("a spin", () => {
    const SPIN = (speed: number): SegmentMotion => ({ spin: { axis: { x: 0, y: 1, z: 0 }, pivot: { x: 0, y: 0, z: 0 }, speed } });
    const BAR = box({ x: 0, y: 0.5, z: 0 }, { x: 4, y: 0.5, z: 0.3 });

    it("wooshes as each tip of a bar sweeps past the listener, where it passes closest", () => {
      const { engine, played } = fakeEngine();
      const sounds = new SegmentSounds(engine, [segment("bar", SPIN(3), BAR, { x: 5, y: 0, z: 0 })]);
      const listener = { x: 5, y: 1, z: 10 };
      run(sounds, 0.01, 0.01 + (2 * Math.PI) / 3, listener);
      expect(played.map(({ slot }) => slot)).toEqual(["segment.spin_pass", "segment.spin_pass"]);
      for (const { options } of played) {
        // The tip circle's point nearest the listener: straight toward it, the bar's reach out.
        expect(options.at!.x).toBeCloseTo(5, 6);
        expect(options.at!.z).toBeCloseTo(Math.hypot(4, 0.3), 6);
      }
    });

    it("sweeps a square past four times a turn", () => {
      const { engine, played } = fakeEngine();
      const square = box({ x: 0, y: 0.5, z: 0 }, { x: 3, y: 0.5, z: 3 });
      run(new SegmentSounds(engine, [segment("disc", SPIN(3), square)]), 0.01, 0.01 + (2 * Math.PI) / 3, { x: 0, y: 1, z: 10 });
      expect(played).toHaveLength(4);
    });

    it("is silent for a slow turntable", () => {
      const { engine, played } = fakeEngine();
      const slow = (SPIN_PASS_MIN_TIP_SPEED / 4) * 0.9;
      run(new SegmentSounds(engine, [segment("bar", SPIN(slow), BAR)]), 0, (2 * Math.PI) / slow, { x: 0, y: 1, z: 10 });
      expect(played).toEqual([]);
    });

    it("hears the M1 Spinner by the same rule", () => {
      const { engine, played } = fakeEngine();
      const spinner = { center: { x: 0, y: 1, z: -20 }, armLength: 4, halfHeight: 0.3, armRadius: 0.3, angularSpeed: -2 };
      run(new SegmentSounds(engine, [], [spinner]), 0.01, 0.01 + Math.PI, { x: 0, y: 1, z: -10 });
      expect(played).toHaveLength(2);
      expect(played[0]!.options.at).toEqual({ x: 0, y: 1, z: -16 });
    });
  });
});
