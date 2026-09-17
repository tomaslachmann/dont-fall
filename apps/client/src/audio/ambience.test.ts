import { ENVIRONMENT_IDS, ENVIRONMENT_PRESETS, type EnvironmentPreset } from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import {
  AMBIENCE,
  AMBIENCE_FADE_SECONDS,
  Ambience,
  ambienceSlots,
  environmentIdOf,
  WIND_CALM_SHARE,
  WIND_FULL_HEIGHT,
  windSwell,
} from "./ambience.js";
import { createSoundEngine, DISPOSE_FADE_SECONDS, type LoopHandle, type PlayOptions } from "./engine.js";
import { FakeAudioContext, fakeBuffer, FakeGain } from "./fakeAudio.js";
import { SOUND_SLOTS, type SoundSlot } from "./slots.js";

const fakeEngine = () => {
  const loops: { slot: SoundSlot; options: PlayOptions; fadeSeconds: number | undefined; sets: PlayOptions[] }[] = [];
  return {
    loops,
    engine: {
      loop: (slot: SoundSlot, options: PlayOptions = {}, fadeSeconds?: number): LoopHandle => {
        const loop = { slot, options, fadeSeconds, sets: [] as PlayOptions[] };
        loops.push(loop);
        return { set: (next) => loop.sets.push(next), stop: () => {} };
      },
    },
  };
};

describe("Environment ambience (M14 ticket 09, ADR 0087)", () => {
  it("has layers for every Environment, all environment-bus loops", () => {
    for (const id of ENVIRONMENT_IDS) {
      expect(AMBIENCE[id].length, id).toBeGreaterThan(0);
      expect(AMBIENCE[id].filter((layer) => layer.wind), id).toHaveLength(1);
      for (const { slot } of AMBIENCE[id]) {
        expect(SOUND_SLOTS[slot].bus, slot).toBe("environment");
        expect(SOUND_SLOTS[slot].maxLoops, slot).toBeDefined();
      }
    }
    expect(ambienceSlots("night")).toEqual(["environment.wind_night", "environment.crickets"]);
    expect(ambienceSlots(undefined)).toEqual([]);
  });

  it("knows a preset by identity, and nothing it doesn't list", () => {
    for (const id of ENVIRONMENT_IDS) expect(environmentIdOf(ENVIRONMENT_PRESETS[id])).toBe(id);
    expect(environmentIdOf({ ...ENVIRONMENT_PRESETS.day } as EnvironmentPreset)).toBeUndefined();
  });

  it("swells the wind from calm at the cloud floor to full high above it", () => {
    expect(windSwell(-10)).toBe(WIND_CALM_SHARE);
    expect(windSwell(0)).toBe(WIND_CALM_SHARE);
    expect(windSwell(WIND_FULL_HEIGHT)).toBe(1);
    expect(windSwell(WIND_FULL_HEIGHT * 3)).toBe(1);
    let last = 0;
    for (let height = 0; height <= WIND_FULL_HEIGHT; height += 1) {
      expect(windSwell(height)).toBeGreaterThanOrEqual(last);
      last = windSwell(height);
    }
  });

  it("plays every layer unpanned with a slow fade, and moves only the wind with height", () => {
    const { engine, loops } = fakeEngine();
    const ambience = new Ambience(engine, "sunset", -5);
    expect(loops.map(({ slot }) => slot)).toEqual(["environment.wind_day", "environment.birds"]);
    expect(loops.every(({ fadeSeconds }) => fadeSeconds === AMBIENCE_FADE_SECONDS)).toBe(true);
    expect(loops.every(({ options }) => options.at === undefined)).toBe(true);

    ambience.update(-5 + WIND_FULL_HEIGHT);
    expect(loops[0]!.sets.at(-1)).toEqual({ gain: AMBIENCE.sunset[0]!.gain });
    expect(loops[1]!.sets).toEqual([]);
  });

  it("is silent for an Environment it doesn't know", () => {
    const { engine, loops } = fakeEngine();
    new Ambience(engine, undefined, 0).update(10);
    expect(loops).toEqual([]);
  });

  it("fades in on a real engine, keeps playing past a layer that failed to load, and fades out with the Stage", () => {
    const context = new FakeAudioContext();
    const released: (() => void)[] = [];
    const engine = createSoundEngine({
      context: context as unknown as AudioContext,
      destination: new FakeGain() as unknown as AudioNode,
      bank: { buffers: (slot) => (slot === "environment.birds" ? [] : [fakeBuffer(30)]) },
      listenerPosition: () => ({ x: 0, y: 0, z: 0 }),
      defer: (release) => released.push(release),
    });
    const ambience = new Ambience(engine, "day", 0);
    ambience.update(20);
    engine.update();
    expect(context.sources).toHaveLength(1);
    const wind = context.gains.at(-1)!;
    expect(wind.gain.targets.at(-1)).toBeCloseTo(SOUND_SLOTS["environment.wind_day"].gain * AMBIENCE.day[0]!.gain * windSwell(20));
    expect(wind.gain.timeConstants.at(-1)).toBe(AMBIENCE_FADE_SECONDS);

    engine.dispose();
    expect(context.gains[0]!.gain.targets.at(-1)).toBe(0);
    expect(context.sources[0]!.stoppedAt).toBe(DISPOSE_FADE_SECONDS);
    expect(released).toHaveLength(1);
  });
});
