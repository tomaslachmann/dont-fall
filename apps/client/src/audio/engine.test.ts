import type { Vec3 } from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import {
  createSoundEngine,
  DISPOSE_FADE_SECONDS,
  linearDistanceGain,
  LOOP_FADE_SECONDS,
  MAX_ONESHOT_VOICES,
  MIN_AUDIBLE_GAIN,
  type SoundEngine,
} from "./engine.js";
import { FakeAudioContext, fakeBuffer, FakeGain, type FakeBufferSource } from "./fakeAudio.js";
import { SOUND_SLOTS, type SoundSlot } from "./slots.js";
import type { SoundBank } from "./soundBank.js";

const decoded = new Map<SoundSlot, AudioBuffer[]>();
const fullBank: SoundBank = {
  buffers: (slot) => {
    if (!decoded.has(slot)) decoded.set(slot, SOUND_SLOTS[slot].files.map(() => fakeBuffer(2)));
    return decoded.get(slot)!;
  },
};

const setup = (options: { bank?: SoundBank; listener?: Vec3; random?: () => number; onReleased?: () => void } = {}) => {
  const context = new FakeAudioContext();
  const destination = new FakeGain();
  let listener = options.listener ?? { x: 0, y: 0, z: 0 };
  const deferred: { release: () => void; ms: number }[] = [];
  const engine: SoundEngine = createSoundEngine({
    context: context as unknown as AudioContext,
    destination: destination as unknown as AudioNode,
    bank: options.bank ?? fullBank,
    listenerPosition: () => listener,
    random: options.random ?? (() => 0.5),
    defer: (release, ms) => deferred.push({ release, ms }),
    ...(options.onReleased ? { onReleased: options.onReleased } : {}),
  });
  return { context, destination, engine, deferred, moveListener: (to: Vec3) => (listener = to) };
};

const oneShots = (context: FakeAudioContext): FakeBufferSource[] => context.sources.filter((source) => !source.loop);

describe("linearDistanceGain", () => {
  it("is full inside the reference distance, silent from the max, linear between", () => {
    expect(linearDistanceGain(1, 3, 23)).toBe(1);
    expect(linearDistanceGain(13, 3, 23)).toBeCloseTo(0.5);
    expect(linearDistanceGain(23, 3, 23)).toBe(0);
    expect(linearDistanceGain(99, 3, 23)).toBe(0);
  });
});

describe("the sound engine (M14 ticket 02, ADR 0087)", () => {
  it("routes buses through a master gain into the listener", () => {
    const { context, destination } = setup();
    const master = context.gains[0]!;
    expect(master.connections).toEqual([destination]);
    expect(context.gains.slice(1, 5).every((bus) => bus.connections[0] === master)).toBe(true);
  });

  it("plays your own Character's sound unpanned, straight onto its bus", () => {
    const { context, engine } = setup();
    expect(engine.play("character.land")).toBe(true);
    expect(context.panners).toHaveLength(0);
    const source = oneShots(context)[0]!;
    expect(source.started).not.toBeNull();
    const effectsBus = context.gains[1]!;
    expect((source.connections[0] as FakeGain).connections[0]).toBe(effectsBus);
  });

  it("pans a positioned sound with equal-power and a linear distance model, never HRTF", () => {
    const { context, engine } = setup();
    engine.play("character.land", { at: { x: 4, y: 0, z: 0 } });
    const panner = context.panners[0]!;
    expect(panner.panningModel).toBe("equalpower");
    expect(panner.distanceModel).toBe("linear");
    expect(panner.refDistance).toBe(SOUND_SLOTS["character.land"].refDistance);
    expect(panner.maxDistance).toBe(SOUND_SLOTS["character.land"].maxDistance);
    expect([panner.positionX.value, panner.positionY.value, panner.positionZ.value]).toEqual([4, 0, 0]);
  });

  it("never creates a voice too far away to hear, and counts it dropped", () => {
    const { context, engine } = setup();
    const beyond = SOUND_SLOTS["character.land"].maxDistance + 1;
    expect(engine.play("character.land", { at: { x: beyond, y: 0, z: 0 } })).toBe(false);
    expect(context.sources).toHaveLength(0);
    expect(engine.stats()).toMatchObject({ dropped: 1, inaudible: 1, overCap: 0 });
  });

  it("never creates a voice on a muted bus", () => {
    const { context, engine } = setup();
    engine.setVolume("effects", MIN_AUDIBLE_GAIN / 2);
    expect(engine.play("character.land")).toBe(false);
    expect(context.sources).toHaveLength(0);
  });

  it("plays nothing, and queues nothing, until the context runs", () => {
    const { context, engine } = setup();
    context.state = "suspended";
    expect(engine.play("character.land")).toBe(false);
    context.state = "running";
    expect(context.sources).toHaveLength(0);
  });

  it("stays silent for a slot that failed to load", () => {
    const { context, engine } = setup({ bank: { buffers: () => [] } });
    expect(engine.play("character.land")).toBe(false);
    expect(context.sources).toHaveLength(0);
  });

  it("picks a variant and jitters the pitch within the slot's bounds", () => {
    const rolls = [0.99, 0.0];
    const { context, engine } = setup({ random: () => rolls.shift() ?? 0.5 });
    engine.play("character.footstep");
    const { pitchJitter, files } = SOUND_SLOTS["character.footstep"];
    const source = context.sources[0]!;
    expect(source.buffer).toBe(fullBank.buffers("character.footstep")[files.length - 1]);
    expect(source.playbackRate.value).toBeCloseTo(1 - pitchJitter);
  });

  it("caps one-shots: a louder or more important sound evicts the least important, a lesser one is dropped", () => {
    const { context, engine } = setup();
    for (let i = 0; i < MAX_ONESHOT_VOICES; i += 1) engine.play("character.footstep", { at: { x: 10, y: 0, z: 0 } });
    expect(engine.stats().voices).toBe(MAX_ONESHOT_VOICES);

    // A footstep no louder than the rest: dropped.
    expect(engine.play("character.footstep", { at: { x: 10, y: 0, z: 0 } })).toBe(false);
    expect(engine.stats().voices).toBe(MAX_ONESHOT_VOICES);
    expect(engine.stats()).toMatchObject({ inaudible: 0, overCap: 1 });

    // A knockdown outranks every footstep: one footstep is stopped for it.
    expect(engine.play("character.knockdown")).toBe(true);
    expect(engine.stats().voices).toBe(MAX_ONESHOT_VOICES);
    expect(oneShots(context).filter((source) => source.stoppedAt !== null)).toHaveLength(1);
  });

  it("lets a play outrank its slot's own priority (M14 ticket 06)", () => {
    const { context, engine } = setup();
    for (let i = 0; i < MAX_ONESHOT_VOICES; i += 1) engine.play("character.knockdown", { at: { x: 10, y: 0, z: 0 } });
    // A plain hit sound ranks below a knockdown…
    expect(engine.play("character.hit_land", { at: { x: 10, y: 0, z: 0 } })).toBe(false);
    // …unless it is your own.
    expect(engine.play("character.hit_land", { priority: SOUND_SLOTS["character.knockdown"].priority + 1 })).toBe(true);
    const own = context.sources.at(-1)!;
    // And the voice keeps that priority: no knockdown evicts it.
    for (let i = 0; i < MAX_ONESHOT_VOICES * 2; i += 1) engine.play("character.knockdown");
    expect(engine.stats().voices).toBe(MAX_ONESHOT_VOICES);
    expect(own.stoppedAt).toBeNull();
  });

  it("releases a voice when it ends", () => {
    const { context, engine } = setup();
    engine.play("character.land", { at: { x: 1, y: 0, z: 0 } });
    context.sources[0]!.end();
    expect(engine.stats().voices).toBe(0);
    expect(context.sources[0]!.disconnected).toBe(true);
    expect(context.panners[0]!.disconnected).toBe(true);
  });

  describe("started one-shots (M14 ticket 05)", () => {
    it("follow a new level, rate and place, keeping the jitter they started with", () => {
      const rolls = [0, 1];
      const { context, engine } = setup({ random: () => rolls.shift() ?? 0.5 });
      const woosh = engine.start("character.dash", { at: { x: 1, y: 0, z: 0 }, gain: 0.4, rate: 0.9 })!;
      const { gain: slotGain, pitchJitter } = SOUND_SLOTS["character.dash"];
      const source = context.sources[0]!;
      const gain = source.connections[0] as FakeGain;
      expect(gain.gain.value).toBeCloseTo(slotGain * 0.4);
      expect(source.playbackRate.value).toBeCloseTo(0.9 * (1 + pitchJitter));

      woosh.set({ gain: 1, rate: 1.2, at: { x: 2, y: 0, z: 0 } });
      expect(gain.gain.targets.at(-1)).toBeCloseTo(slotGain);
      expect(source.playbackRate.targets.at(-1)).toBeCloseTo(1.2 * (1 + pitchJitter));
      expect(context.panners[0]!.positionX.value).toBe(2);
    });

    it("count against the budget like any one-shot, and come back null when it creates nothing", () => {
      const { engine } = setup();
      expect(engine.start("character.dash", { at: { x: 999, y: 0, z: 0 } })).toBeNull();
      engine.start("character.dash");
      expect(engine.stats().voices).toBe(1);
    });

    it("fade out on stop, and ignore anything once ended", () => {
      const { context, engine } = setup();
      const woosh = engine.start("character.dash")!;
      const source = context.sources[0]!;
      const gain = source.connections[0] as FakeGain;
      woosh.stop();
      expect(gain.gain.targets.at(-1)).toBe(0);
      expect(source.stoppedAt).not.toBeNull();
      woosh.set({ gain: 1 });
      expect(gain.gain.targets.at(-1)).toBe(0);

      source.end();
      expect(engine.stats().voices).toBe(0);
      woosh.set({ gain: 1 });
      woosh.stop();
      expect(gain.gain.targets).toEqual([0]);
    });
  });

  describe("loops", () => {
    const fanAt = (x: number): Vec3 => ({ x, y: 0, z: 0 });

    it("sound only for the nearest maxLoops emitters of a slot, re-chosen as the listener moves", () => {
      const { context, engine, moveListener } = setup();
      const maxLoops = SOUND_SLOTS["segment.fan"].maxLoops!;
      expect(maxLoops).toBe(2);
      engine.loop("segment.fan", { at: fanAt(1) });
      engine.loop("segment.fan", { at: fanAt(2) });
      engine.loop("segment.fan", { at: fanAt(-20) });
      engine.update();
      expect(engine.stats().loopsPlaying).toBe(2);
      const firstTwo = context.sources.slice(0, 2);
      expect(firstTwo.every((source) => source.loop && source.started)).toBe(true);

      moveListener(fanAt(-20));
      engine.update();
      expect(engine.stats().loopsPlaying).toBe(2);
      // The farther of the first two faded out; the one at −20 started.
      expect(context.sources.filter((source) => source.stoppedAt !== null)).toHaveLength(1);
      expect(context.sources).toHaveLength(3);
    });

    it("fade in from silence, follow gain and rate, and fade out on stop", () => {
      const { context, engine } = setup();
      const fan = engine.loop("segment.fan", { at: fanAt(1) });
      engine.update();
      const gain = context.gains.at(-1)!;
      expect(gain.gain.targets.at(-1)).toBe(SOUND_SLOTS["segment.fan"].gain);

      fan.set({ gain: 0.5, rate: 1.2 });
      engine.update();
      expect(gain.gain.targets.at(-1)).toBeCloseTo(SOUND_SLOTS["segment.fan"].gain * 0.5);
      expect(context.sources[0]!.playbackRate.value).toBeCloseTo(1.2);

      fan.stop();
      expect(gain.gain.targets.at(-1)).toBe(0);
      expect(context.sources[0]!.stoppedAt).not.toBeNull();
      engine.update();
      expect(engine.stats().loopsPlaying).toBe(0);
    });

    it("fade as slowly as they were asked to (M14 ticket 09)", () => {
      const { context, engine } = setup();
      const slow = LOOP_FADE_SECONDS * 10;
      const wind = engine.loop("environment.wind_day", {}, slow);
      engine.update();
      const gain = context.gains.at(-1)!;
      engine.update();
      wind.stop();
      expect(gain.gain.timeConstants).toEqual([slow, slow, slow]);
      expect(context.sources[0]!.stoppedAt).toBeCloseTo(slow * 5);
    });

    it("stay silent past their max distance", () => {
      const { context, engine } = setup();
      engine.loop("segment.fan", { at: fanAt(SOUND_SLOTS["segment.fan"].maxDistance + 5) });
      engine.update();
      expect(context.sources).toHaveLength(0);
    });
  });

  it("fades everything out on dispose, then stops it and releases the graph, playing nothing meanwhile", () => {
    let released = 0;
    const { context, engine, deferred } = setup({ onReleased: () => (released += 1) });
    context.currentTime = 10;
    engine.play("character.land");
    engine.loop("segment.fan", { at: { x: 1, y: 0, z: 0 } });
    engine.update();
    engine.dispose();
    const master = context.gains[0]!;
    expect(master.gain.targets.at(-1)).toBe(0);
    expect(context.sources.every((source) => source.stoppedAt === 10 + DISPOSE_FADE_SECONDS)).toBe(true);
    expect(context.gains.slice(0, 5).some((bus) => bus.disconnected)).toBe(false);
    expect(engine.play("character.land")).toBe(false);

    expect(deferred).toHaveLength(1);
    expect(deferred[0]!.ms).toBeGreaterThanOrEqual(DISPOSE_FADE_SECONDS * 1000);
    deferred[0]!.release();
    expect(context.gains.slice(0, 5).every((bus) => bus.disconnected)).toBe(true);
    expect(context.sources.every((source) => source.disconnected)).toBe(true);
    expect(released).toBe(1);
    engine.dispose();
    expect(deferred).toHaveLength(1);
  });

  it("sets bus and master gains", () => {
    const { context, engine } = setup();
    engine.setVolume("master", 0.5);
    engine.setVolume("music", 0.25);
    expect(context.gains[0]!.gain.value).toBe(0.5);
    expect(context.gains[3]!.gain.value).toBe(0.25);
  });
});

// Every slot the table names is a real, credited file.
describe("SOUND_SLOTS", () => {
  it("names only slots whose loops declare maxLoops, and one-shots that don't", () => {
    for (const [slot, config] of Object.entries(SOUND_SLOTS) as [SoundSlot, (typeof SOUND_SLOTS)[SoundSlot]][]) {
      const isLoop = config.files.some((file) => file.endsWith("_loop.ogg"));
      expect(isLoop, slot).toBe("maxLoops" in config && config.maxLoops !== undefined);
    }
  });
});
