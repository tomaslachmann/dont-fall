/**
 * Sound volumes (ADR 0087, M14 ticket 03): the Settings → AUDIO sliders,
 * stored per device and heard live by a running game. Three-free and
 * engine-free on purpose: the Settings screen reads it from the menu bundle.
 */

export const AUDIO_CHANNELS = ["master", "effects", "environment", "music", "voice"] as const;
export type AudioChannel = (typeof AUDIO_CHANNELS)[number];

/**
 * A channel that is also a bus on a Stage's sound engine. `voice` is not one
 * (ADR 0111): a voice is heard outside any Stage, on the page's own chain,
 * which applies MASTER × VOICE itself — and handing the engine a bus it does
 * not have would throw, not be a no-op. Spelled as a type so the compiler
 * holds that line rather than a comment.
 */
export type EngineAudioChannel = Exclude<AudioChannel, "voice">;

const ENGINE_CHANNELS = AUDIO_CHANNELS.filter((channel): channel is EngineAudioChannel => channel !== "voice");

/** Slider positions, 0–100. */
export type AudioVolumes = Readonly<Record<AudioChannel, number>>;

/**
 * MASTER and MUSIC keep the pane's old mock values; EFFECTS takes IMPACTS &
 * GRABS'. ENVIRONMENT is new, a first guess. VOICE starts level with MASTER
 * (ADR 0111): someone talking to you is the one sound that is never scenery.
 */
export const DEFAULT_AUDIO_VOLUMES: AudioVolumes = { master: 78, effects: 92, environment: 70, music: 42, voice: 100 };

/** `dontfall.audio.v1` — per device, like graphics quality (ADR 0079): speakers belong to the machine. */
export const AUDIO_VOLUMES_STORAGE_KEY = "dontfall.audio.v1";

/** Dispatched on the window when this page writes new volumes; other tabs hear the `storage` event instead. */
export const AUDIO_VOLUMES_EVENT = "dontfall:audio-volumes";

type VolumeStorage = Pick<Storage, "getItem" | "setItem">;

const clampVolume = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.round(Math.min(100, Math.max(0, value))) : fallback;

/** The stored volumes; each missing, unreadable or out-of-range channel falls back or clamps. Never throws. */
export const readAudioVolumes = (storage: VolumeStorage | null): AudioVolumes => {
  try {
    const raw = storage?.getItem(AUDIO_VOLUMES_STORAGE_KEY);
    const stored: unknown = raw ? JSON.parse(raw) : null;
    const record = typeof stored === "object" && stored !== null ? (stored as Record<string, unknown>) : {};
    return Object.fromEntries(
      AUDIO_CHANNELS.map((channel) => [channel, clampVolume(record[channel], DEFAULT_AUDIO_VOLUMES[channel])]),
    ) as AudioVolumes;
  } catch {
    return DEFAULT_AUDIO_VOLUMES;
  }
};

/**
 * Stores volumes and tells this page (a running game hears it at once).
 * Quiet on a storage failure: the change still reaches the game, and lasts
 * only this visit.
 */
export const writeAudioVolumes = (
  storage: VolumeStorage | null,
  volumes: AudioVolumes,
  target: EventTarget | null = typeof window === "undefined" ? null : window,
): void => {
  try {
    storage?.setItem(AUDIO_VOLUMES_STORAGE_KEY, JSON.stringify(volumes));
  } catch {
    // Nothing honest to tell the player; the defaults return next visit.
  }
  target?.dispatchEvent(new CustomEvent<AudioVolumes>(AUDIO_VOLUMES_EVENT, { detail: volumes }));
};

/**
 * Calls `listener` whenever the volumes change: written in this page, or in
 * another tab of the game. Returns the unsubscribe.
 */
export const subscribeAudioVolumes = (
  listener: (volumes: AudioVolumes) => void,
  storage: VolumeStorage | null,
  target: EventTarget = window,
): (() => void) => {
  const onLocal = (event: Event): void => {
    listener((event as CustomEvent<AudioVolumes>).detail ?? readAudioVolumes(storage));
  };
  const onStorage = (event: Event): void => {
    if ((event as StorageEvent).key === AUDIO_VOLUMES_STORAGE_KEY) listener(readAudioVolumes(storage));
  };
  target.addEventListener(AUDIO_VOLUMES_EVENT, onLocal);
  target.addEventListener("storage", onStorage);
  return () => {
    target.removeEventListener(AUDIO_VOLUMES_EVENT, onLocal);
    target.removeEventListener("storage", onStorage);
  };
};

/**
 * A slider position as a linear gain: squared, so half-way sounds about half
 * as loud rather than barely quieter.
 */
export const volumeGain = (value: number): number => (Math.min(100, Math.max(0, value)) / 100) ** 2;

/** The music's own gain (M14 ticket 11): MASTER × MUSIC, since the music plays outside any Stage's buses. */
export const musicGain = (volumes: AudioVolumes): number => volumeGain(volumes.master) * volumeGain(volumes.music);

/** Voice chat's own gain (ADR 0111): MASTER × VOICE, for the same reason — it is heard outside every Stage. */
export const voiceGain = (volumes: AudioVolumes): number => volumeGain(volumes.master) * volumeGain(volumes.voice);

/** Sets every channel's gain on a sound engine (anything with its `setVolume`). */
export const applyAudioVolumes = (
  engine: { setVolume(channel: EngineAudioChannel, gain: number): void } | null,
  volumes: AudioVolumes,
): void => {
  if (!engine) return;
  for (const channel of ENGINE_CHANNELS) engine.setVolume(channel, volumeGain(volumes[channel]));
};
