import { ENVIRONMENT_IDS, ENVIRONMENT_PRESETS, type EnvironmentId, type EnvironmentPreset } from "@dont-fall/shared";
import type { LoopHandle, SoundEngine } from "./engine.js";
import type { SoundSlot } from "./slots.js";

/** One loop of an Environment's ambience. */
export interface AmbienceLayer {
  slot: SoundSlot;
  gain: number;
  /** A wind layer swells with the camera's height over the cloud floor. */
  wind?: boolean;
}

/**
 * What each Environment (ADR 0074) sounds like (M14 ticket 09, ADR 0087):
 * day is wind and birds, sunset a softer wind and fewer birds, night a lower
 * wind under crickets.
 */
export const AMBIENCE: Readonly<Record<EnvironmentId, readonly AmbienceLayer[]>> = {
  day: [
    { slot: "environment.wind_day", gain: 0.8, wind: true },
    { slot: "environment.birds", gain: 0.6 },
  ],
  sunset: [
    { slot: "environment.wind_day", gain: 0.55, wind: true },
    { slot: "environment.birds", gain: 0.3 },
  ],
  night: [
    { slot: "environment.wind_night", gain: 0.8, wind: true },
    { slot: "environment.crickets", gain: 0.7 },
  ],
};

/**
 * How slowly an ambience fades in (s, a time constant). A few seconds to
 * full, so the loop never starts on an audible edge.
 */
export const AMBIENCE_FADE_SECONDS = 1.2;
/** The wind's share of its level with the camera at the cloud floor. */
export const WIND_CALM_SHARE = 0.55;
/** How far above the cloud floor (units) the wind is at full level. */
export const WIND_FULL_HEIGHT = 40;

const smoothstep = (t: number): number => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

/**
 * How much of its level the wind has with the camera `height` units above the
 * cloud floor: calmer down by the clouds, full high over them. The void below
 * is the one thing always in view.
 */
export const windSwell = (height: number): number =>
  WIND_CALM_SHARE + (1 - WIND_CALM_SHARE) * smoothstep(height / WIND_FULL_HEIGHT);

/** Which Environment a preset is, by identity; `undefined` for a preset this build doesn't list. */
export const environmentIdOf = (preset: EnvironmentPreset): EnvironmentId | undefined =>
  ENVIRONMENT_IDS.find((id) => ENVIRONMENT_PRESETS[id] === preset);

/** The slots an Environment's ambience plays. */
export const ambienceSlots = (id: EnvironmentId | undefined): SoundSlot[] =>
  id === undefined ? [] : AMBIENCE[id].map((layer) => layer.slot);

/**
 * An Environment's ambience for one Stage: unpanned loops on the environment
 * bus, fading in slowly when the Stage starts. They fade out with the engine
 * when the Stage is disposed, so a Track swap crossfades. A layer that failed
 * to load stays silent, and the rest play on.
 */
export class Ambience {
  private readonly layers: { layer: AmbienceLayer; loop: LoopHandle }[];

  constructor(
    engine: Pick<SoundEngine, "loop">,
    id: EnvironmentId | undefined,
    private readonly cloudFloorY: number,
  ) {
    this.layers =
      id === undefined
        ? []
        : AMBIENCE[id].map((layer) => ({
          layer,
            loop: engine.loop(layer.slot, { gain: layer.wind ? layer.gain * WIND_CALM_SHARE : layer.gain }, AMBIENCE_FADE_SECONDS),
          }));
  }

  /** Once a frame, with the camera's height. */
  update(cameraY: number): void {
    const swell = windSwell(cameraY - this.cloudFloorY);
    for (const { layer, loop } of this.layers) if (layer.wind) loop.set({ gain: layer.gain * swell });
  }
}
