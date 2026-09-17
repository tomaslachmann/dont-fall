import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BASE_RACE_TRACK,
  DEFAULT_ENVIRONMENT_ID,
  DEFAULT_KILL_PLANE_Y,
  IDLE_INPUTS,
  RapierSimulation,
  TICK_MS,
  initPhysics,
  interpolateState,
  isDownMotionState,
  loadAssetLibrary,
  resolveTrack,
  trackSpawn,
  trackSpawnYaw,
  type MovingSegmentConfig,
  type SimInputs,
  type SimState,
  type Vec3,
} from "@dont-fall/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { scriptedInput } from "../../../../scripts/benchInputs.js";
import { BouncePresses } from "../render/bounceSheets.js";
import { toDeckFrame } from "../render/deckSeat.js";
import { springFiredBy, springTriggers } from "../render/springSquash.js";
import { Ambience } from "./ambience.js";
import { CharacterSounds } from "./characterSounds.js";
import { createSoundEngine, MAX_ONESHOT_VOICES, type PlayOptions } from "./engine.js";
import { FakeAudioContext, fakeBuffer, FakeGain, type FakeBufferSource } from "./fakeAudio.js";
import { MachineSounds } from "./machineSounds.js";
import { fallWhistleY } from "./movementCues.js";
import { SegmentSounds, type SoundedSegment } from "./segmentSounds.js";
import { OTHER_PLAYER_GAIN, SOUND_SLOTS, type SoundSlot } from "./slots.js";
import type { SoundBank } from "./soundBank.js";

/**
 * The voice budget against a full Lobby (M14 ticket 13, ADR 0087): the M13
 * benchmark's twelve bots racing the real base race from the spawn grid, the
 * crowded worst case, heard from behind the first of them. Everything a Stage
 * plays is driven the way the Stage drives it, into a fake context whose
 * one-shots last as long as the real files do.
 *
 * `DONTFALL_AUDIO_BUDGET=1` prints the run's numbers (the ticket's table).
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const soundsDir = join(root, "apps", "client", "public", "sounds");

/** An Ogg file's length (s), from its last page's granule position: Vorbis at its own rate, Opus at 48 kHz less its pre-skip. */
const oggSeconds = (bytes: Uint8Array): number => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = new TextDecoder("latin1").decode(bytes.subarray(0, 200));
  let rate = 48_000;
  let preSkip = 0;
  const opus = text.indexOf("OpusHead");
  const vorbis = text.indexOf("\x01vorbis");
  if (opus >= 0) preSkip = view.getUint16(opus + 10, true);
  else if (vorbis >= 0) rate = view.getUint32(vorbis + 12, true);
  const last = new TextDecoder("latin1").decode(bytes).lastIndexOf("OggS");
  const granule = Number(view.getBigUint64(last + 6, true));
  return (granule - preSkip) / rate;
};

const bank: SoundBank = (() => {
  const buffers = new Map<SoundSlot, AudioBuffer[]>();
  for (const [slot, config] of Object.entries(SOUND_SLOTS) as [SoundSlot, (typeof SOUND_SLOTS)[SoundSlot]][]) {
    buffers.set(
      slot,
      config.files.map((file) => fakeBuffer(oggSeconds(new Uint8Array(readFileSync(join(soundsDir, file)))))),
    );
  }
  return { buffers: (slot) => buffers.get(slot) ?? [] };
})();
const slotOf = new Map<unknown, SoundSlot>();
for (const slot of Object.keys(SOUND_SLOTS) as SoundSlot[]) for (const buffer of bank.buffers(slot)) slotOf.set(buffer, slot);

/** A Moving Segment's collision bounds as corners: what the Stage reads off its drawn group. */
const segmentCorners = (config: MovingSegmentConfig): Vec3[] => {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  const grow = (point: Vec3, reach = 0): void => {
    for (const axis of ["x", "y", "z"] as const) {
      min[axis] = Math.min(min[axis], point[axis] - reach);
      max[axis] = Math.max(max[axis], point[axis] + reach);
    }
  };
  for (const { box } of config.boxes) {
    grow(box.center, Math.max(box.halfExtents.x, box.halfExtents.y, box.halfExtents.z));
  }
  for (const mesh of config.trimeshes) for (const vertex of mesh.vertices) grow(vertex);
  for (const { shape, position } of config.solids) {
    const reach =
      shape.type === "ball"
        ? shape.radius
        : shape.type === "box"
          ? Math.max(shape.halfExtents.x, shape.halfExtents.y, shape.halfExtents.z)
          : shape.type === "hull"
            ? Math.max(...shape.points.map((p) => Math.hypot(p.x, p.y, p.z)))
            : shape.halfHeight + shape.radius;
    grow(position, reach);
  }
  if (min.x === Infinity) return [];
  return [0, 1, 2, 3, 4, 5, 6, 7].map((c) => ({ x: c & 1 ? max.x : min.x, y: c & 2 ? max.y : min.y, z: c & 4 ? max.z : min.z }));
};

interface RunNumbers {
  layout: Layout;
  seconds: number;
  peakVoices: number;
  framesAtCap: number;
  plays: number;
  inaudible: number;
  overCap: number;
  peakOverCapPerSecond: number;
  peakLoops: Partial<Record<SoundSlot, number>>;
  ownDroppedAtPriority4Plus: number;
  playsBySlot: Partial<Record<SoundSlot, number>>;
}

/**
 * `start`: everyone on the spawn grid, heard from the first bot, the crowded
 * first seconds of a Round. `spread`: one bot per Checkpoint (the M13
 * benchmark's layout), heard from each bot in turn. A bot waits on its
 * Checkpoint until the camera comes to it, then runs its section, so every
 * section's machines come within reach.
 */
type Layout = "start" | "spread";
/** How long the `spread` camera stays with one bot (ms). */
const FOLLOW_EACH_MS = 5000;
const TICKS: Record<Layout, number> = { start: 900, spread: 1800 };
const FRAMES_PER_TICK = 2;
const BOTS = 12;
/** Where the camera rides, from the Character it follows. */
const CAMERA_OFFSET = { x: 0, y: 3, z: 7 };
/** A running Character puts a foot down this often (s): Run's stride, two contacts. */
const STEP_SECONDS = 0.4;

const runFullLobby = async (layout: Layout): Promise<RunNumbers> => {
  const library = await loadAssetLibrary(
    async (url) => new Uint8Array(readFileSync(join(root, "assets", url.substring(url.lastIndexOf("/") + 1)))),
    "http://assets.test",
  );
  const track = BASE_RACE_TRACK;
  const resolved = resolveTrack(library, track);
  const sim = new RapierSimulation({ ...resolved, withDefaultCharacter: false });
  const yaw = trackSpawnYaw(track) ?? 0;
  const ids = Array.from({ length: BOTS }, (_, i) => `bot${i}`);
  const origins = new Map<string, Vec3>();
  const spots = [trackSpawn(track, 0, library), ...resolved.checkpoints.map((checkpoint) => checkpoint.respawn)];
  ids.forEach((id, i) => {
    const spot = spots[i % spots.length]!;
    const point = layout === "start" ? trackSpawn(track, i, library) : { ...spot, x: spot.x + (Math.floor(i / spots.length) - 0.5) * 1.5 };
    sim.addCharacter(id, point);
    origins.set(id, point);
  });

  const context = new FakeAudioContext();
  let listener: Vec3 = { x: 0, y: 0, z: 0 };
  const engine = createSoundEngine({
    context: context as unknown as AudioContext,
    destination: new FakeGain() as unknown as AudioNode,
    bank,
    listenerPosition: () => listener,
    defer: (release) => release(),
  });
  const numbers: RunNumbers = {
    layout,
    seconds: (TICKS[layout] * TICK_MS) / 1000,
    peakVoices: 0,
    framesAtCap: 0,
    plays: 0,
    inaudible: 0,
    overCap: 0,
    peakOverCapPerSecond: 0,
    peakLoops: {},
    ownDroppedAtPriority4Plus: 0,
    playsBySlot: {},
  };
  const play = engine.play;
  const counted = {
    ...engine,
    play: (slot: SoundSlot, options: PlayOptions = {}): boolean => {
      numbers.plays += 1;
      numbers.playsBySlot[slot] = (numbers.playsBySlot[slot] ?? 0) + 1;
      const created = play(slot, options);
      const priority = options.priority ?? SOUND_SLOTS[slot].priority;
      if (!created && options.at === undefined && priority >= 4) numbers.ownDroppedAtPriority4Plus += 1;
      return created;
    },
  };

  const springs = springTriggers(resolved.launchPads, resolved.launchPadOwners);
  const onBounce = (centre: Vec3): boolean =>
    resolved.bounceDecks.some(({ deck }) => {
      const feet = toDeckFrame(deck, { x: centre.x, y: centre.y - 0.9, z: centre.z });
      return Math.abs(feet.x) <= deck.halfX && Math.abs(feet.z) <= deck.halfZ && Math.abs(feet.y) <= 0.25;
    });
  // The Track's lowest drawn point, as the Stage takes it: its still pieces' geometry.
  const lowest = Math.min(
    ...resolved.statics.map((box) => box.center.y - box.halfExtents.y),
    ...resolved.staticTrimeshes.flatMap((mesh) => mesh.vertices.map((vertex) => vertex.y)),
  );
  const characters = new CharacterSounds(counted, {
    onBounce,
    springAt: (centre) => springFiredBy(centre, springs)?.trigger.center,
    fallY: fallWhistleY(lowest, DEFAULT_KILL_PLANE_Y),
  });
  const segments = new SegmentSounds(
    counted,
    resolved.movingSegments.map((config): SoundedSegment => ({ config, corners: segmentCorners(config) })),
    resolved.spinners,
  );
  const machines = new MachineSounds(counted, resolved);
  const ambience = new Ambience(counted, DEFAULT_ENVIRONMENT_ID, DEFAULT_KILL_PLANE_Y + 2);
  const presses = new BouncePresses();
  const nextStep = new Map<string, number>();

  const started = new Map<FakeBufferSource, number>();
  const ended = new Set<FakeBufferSource>();
  const endFinished = (): void => {
    for (const source of context.sources) {
      if (source.loop || ended.has(source) || !source.started) continue;
      if (!started.has(source)) started.set(source, context.currentTime);
      const length = (source.buffer as AudioBuffer).duration / Math.max(0.1, source.playbackRate.value);
      const stopAt = source.stoppedAt === null ? Infinity : (source.stoppedAt ?? context.currentTime);
      if (context.currentTime >= Math.min(started.get(source)! + length, stopAt)) {
        ended.add(source);
        source.end();
      }
    }
  };

  let previous: SimState = sim.snapshot();
  const overCapAt: { atMs: number; overCap: number }[] = [];
  for (let tick = 0; tick < TICKS[layout]; tick += 1) {
    const state = sim.snapshot();
    const inputs: Record<string, SimInputs> = {};
    const running = layout === "start" ? BOTS : Math.floor((tick * TICK_MS) / FOLLOW_EACH_MS) + 1;
    for (const [i, id] of ids.entries()) {
      inputs[id] = i < running ? scriptedInput(i, tick, state.characters[id]!.position, origins.get(id)!, yaw) : IDLE_INPUTS;
    }
    previous = state;
    sim.tick(inputs, "RUNNING");
    const next = sim.snapshot();

    for (let frame = 0; frame < FRAMES_PER_TICK; frame += 1) {
      const alpha = frame / FRAMES_PER_TICK;
      const nowMs = (tick + alpha) * TICK_MS;
      context.currentTime = nowMs / 1000;
      endFinished();
      const render = interpolateState(previous, next, alpha);
      const followed = layout === "start" ? ids[0]! : ids[Math.floor(nowMs / FOLLOW_EACH_MS) % BOTS]!;
      const own = render.characters[followed]!.position;
      listener = { x: own.x + CAMERA_OFFSET.x, y: own.y + CAMERA_OFFSET.y, z: own.z + CAMERA_OFFSET.z };

      // Footsteps, as the gait clips would put them down.
      for (const [id, character] of Object.entries(render.characters)) {
        const running = character.grounded && Math.hypot(character.velocity.x, character.velocity.z) > 0.5;
        if (!running || isDownMotionState(character.motionState) || character.motionState === "Sliding") {
          nextStep.delete(id);
          continue;
        }
        const due = nextStep.get(id) ?? nowMs;
        if (nowMs < due) continue;
        nextStep.set(id, due + STEP_SECONDS * 1000);
        counted.play("character.footstep", id === followed ? { gain: 0.8 } : { at: character.position, gain: 0.8 * OTHER_PLAYER_GAIN });
      }
      presses.update(render.characters, nowMs);
      characters.update(render.characters, followed, nowMs, presses.landings());
      const t = tick - 1 + alpha;
      segments.update(t, listener);
      machines.update(t, listener);
      ambience.update(listener.y);
      engine.update();

      const { voices, inaudible, overCap } = engine.stats();
      expect(voices).toBeLessThanOrEqual(MAX_ONESHOT_VOICES);
      numbers.peakVoices = Math.max(numbers.peakVoices, voices);
      if (voices === MAX_ONESHOT_VOICES) numbers.framesAtCap += 1;
      numbers.inaudible = inaudible;
      numbers.overCap = overCap;
      overCapAt.push({ atMs: nowMs, overCap });
      while (nowMs - overCapAt[0]!.atMs > 1000) overCapAt.shift();
      numbers.peakOverCapPerSecond = Math.max(numbers.peakOverCapPerSecond, overCap - overCapAt[0]!.overCap);

      const loops = new Map<SoundSlot, number>();
      for (const source of context.sources) {
        if (!source.loop || source.stoppedAt !== null) continue;
        const slot = slotOf.get(source.buffer)!;
        loops.set(slot, (loops.get(slot) ?? 0) + 1);
      }
      for (const [slot, playing] of loops) {
        expect(playing, slot).toBeLessThanOrEqual(SOUND_SLOTS[slot].maxLoops ?? Infinity);
        numbers.peakLoops[slot] = Math.max(numbers.peakLoops[slot] ?? 0, playing);
      }
    }
  }
  sim.dispose();
  return numbers;
};

describe("the voice budget with a full Lobby (M14 ticket 13, ADR 0087)", () => {
  beforeAll(async () => {
    await initPhysics();
  });

  const report = (numbers: RunNumbers): void => {
    if (process.env.DONTFALL_AUDIO_BUDGET === "1") console.info(JSON.stringify(numbers, null, 2));
  };

  it("holds the one-shot cap on the spawn grid, and never turns away your own important sounds", async () => {
    const numbers = await runFullLobby("start");
    report(numbers);
    expect(numbers.peakVoices).toBeLessThanOrEqual(MAX_ONESHOT_VOICES);
    expect(numbers.ownDroppedAtPriority4Plus).toBe(0);
    // The ambience never gives way.
    expect(numbers.peakLoops["environment.wind_day"]).toBe(1);
    expect(numbers.peakLoops["environment.birds"]).toBe(1);
    // A real crowd was heard.
    expect(numbers.playsBySlot["character.footstep"] ?? 0).toBeGreaterThan(100);
    expect(numbers.playsBySlot["character.jump"] ?? 0).toBeGreaterThan(10);
    // Only your own fall whistles, and not on every jump's way down.
    expect(numbers.playsBySlot["character.fall"] ?? 0).toBeLessThan(10);
  }, 120_000);

  it("holds each machine's nearest k across the whole course", async () => {
    const numbers = await runFullLobby("spread");
    report(numbers);
    expect(numbers.peakVoices).toBeLessThanOrEqual(MAX_ONESHOT_VOICES);
    expect(numbers.ownDroppedAtPriority4Plus).toBe(0);
    // The course's machines were in reach at some point, and never more of them than their k.
    for (const slot of ["segment.fan", "segment.air_rush", "segment.belt", "segment.slide_rumble"] as const) {
      expect(numbers.peakLoops[slot] ?? 0, slot).toBeGreaterThan(0);
      expect(numbers.peakLoops[slot], slot).toBeLessThanOrEqual(SOUND_SLOTS[slot].maxLoops!);
    }
  }, 120_000);
});
