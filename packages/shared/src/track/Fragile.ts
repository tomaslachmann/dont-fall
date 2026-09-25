import { TICK_DT } from "../tuning/clock.js";

/**
 * A floor that breaks under you (CONTEXT.md: Fragile, ADR 0118), as its Asset
 * authors it: how many arrivals it takes, and how long it stays gone.
 *
 * On the Asset rather than on the Segment, for the reason a Spring's throw
 * and a trap door's swing are: the states are *drawn* — three authored looks
 * in the GLB — so a piece with no crack art could never be one. What a
 * placed Segment retunes is how long it takes to come back
 * ({@link FragileTiming}).
 */
export interface FragileDef {
  /** Arrivals it takes to break — one per authored look, so the last one takes the floor away. */
  entries: number;
  /** Seconds before it returns intact. `0` never returns. */
  returnSeconds: number;
}

/** What an author may retune on a placed fragile floor: how long it stays gone, `0` for never. */
export interface FragileTiming {
  returnSeconds?: number;
}

/** A fragile floor's state, as the simulation holds it and the Snapshot carries it. */
export interface FragileState {
  /** Which Segment of the Track it is. */
  segmentIndex: number;
  /** Arrivals so far — at `entries` the floor is gone. */
  hits: number;
  /** The Tick it returns intact on, or `null` while it is still a floor (or gone for good). */
  returnTick: number | null;
}

/** Whether a floor with `hits` arrivals against `def` is still something to stand on. */
export const fragileStanding = (def: FragileDef, hits: number): boolean => hits < def.entries;

/**
 * Which of the authored looks a floor with `hits` arrivals wears: 0 intact,
 * then one per arrival, up to the last authored one. A broken floor is drawn
 * by nobody, so it has no look of its own.
 */
export const fragileLook = (def: FragileDef, hits: number): number => Math.min(hits, def.entries - 1);

/** The Tick a floor broken at `tick` returns on, or `null` when its author left it gone for good. */
export const fragileReturnTick = (def: FragileDef, timing: FragileTiming | undefined, tick: number): number | null => {
  const seconds = timing?.returnSeconds ?? def.returnSeconds;
  return seconds > 0 ? tick + Math.round(seconds / TICK_DT) : null;
};

/** The floor a placed Segment runs: its Asset's own, with what its author retuned on top. */
export const fragileDefOf = (def: FragileDef, timing: FragileTiming | undefined): FragileDef =>
  timing?.returnSeconds === undefined ? def : { ...def, returnSeconds: Math.max(0, timing.returnSeconds) };

/**
 * Why `value` is not a storable fragile timing (ADR 0099's registry), or
 * `undefined`. Shape only: what it means — which Asset can be one — is the
 * Module's, and a publish validates a Segment without it.
 */
export const invalidFragileReason = (value: unknown): string | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "a fragile floor's timing must be an object";
  const { returnSeconds, ...rest } = value as Record<string, unknown>;
  const extra = Object.keys(rest);
  if (extra.length > 0) return `a fragile floor's timing has no "${extra[0]}" — only returnSeconds`;
  if (returnSeconds !== undefined && (typeof returnSeconds !== "number" || !Number.isFinite(returnSeconds) || returnSeconds < 0)) {
    return "a fragile floor's returnSeconds must be 0 (never) or a positive number of seconds";
  }
  return undefined;
};

/**
 * Which authored look a fragile floor is wearing right now, for a renderer
 * (ADR 0118) — `null` once it is broken, which is drawn by nobody.
 */
export interface FragileLook {
  segmentIndex: number;
  look: number | null;
}
