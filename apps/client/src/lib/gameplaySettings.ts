/**
 * Gameplay settings (ADR 0110): screen shake on impact and other beans'
 * nameplates — the pause sheet's rows and Settings' own, stored per device
 * like audio and video, and heard live by a running game. Three-free, so the
 * menu bundle reads it.
 */

export const SCREEN_SHAKE_LEVELS = ["OFF", "LOW", "FULL"] as const;
export type ScreenShake = (typeof SCREEN_SHAKE_LEVELS)[number];

export interface GameplaySettings {
  screenShake: ScreenShake;
  nameplates: boolean;
}

/** FULL and ON are the design's own starting positions for both rows. */
export const DEFAULT_GAMEPLAY_SETTINGS: GameplaySettings = { screenShake: "FULL", nameplates: true };

/** `dontfall.gameplay.v1` — per device, like audio and video. */
export const GAMEPLAY_SETTINGS_STORAGE_KEY = "dontfall.gameplay.v1";

/** Dispatched on the window when this page writes new settings; other tabs hear the `storage` event instead. */
export const GAMEPLAY_SETTINGS_EVENT = "dontfall:gameplay-settings";

type SettingsStorage = Pick<Storage, "getItem" | "setItem">;

/** The stored settings; anything missing or unreadable falls back to its default. Never throws. */
export const readGameplaySettings = (storage: SettingsStorage | null): GameplaySettings => {
  try {
    const raw = storage?.getItem(GAMEPLAY_SETTINGS_STORAGE_KEY);
    const stored: unknown = raw ? JSON.parse(raw) : null;
    const record = typeof stored === "object" && stored !== null ? (stored as Record<string, unknown>) : {};
    return {
      screenShake: SCREEN_SHAKE_LEVELS.includes(record.screenShake as ScreenShake)
        ? (record.screenShake as ScreenShake)
        : DEFAULT_GAMEPLAY_SETTINGS.screenShake,
      nameplates: typeof record.nameplates === "boolean" ? record.nameplates : DEFAULT_GAMEPLAY_SETTINGS.nameplates,
    };
  } catch {
    return DEFAULT_GAMEPLAY_SETTINGS;
  }
};

/** Stores the settings and tells this page — a running game hears it at once. Quiet on a storage failure. */
export const writeGameplaySettings = (
  storage: SettingsStorage | null,
  settings: GameplaySettings,
  target: EventTarget | null = typeof window === "undefined" ? null : window,
): void => {
  try {
    storage?.setItem(GAMEPLAY_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // The change still reaches the game; it lasts only this visit.
  }
  target?.dispatchEvent(new CustomEvent<GameplaySettings>(GAMEPLAY_SETTINGS_EVENT, { detail: settings }));
};

/** Calls `listener` whenever the settings change, in this page or another tab. Returns the unsubscribe. */
export const subscribeGameplaySettings = (
  listener: (settings: GameplaySettings) => void,
  storage: SettingsStorage | null,
  target: EventTarget = window,
): (() => void) => {
  const onLocal = (event: Event): void => listener((event as CustomEvent<GameplaySettings>).detail ?? readGameplaySettings(storage));
  const onStorage = (event: Event): void => {
    if ((event as StorageEvent).key === GAMEPLAY_SETTINGS_STORAGE_KEY) listener(readGameplaySettings(storage));
  };
  target.addEventListener(GAMEPLAY_SETTINGS_EVENT, onLocal);
  target.addEventListener("storage", onStorage);
  return () => {
    target.removeEventListener(GAMEPLAY_SETTINGS_EVENT, onLocal);
    target.removeEventListener("storage", onStorage);
  };
};
