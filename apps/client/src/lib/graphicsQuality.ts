/**
 * Graphics quality (ADR 0079, M13 ticket 05): a level the player picks in
 * Settings → VIDEO, stored per device, read when the game builds its Stage.
 * Nothing switches it on its own. Three-free on purpose: the Settings screen
 * reads it from the menu bundle, which never loads the renderer (ADR 0008).
 */

export const GRAPHICS_QUALITY_LEVELS = ["high", "medium", "low"] as const;
export type GraphicsQuality = (typeof GRAPHICS_QUALITY_LEVELS)[number];

/** Today's look (ADR 0079): nothing chooses a lower level for the player. */
export const DEFAULT_GRAPHICS_QUALITY: GraphicsQuality = "high";

/** What one level changes. Render-only: the simulation, the Snapshot and the server never see it. */
export interface GraphicsSettings {
  /** The renderer's pixel ratio is the display's, capped here. */
  maxPixelRatio: number;
  /** Samples per pixel in the composer's render targets; 0 draws with none. */
  composerSamples: number;
  /** The sun's shadow map, or none. `soft` is `PCFSoftShadowMap`, `pcf` plain `PCFShadowMap`. */
  shadows: { mapSize: number; filter: "soft" | "pcf" } | null;
  /** Whether the Environment draws its drifting cloud puffs. */
  cloudPuffs: boolean;
}

/**
 * The levels (ADR 0079's table). `high` is exactly what M12 shipped. The
 * lower levels' numbers are starting points, to retune against M13's
 * before/after measurements.
 */
export const GRAPHICS_QUALITY_SETTINGS: Readonly<Record<GraphicsQuality, GraphicsSettings>> = {
  high: { maxPixelRatio: 2, composerSamples: 4, shadows: { mapSize: 2048, filter: "soft" }, cloudPuffs: true },
  medium: { maxPixelRatio: 1.5, composerSamples: 2, shadows: { mapSize: 1024, filter: "pcf" }, cloudPuffs: true },
  low: { maxPixelRatio: 1, composerSamples: 0, shadows: null, cloudPuffs: false },
};

/** `dontfall.graphics.v1` — per device, not per Account: the right level belongs to the machine. */
export const GRAPHICS_QUALITY_STORAGE_KEY = "dontfall.graphics.v1";

type QualityStorage = Pick<Storage, "getItem" | "setItem">;

export const isGraphicsQuality = (value: unknown): value is GraphicsQuality =>
  typeof value === "string" && (GRAPHICS_QUALITY_LEVELS as readonly string[]).includes(value);

/** The stored level, or the default for anything missing, unknown or unreadable. Never throws. */
export const readGraphicsQuality = (storage: QualityStorage | null): GraphicsQuality => {
  try {
    const stored = storage?.getItem(GRAPHICS_QUALITY_STORAGE_KEY);
    return isGraphicsQuality(stored) ? stored : DEFAULT_GRAPHICS_QUALITY;
  } catch {
    return DEFAULT_GRAPHICS_QUALITY;
  }
};

/** Stores a level. Quiet on failure (private mode, quota): the choice then lasts only this visit. */
export const writeGraphicsQuality = (storage: QualityStorage | null, level: GraphicsQuality): void => {
  try {
    storage?.setItem(GRAPHICS_QUALITY_STORAGE_KEY, level);
  } catch {
    // Nothing honest to tell the player; the default returns next visit.
  }
};
