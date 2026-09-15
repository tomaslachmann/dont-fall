import { useSyncExternalStore } from "react";
import type { BuilderEngine } from "../engine.js";

/**
 * Re-renders the caller on every structural engine change (edits, selection,
 * status, asset arrivals…) — never on the 60 Hz Motion clock, which has its
 * own subscription below. Components then read whatever they need off the
 * engine; the version itself is only the snapshot.
 */
export const useEngineVersion = (engine: BuilderEngine): number =>
  useSyncExternalStore(
    engine.subscribe,
    () => engine.version,
    () => engine.version,
  );

/** Re-renders the caller on every Motion-clock tick — the Transport's own subscription. */
export const useEngineClock = (engine: BuilderEngine): number =>
  useSyncExternalStore(
    engine.subscribeClock,
    () => engine.clockSeconds,
    () => engine.clockSeconds,
  );
