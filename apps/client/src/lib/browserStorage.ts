/**
 * `localStorage`, or `null` where even reading the property throws (private
 * mode, blocked site data). Every per-device setting reads it through here —
 * audio volumes, graphics quality, the music's own state — so none of them
 * has to carry its own try/catch around a browser that may refuse.
 */
export type FlagStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const browserStorage = (): FlagStorage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};
