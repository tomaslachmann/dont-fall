/**
 * Whether the game shows its performance overlay (M13 ticket 01). `?perf=1`
 * turns it on and remembers that on this device, so it survives the hop from
 * `/play` into `/lobby?port=`; `?perf=0` turns it off and forgets; no param
 * reads what was remembered. A dev convenience, so a storage that throws
 * (private mode, blocked site data) just means "not remembered".
 */

export const PERF_FLAG_STORAGE_KEY = "dontfall.perf.v1";

type FlagStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const resolvePerfFlag = (searchParams: URLSearchParams, storage: FlagStorage | null): boolean => {
  const asked = searchParams.get("perf");
  try {
    if (asked === "1") storage?.setItem(PERF_FLAG_STORAGE_KEY, "1");
    else if (asked === "0") storage?.removeItem(PERF_FLAG_STORAGE_KEY);
    else return storage?.getItem(PERF_FLAG_STORAGE_KEY) === "1";
  } catch {
    // Not remembered, but the URL still says what this visit wants.
  }
  return asked === "1";
};

/** `localStorage`, or `null` where even reading the property throws. */
export const browserStorage = (): FlagStorage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};
