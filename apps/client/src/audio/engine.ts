import type { Vec3 } from "@dont-fall/shared";
import { SOUND_SLOTS, type SlotConfig, type SoundBus, type SoundSlot } from "./slots.js";
import type { SoundBank } from "./soundBank.js";

/**
 * The game's sound engine (M14 ticket 02, ADR 0087): one-shots and loops on
 * five buses (`master → effects, environment, music, ui`), positioned with
 * equal-power panning and a linear distance model, under a voice budget Web
 * Audio doesn't have. Three.js-free: the Stage hands it its `AudioListener`'s
 * context and input.
 */

/** A voice estimated quieter than this (slot × play × bus × distance) is never created. */
export const MIN_AUDIBLE_GAIN = 0.02;
/** At most this many one-shots sound at once; past it the lowest priority gives way. */
export const MAX_ONESHOT_VOICES = 24;
/** How fast a loop fades in, out, or to a new level (s, a `setTargetAtTime` time constant). */
export const LOOP_FADE_SECONDS = 0.12;
/**
 * How long a disposed engine fades out before its graph is released (s): a
 * Stage giving way to the next (a Track swap) crossfades rather than cuts.
 */
export const DISPOSE_FADE_SECONDS = 0.4;
/**
 * How fast a started one-shot follows a new level or rate (s, a time
 * constant): quick enough to track a Dash's build-up frame by frame, slow
 * enough that a 30 Hz step never clicks.
 */
export const VOICE_FOLLOW_SECONDS = 0.03;

/** What playback needs from an `AudioContext` — a structural slice, so tests can stand one in. */
export interface PlaybackContext {
  readonly currentTime: number;
  readonly state: string;
  createGain(): GainNode;
  createBufferSource(): AudioBufferSourceNode;
  createPanner(): PannerNode;
}

export interface PlayOptions {
  /** World position. Absent: not panned, heard at full distance gain (your own Character). */
  at?: Vec3;
  /** Multiplies the slot's own gain. */
  gain?: number;
  /** Multiplies playback rate (and pitch). */
  rate?: number;
  /** Overrides the slot's priority for this play: your own knockdown outranks another player's (M14 ticket 06). */
  priority?: number;
}

/** A one-shot that is still playing, whose level, rate and place can follow its source (M14 ticket 05). */
export interface VoiceHandle {
  /** Moves the voice to a new level, rate or position (one started unpanned stays so). A no-op once it has ended or is stopping. */
  set(options: PlayOptions): void;
  /** Fades it out. */
  stop(): void;
}

export interface LoopHandle {
  /** Updates where and how loud the emitter is; applied on the next {@link SoundEngine.update}. */
  set(options: PlayOptions): void;
  stop(): void;
}

export interface SoundEngineStats {
  /** One-shots sounding now. */
  voices: number;
  /** Loop emitters sounding now (the rest are culled). */
  loopsPlaying: number;
  /** Plays skipped or cut by the budget since the engine started: {@link inaudible} plus {@link overCap}. */
  dropped: number;
  /** Plays never created because they would have been too quiet to hear (too far, or a muted bus). */
  inaudible: number;
  /** Plays refused, or voices cut, because the one-shot cap was full. */
  overCap: number;
}

export interface SoundEngine {
  /** Plays a one-shot. Returns whether a voice was created. */
  play(slot: SoundSlot, options?: PlayOptions): boolean;
  /**
   * Plays a one-shot and hands it back, under the same budget as {@link play}
   * (it can still be evicted). `null` when the budget created nothing.
   */
  start(slot: SoundSlot, options?: PlayOptions): VoiceHandle | null;
  /**
   * Registers a looping emitter. It sounds only while among its slot's nearest
   * `maxLoops`. `fadeSeconds` is how slowly it fades in, out and between levels
   * (a time constant): an ambience's long fade hides where it starts.
   */
  loop(slot: SoundSlot, options?: PlayOptions, fadeSeconds?: number): LoopHandle;
  /** Once a frame: re-chooses which loops sound, and moves them. */
  update(): void;
  /** Linear gain of a bus, or of everything (`master`). */
  setVolume(bus: SoundBus | "master", gain: number): void;
  stats(): SoundEngineStats;
  /**
   * Fades everything out over {@link DISPOSE_FADE_SECONDS}, then stops it and
   * disconnects the graph. Nothing new plays from the moment it is called. The
   * context itself is shared and stays.
   */
  dispose(): void;
}

export interface SoundEngineConfig {
  context: PlaybackContext;
  /** Where the master bus connects: the `AudioListener`'s input. */
  destination: AudioNode;
  bank: SoundBank;
  /** The listener's world position, for the distance estimate. */
  listenerPosition: () => Vec3;
  random?: () => number;
  /** Runs `release` after `ms`: the graph's release once the dispose fade is over. Defaults to `setTimeout`. */
  defer?: (release: () => void, ms: number) => void;
  /** Called once the graph is released, for whatever the graph was connected into. */
  onReleased?: () => void;
}

interface Voice {
  config: SlotConfig;
  priority: number;
  estimate: number;
  /** The pitch jitter picked when it started, kept across a later rate change. */
  jitter: number;
  source: AudioBufferSourceNode;
  gain: GainNode;
  panner: PannerNode | null;
  nodes: AudioNode[];
}

interface Emitter {
  slot: SoundSlot;
  options: PlayOptions;
  fadeSeconds: number;
  playing: { source: AudioBufferSourceNode; gain: GainNode; panner: PannerNode | null } | null;
}

const BUSES: readonly SoundBus[] = ["effects", "environment", "music", "ui"];

/** The linear distance model's gain (Web Audio's formula, rolloff 1) — what the panner will apply. */
export const linearDistanceGain = (distance: number, refDistance: number, maxDistance: number): number => {
  if (distance <= refDistance) return 1;
  if (distance >= maxDistance) return 0;
  return 1 - (distance - refDistance) / (maxDistance - refDistance);
};

const distanceBetween = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

export const createSoundEngine = ({
  context,
  destination,
  bank,
  listenerPosition,
  random = Math.random,
  defer = (release, ms) => {
    setTimeout(release, ms);
  },
  onReleased,
}: SoundEngineConfig): SoundEngine => {
  const master = context.createGain();
  master.connect(destination);
  const buses = new Map<SoundBus, GainNode>();
  for (const name of BUSES) {
    const bus = context.createGain();
    bus.connect(master);
    buses.set(name, bus);
  }
  const volumes = new Map<SoundBus | "master", number>([["master", 1], ...BUSES.map((bus): [SoundBus, number] => [bus, 1])]);

  const voices = new Set<Voice>();
  const emitters = new Set<Emitter>();
  let inaudible = 0;
  let overCap = 0;
  let disposed = false;

  const estimate = (config: SlotConfig, options: PlayOptions): number => {
    const distanceGain = options.at
      ? linearDistanceGain(distanceBetween(options.at, listenerPosition()), config.refDistance, config.maxDistance)
      : 1;
    return config.gain * (options.gain ?? 1) * volumes.get(config.bus)! * volumes.get("master")! * distanceGain;
  };

  const panned = (config: SlotConfig, at: Vec3): PannerNode => {
    const panner = context.createPanner();
    panner.panningModel = "equalpower";
    panner.distanceModel = "linear";
    panner.refDistance = config.refDistance;
    panner.maxDistance = config.maxDistance;
    panner.rolloffFactor = 1;
    placePanner(panner, at);
    return panner;
  };

  const placePanner = (panner: PannerNode, at: Vec3): void => {
    panner.positionX.value = at.x;
    panner.positionY.value = at.y;
    panner.positionZ.value = at.z;
  };

  const release = (voice: Voice): void => {
    if (!voices.delete(voice)) return;
    for (const node of voice.nodes) node.disconnect();
  };

  const createVoice = (slot: SoundSlot, options: PlayOptions): Voice | null => {
    if (disposed || context.state !== "running") return null;
    const config = SOUND_SLOTS[slot];
    const priority = options.priority ?? config.priority;
    const buffers = bank.buffers(slot);
    if (buffers.length === 0) return null;

    const loudness = estimate(config, options);
    if (loudness < MIN_AUDIBLE_GAIN) {
      inaudible += 1;
      return null;
    }
    if (voices.size >= MAX_ONESHOT_VOICES) {
      let victim: Voice | undefined;
      for (const voice of voices) {
        if (!victim || voice.priority < victim.priority || (voice.priority === victim.priority && voice.estimate < victim.estimate)) {
          victim = voice;
        }
      }
      const outranks = victim && (priority > victim.priority || (priority === victim.priority && loudness > victim.estimate));
      overCap += 1;
      if (!victim || !outranks) return null;
      victim.source.stop();
      release(victim);
    }

    const source = context.createBufferSource();
    source.buffer = buffers[Math.floor(random() * buffers.length)] ?? buffers[0]!;
    const jitter = 1 + (random() * 2 - 1) * config.pitchJitter;
    source.playbackRate.value = (options.rate ?? 1) * jitter;
    const gain = context.createGain();
    gain.gain.value = config.gain * (options.gain ?? 1);
    source.connect(gain);
    const nodes: AudioNode[] = [source, gain];
    let panner: PannerNode | null = null;
    if (options.at) {
      panner = panned(config, options.at);
      gain.connect(panner);
      panner.connect(buses.get(config.bus)!);
      nodes.push(panner);
    } else {
      gain.connect(buses.get(config.bus)!);
    }
    const voice: Voice = { config, priority, estimate: loudness, jitter, source, gain, panner, nodes };
    voices.add(voice);
    source.onended = () => release(voice);
    source.start();
    return voice;
  };

  const play = (slot: SoundSlot, options: PlayOptions = {}): boolean => createVoice(slot, options) !== null;

  const start = (slot: SoundSlot, options: PlayOptions = {}): VoiceHandle | null => {
    const voice = createVoice(slot, options);
    if (!voice) return null;
    let current = { ...options };
    let stopping = false;
    return {
      set: (next) => {
        if (stopping || !voices.has(voice)) return;
        current = { ...current, ...next };
        const now = context.currentTime;
        voice.gain.gain.setTargetAtTime(voice.config.gain * (current.gain ?? 1), now, VOICE_FOLLOW_SECONDS);
        voice.source.playbackRate.setTargetAtTime((current.rate ?? 1) * voice.jitter, now, VOICE_FOLLOW_SECONDS);
        if (voice.panner && current.at) placePanner(voice.panner, current.at);
        voice.estimate = estimate(voice.config, current);
      },
      stop: () => {
        if (stopping || !voices.has(voice)) return;
        stopping = true;
        voice.gain.gain.setTargetAtTime(0, context.currentTime, LOOP_FADE_SECONDS);
        voice.source.stop(context.currentTime + LOOP_FADE_SECONDS * 5);
      },
    };
  };

  const startEmitter = (emitter: Emitter, config: SlotConfig, buffer: AudioBuffer): void => {
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.playbackRate.value = emitter.options.rate ?? 1;
    const gain = context.createGain();
    gain.gain.value = 0;
    source.connect(gain);
    let panner: PannerNode | null = null;
    if (emitter.options.at) {
      panner = panned(config, emitter.options.at);
      gain.connect(panner);
      panner.connect(buses.get(config.bus)!);
    } else {
      gain.connect(buses.get(config.bus)!);
    }
    // A random offset, so two emitters of one loop never play in phase.
    source.start(0, random() * buffer.duration);
    emitter.playing = { source, gain, panner };
  };

  const fadeOut = (emitter: Emitter): void => {
    const playing = emitter.playing;
    if (!playing) return;
    emitter.playing = null;
    playing.gain.gain.setTargetAtTime(0, context.currentTime, emitter.fadeSeconds);
    // Five time constants is under 1% of the level: silent, then released.
    playing.source.stop(context.currentTime + emitter.fadeSeconds * 5);
    playing.source.onended = () => {
      playing.source.disconnect();
      playing.gain.disconnect();
      playing.panner?.disconnect();
    };
  };

  const update = (): void => {
    if (disposed) return;
    const bySlot = new Map<SoundSlot, Emitter[]>();
    for (const emitter of emitters) {
      const group = bySlot.get(emitter.slot);
      if (group) group.push(emitter);
      else bySlot.set(emitter.slot, [emitter]);
    }
    for (const [slot, group] of bySlot) {
      const config = SOUND_SLOTS[slot];
      const buffer = bank.buffers(slot)[0];
      const running = context.state === "running" && buffer !== undefined;
      const ranked = group
        .map((emitter) => ({ emitter, loudness: estimate(config, emitter.options) }))
        .sort((a, b) => b.loudness - a.loudness);
      ranked.forEach(({ emitter, loudness }, rank) => {
        const sounds = running && rank < (config.maxLoops ?? Infinity) && loudness >= MIN_AUDIBLE_GAIN;
        if (!sounds) {
          fadeOut(emitter);
          return;
        }
        if (!emitter.playing) startEmitter(emitter, config, buffer!);
        const playing = emitter.playing!;
        const now = context.currentTime;
        playing.gain.gain.setTargetAtTime(config.gain * (emitter.options.gain ?? 1), now, emitter.fadeSeconds);
        playing.source.playbackRate.setTargetAtTime(emitter.options.rate ?? 1, now, LOOP_FADE_SECONDS);
        if (playing.panner && emitter.options.at) placePanner(playing.panner, emitter.options.at);
      });
    }
  };

  const loop = (slot: SoundSlot, options: PlayOptions = {}, fadeSeconds = LOOP_FADE_SECONDS): LoopHandle => {
    const emitter: Emitter = { slot, options: { ...options }, fadeSeconds, playing: null };
    if (!disposed) emitters.add(emitter);
    return {
      set: (next) => {
        emitter.options = { ...emitter.options, ...next };
      },
      stop: () => {
        emitters.delete(emitter);
        fadeOut(emitter);
      },
    };
  };

  return {
    play,
    start,
    loop,
    update,
    setVolume: (bus, gain) => {
      volumes.set(bus, gain);
      (bus === "master" ? master : buses.get(bus)!).gain.value = gain;
    },
    stats: () => ({
      voices: voices.size,
      loopsPlaying: [...emitters].filter((emitter) => emitter.playing).length,
      dropped: inaudible + overCap,
      inaudible,
      overCap,
    }),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      const now = context.currentTime;
      const end = now + DISPOSE_FADE_SECONDS;
      master.gain.setTargetAtTime(0, now, DISPOSE_FADE_SECONDS / 5);
      const playing = [...emitters].flatMap((emitter) => (emitter.playing ? [emitter.playing] : []));
      emitters.clear();
      for (const voice of voices) voice.source.stop(end);
      for (const loop of playing) loop.source.stop(end);
      defer(() => {
        for (const voice of [...voices]) release(voice);
        for (const loop of playing) {
          loop.source.disconnect();
          loop.gain.disconnect();
          loop.panner?.disconnect();
        }
        for (const bus of buses.values()) bus.disconnect();
        master.disconnect();
        onReleased?.();
      }, DISPOSE_FADE_SECONDS * 1000 + 50);
    },
  };
};
