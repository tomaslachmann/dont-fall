import type { Vec3 } from "../math/vec3.js";

/**
 * The Environment a Round is drawn inside (ADR 0074): a sky, a cloud floor,
 * drifting cloud puffs, fog and the light that matches them. Render-only by
 * rule — the Match server and the shared step never read any of this. It
 * lives here, three-free, because the API validates the id a Revision names;
 * `@dont-fall/render` turns a preset into three.js objects.
 *
 * Hex colours are sRGB, as authored; renderers wrap them in `THREE.Color`.
 */

/** Every preset a Revision may name — the API refuses anything else on publish. */
export const ENVIRONMENT_IDS = ["day", "sunset", "night"] as const;

export type EnvironmentId = (typeof ENVIRONMENT_IDS)[number];

/** What a Revision without an Environment, or with one this build does not know, is drawn under. */
export const DEFAULT_ENVIRONMENT_ID: EnvironmentId = "day";

/** A render-only drift, in world units per second on the wall clock (never sim time). */
export interface EnvironmentWind {
  readonly x: number;
  readonly z: number;
}

export interface EnvironmentSun {
  /** Degrees about +Y, measured from +Z toward +X — the same turn `yawQuat` makes. */
  readonly azimuthDeg: number;
  /** Degrees above the horizon. */
  readonly elevationDeg: number;
  readonly color: number;
  /** The drawn disc's angular radius in degrees; 0 draws no disc. */
  readonly discRadiusDeg: number;
}

/** A night sky's stars: fixed points on the dome, above the horizon. */
export interface EnvironmentStars {
  readonly count: number;
  readonly color: number;
  /** Each star's size on screen, in drawing-buffer pixels. */
  readonly size: number;
}

export interface EnvironmentSky {
  /**
   * Straight up. Mostly a builder colour: the chase camera never shows more
   * than ~22° above the horizon (research §1c).
   */
  readonly zenith: number;
  /** At eye level — and always the fog colour, so fogged geometry melts into the sky. */
  readonly horizon: number;
  /** Below the horizon, past the cloud floor's far edge. */
  readonly nadir: number;
  /** The exponent on the horizon-to-zenith blend; below 1 the zenith colour reaches further down. */
  readonly horizonSoftness: number;
  /** The sun's disc, or the moon's: the light's direction either way. */
  readonly sun: EnvironmentSun;
  readonly stars?: EnvironmentStars;
}

/** `THREE.Fog` distances along the view axis. Its colour is always {@link EnvironmentSky.horizon}. */
export interface EnvironmentFog {
  readonly near: number;
  readonly far: number;
}

export interface EnvironmentLight {
  /** The hemisphere light's sky colour; its ground colour is always the cloud floor's shade. */
  readonly hemiSky: number;
  /**
   * A top-up on the fill {@link environmentIntensity} already gives: with the
   * sky baked into an environment map, a hemisphere light at full strength
   * counts the ambient light twice (research §6).
   */
  readonly hemiIntensity: number;
  readonly sunColor: number;
  readonly sunIntensity: number;
  /**
   * An art cheat, named so it is never applied silently: light the decks from
   * higher than the drawn sun, so a low sunset disc does not leave every
   * platform side dark (research §6). Same azimuth as the sun.
   */
  readonly lightElevationDeg?: number;
  /**
   * `scene.environmentIntensity` for the environment map baked from the sky:
   * how strongly glossy surfaces reflect it and how much indirect light they
   * take from it.
   */
  readonly environmentIntensity: number;
}

/** The plane under the Track that replaces the drawn kill plane (ADR 0074). */
export interface EnvironmentCloudFloor {
  readonly lit: number;
  /** The darker tone between the noise's bright patches; also the hemisphere light's ground colour. */
  readonly shade: number;
  /**
   * How far above the kill height the floor sits, before {@link cloudFloorY}
   * clamps it under the Track. Just above it, so a Falling Character sinks
   * into cloud before the Respawn fires (research §3).
   */
  readonly offsetAboveKillPlane: number;
  /**
   * Where the floor opens, as a share of its noise's range (0–1): below it the
   * floor has a hole, so the puff band beneath shows through (research §3).
   * 0 draws it closed.
   */
  readonly openBelow: number;
  readonly wind: EnvironmentWind;
}

/**
 * How the puffs are lit — still open (ADR 0074), so both are built for the
 * user to compare: `soft` is plain matte shading that takes the sky's
 * environment map like the Assets do; `toon` is three hard bands.
 */
export const ENVIRONMENT_PUFF_STYLES = ["soft", "toon"] as const;

export type EnvironmentPuffStyle = (typeof ENVIRONMENT_PUFF_STYLES)[number];

/** A height range the puffs are scattered in, relative to the cloud floor (negative is beneath it). */
export interface EnvironmentPuffBand {
  readonly low: number;
  readonly high: number;
}

/** Opaque low-poly clouds that drift and wrap around the camera (research §3). */
export interface EnvironmentCloudPuffs {
  readonly style: EnvironmentPuffStyle;
  /** Puffs in the whole field, shared between the bands. */
  readonly count: number;
  readonly lit: number;
  readonly shade: number;
  readonly bands: readonly EnvironmentPuffBand[];
  readonly wind: EnvironmentWind;
}

export interface EnvironmentPreset {
  readonly sky: EnvironmentSky;
  readonly fog: EnvironmentFog;
  readonly light: EnvironmentLight;
  /** The renderer's `toneMappingExposure` while this preset is drawn. */
  readonly exposure: number;
  readonly cloudFloor: EnvironmentCloudFloor;
  readonly puffs: EnvironmentCloudPuffs;
}

/**
 * The default. A starting palette, not a settled one (the palette call is the
 * user's, ticket 03): pale teal sky, warm cream horizon, lilac-grey below, a
 * warm-white cloud floor with a lilac shade. None of it may match the KayKit
 * deck-top blue, or the decks disappear against it (research §1e). The sun
 * sits where today's light already is, at today's intensity.
 *
 * The environment map carries about 80 % of the fill (ticket 04). At full
 * strength this sky gives 2.4–2.9× the fill the old hemisphere light at 1.1
 * did. With the map at 0.3 and the hemisphere at 0.2, up- and side-facing
 * surfaces get within 4 % of the old fill and undersides 10 % less, so the sun
 * keeps its share of the light: this ticket changes the colour of the fill,
 * not how bright a Round is. A starting balance for the user's visual check,
 * not a settled one.
 */
const DAY: EnvironmentPreset = {
  sky: {
    zenith: 0x9fd3e0,
    horizon: 0xfbe9d0,
    nadir: 0xb9b0c9,
    horizonSoftness: 0.35,
    sun: { azimuthDeg: 60, elevationDeg: 55, color: 0xfff4e0, discRadiusDeg: 2.5 },
  },
  fog: { near: 40, far: 160 },
  light: {
    hemiSky: 0xbfd4ff,
    hemiIntensity: 0.2,
    sunColor: 0xfff4e0,
    sunIntensity: 1.7,
    environmentIntensity: 0.3,
  },
  exposure: 1,
  cloudFloor: {
    lit: 0xfff8f0,
    shade: 0xcbbfdc,
    offsetAboveKillPlane: 0.5,
    openBelow: 0.2,
    wind: { x: 0.6, z: 0.25 },
  },
  puffs: {
    style: "soft",
    count: 90,
    lit: 0xffffff,
    shade: 0xd8cfe6,
    bands: [
      { low: 12, high: 30 },
      { low: -14, high: -4 },
    ],
    wind: { x: 1.2, z: 0.5 },
  },
};

/**
 * Warm and low (ticket 11; research §7's starting palette): violet overhead,
 * peach at the horizon, dusky rose below, a pink-white floor with a mauve
 * shade. The disc sits 8° up and ahead of a Track run toward −Z, the only sun
 * a Round's chase camera ever shows; the light is lifted to 35°
 * (`lightElevationDeg`) so deck tops stay lit rather than raked.
 *
 * Measured the way `day` was (three.js r171's lighting terms, integrated
 * over this dome): deck tops get 80 % of `day`'s light, undersides the same,
 * and the sides facing the sun more. Lower-lit than `day`, not darker to read.
 */
const SUNSET: EnvironmentPreset = {
  sky: {
    zenith: 0x6f5ba7,
    horizon: 0xffb38a,
    nadir: 0xb77f97,
    // Above 1 the horizon's peach climbs further up the sky.
    horizonSoftness: 1.2,
    sun: { azimuthDeg: 240, elevationDeg: 8, color: 0xffdba0, discRadiusDeg: 3.5 },
  },
  fog: { near: 40, far: 160 },
  light: {
    hemiSky: 0xffc9b0,
    hemiIntensity: 0.45,
    sunColor: 0xffb070,
    sunIntensity: 2.6,
    lightElevationDeg: 35,
    environmentIntensity: 0.45,
  },
  exposure: 1.05,
  cloudFloor: {
    lit: 0xffe6ea,
    shade: 0xb58aa8,
    offsetAboveKillPlane: 0.5,
    openBelow: 0.2,
    wind: { x: 0.6, z: 0.25 },
  },
  puffs: {
    style: "soft",
    count: 90,
    lit: 0xffe0d6,
    shade: 0xc596b0,
    bands: [
      { low: 12, high: 30 },
      { low: -14, high: -4 },
    ],
    wind: { x: 1.2, z: 0.5 },
  },
};

/**
 * Cool and dark, but never so dark the route is lost (ADR 0074; ticket 11):
 * deep indigo overhead, blue-violet at the horizon, near-black below, a dim
 * blue floor, a moon 16° up ahead and stars. A dark sky's environment map
 * fills almost nothing, so the hemisphere light carries the fill here, and
 * the moonlight is lifted to 50°. Measured like `day`: deck tops get 85 % of
 * `day`'s light and sides about as much as `day`'s shaded sides; only
 * undersides go properly dark. The fog reaches further than by day, so a gap
 * ahead never hides in the dark.
 */
const NIGHT: EnvironmentPreset = {
  sky: {
    zenith: 0x1b1f4a,
    horizon: 0x3b3f7a,
    nadir: 0x0f1328,
    horizonSoftness: 0.5,
    sun: { azimuthDeg: 150, elevationDeg: 16, color: 0xdfe8ff, discRadiusDeg: 2 },
    stars: { count: 700, color: 0xf2f4ff, size: 2.5 },
  },
  fog: { near: 45, far: 180 },
  light: {
    hemiSky: 0x9fb4ff,
    hemiIntensity: 1.6,
    sunColor: 0xc6d4ff,
    sunIntensity: 1.3,
    lightElevationDeg: 50,
    environmentIntensity: 1,
  },
  exposure: 1.1,
  cloudFloor: {
    lit: 0x6f7fb8,
    shade: 0x3a4278,
    offsetAboveKillPlane: 0.5,
    openBelow: 0.2,
    wind: { x: 0.6, z: 0.25 },
  },
  puffs: {
    style: "soft",
    count: 90,
    lit: 0x8c97c8,
    shade: 0x4a5288,
    bands: [
      { low: 12, high: 30 },
      { low: -14, high: -4 },
    ],
    wind: { x: 1.2, z: 0.5 },
  },
};

/** Every preset by id. */
export const ENVIRONMENT_PRESETS: Readonly<Record<EnvironmentId, EnvironmentPreset>> = {
  day: DAY,
  sunset: SUNSET,
  night: NIGHT,
};

/** Whether `value` is an id this build has a preset for. */
export const isEnvironmentId = (value: unknown): value is EnvironmentId =>
  typeof value === "string" && (ENVIRONMENT_IDS as readonly string[]).includes(value);

/**
 * Why `value` is not a storable Environment id, or `undefined` when it is.
 * The API's publish validation reports this reason in its 400.
 */
export const invalidEnvironmentReason = (value: unknown): string | undefined =>
  isEnvironmentId(value) ? undefined : `environment must be one of ${ENVIRONMENT_IDS.join(", ")}`;

/**
 * The id a fetched Revision is drawn under. An Environment is cosmetic, so it
 * never bricks boot: an id this build does not know (a newer server's preset)
 * falls back to {@link DEFAULT_ENVIRONMENT_ID} and says why in `warning`, for
 * the caller to log as a dev warning. A missing id (an API older than the
 * field) falls back silently.
 */
export const resolveEnvironmentId = (value: unknown): { id: EnvironmentId; warning: string | undefined } => {
  if (isEnvironmentId(value)) return { id: value, warning: undefined };
  if (value === undefined || value === null) return { id: DEFAULT_ENVIRONMENT_ID, warning: undefined };
  return {
    id: DEFAULT_ENVIRONMENT_ID,
    warning: `unknown environment ${JSON.stringify(value)}, drawing "${DEFAULT_ENVIRONMENT_ID}"`,
  };
};

const DEG_TO_RAD = Math.PI / 180;

const directionAt = (azimuthDeg: number, elevationDeg: number): Vec3 => {
  const azimuth = azimuthDeg * DEG_TO_RAD;
  const elevation = elevationDeg * DEG_TO_RAD;
  const horizontal = Math.cos(elevation);
  return { x: horizontal * Math.sin(azimuth), y: Math.sin(elevation), z: horizontal * Math.cos(azimuth) };
};

/** The unit vector toward the drawn sun disc. */
export const sunDirection = (preset: EnvironmentPreset): Vec3 =>
  directionAt(preset.sky.sun.azimuthDeg, preset.sky.sun.elevationDeg);

/**
 * The unit vector the sun's light (and its shadows) come from: the drawn
 * sun's, unless the preset lifts it with `lightElevationDeg`.
 */
export const sunLightDirection = (preset: EnvironmentPreset): Vec3 =>
  directionAt(preset.sky.sun.azimuthDeg, preset.light.lightElevationDeg ?? preset.sky.sun.elevationDeg);

/** How far under the Track's lowest geometry the cloud floor must stay. */
export const CLOUD_FLOOR_MIN_CLEARANCE = 0.5;

/**
 * The cloud floor's height: the preset's offset above the kill height, but
 * never closer than {@link CLOUD_FLOOR_MIN_CLEARANCE} under the lowest Y the
 * Track's drawn geometry reaches (`Infinity` for a Track with nothing drawn).
 * A Track can sit 2.8 above the kill height (research §1d), so the floor is
 * derived and clamped, never authored as an absolute depth. The simulation's
 * kill plane does not move.
 */
export const cloudFloorY = (preset: EnvironmentPreset, killPlaneY: number, lowestSegmentY: number): number =>
  Math.min(killPlaneY + preset.cloudFloor.offsetAboveKillPlane, lowestSegmentY - CLOUD_FLOOR_MIN_CLEARANCE);

/**
 * `value` moved by whole multiples of `tileSize` into the tile centred on
 * `center`, half-open: `[center − tileSize/2, center + tileSize/2)`. Applied
 * per axis, it turns a fixed set of drifting cloud puffs into an endless field
 * around the camera.
 */
export const wrapAround = (value: number, center: number, tileSize: number): number => {
  const half = tileSize / 2;
  let offset = (value - center + half) % tileSize;
  if (offset < 0) offset += tileSize;
  // A tiny negative remainder plus `tileSize` can round to exactly `tileSize`.
  if (offset >= tileSize) offset -= tileSize;
  return offset - half + center;
};
