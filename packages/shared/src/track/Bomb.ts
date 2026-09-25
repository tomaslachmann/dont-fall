import { TICK_DT } from "../tuning/clock.js";

/**
 * A Prop with a fuse (CONTEXT.md: Bomb, ADR 0126), as its Asset authors it:
 * how long it burns once picked up, how much of that is the fast warning
 * tick, and how long it is gone after going off.
 *
 * On the Asset, like a fragile floor's states (ADR 0118): the ticking and the
 * blast are drawn by clips in the model, so a piece without them could never
 * be one. What a placed Segment retunes is the fuse and the return
 * ({@link BombTiming}); the warning belongs to the look.
 */
export interface BombDef {
  /** Seconds from the pick-up that lit it to the blast. */
  fuseSeconds: number;
  /** The last seconds of the fuse, drawn with the fast tick. */
  warnSeconds: number;
  /** Seconds a spent bomb is gone before it lies where it was placed again. */
  returnSeconds: number;
}

/** What an author may retune on a placed bomb. */
export interface BombTiming {
  fuseSeconds?: number;
  returnSeconds?: number;
}

/**
 * A bomb that is not lying where it was placed, as the Snapshot carries it
 * (ADR 0126): lit, with the Tick it goes off on, or spent, with the Tick it
 * was spent on. A bomb with no row is lying — unlit, where it was placed or
 * wherever it was put down — or, a Shooter's, waiting in its cannon.
 */
export interface BombState {
  /** Which Prop of the world it is — its index in `SimState.props`. */
  propIndex: number;
  /** Lit: the Tick it goes off on. */
  detonateTick?: number;
  /** Spent: the Tick it went off (or out) on. */
  blastTick?: number;
  /** Spent: the Tick it is back, unlit, where it was placed. Absent on a Shooter's bomb, which waits for its Shooter instead (ADR 0127). */
  returnTick?: number;
  /** Spent by a blast rather than by falling off the Track — whether there is an explosion to draw. */
  blasted?: boolean;
}

/** The bomb a placed Segment carries: its Asset's own, with what its author retuned on top. */
export const bombDefOf = (def: BombDef, timing: BombTiming | undefined): BombDef => ({
  ...def,
  ...(timing?.fuseSeconds === undefined ? {} : { fuseSeconds: timing.fuseSeconds }),
  ...(timing?.returnSeconds === undefined ? {} : { returnSeconds: timing.returnSeconds }),
});

/** Seconds as whole Ticks, never fewer than one — a fuse or a return always takes at least a Tick. */
export const bombTicks = (seconds: number): number => Math.max(1, Math.round(seconds / TICK_DT));

/**
 * What a bomb is doing at Tick `tick`, for anything that draws or sounds it:
 * lying, ticking (`fast` in its last `warnSeconds`), or exploding with the
 * seconds since the blast (negative before it — the clip leads the blast).
 */
export type BombPhase =
  | { kind: "lying" }
  | { kind: "lit"; fast: boolean; secondsLeft: number }
  | { kind: "spent"; blasted: boolean; secondsSince: number };

/** {@link BombPhase} of `row` at `tick` (fractional for a render clock) against `def`. */
export const bombPhase = (def: BombDef, row: BombState | undefined, tick: number): BombPhase => {
  if (row?.detonateTick !== undefined) {
    const secondsLeft = Math.max(0, (row.detonateTick - tick) * TICK_DT);
    return { kind: "lit", fast: secondsLeft <= def.warnSeconds, secondsLeft };
  }
  if (row?.blastTick !== undefined) {
    return { kind: "spent", blasted: row.blasted === true, secondsSince: (tick - row.blastTick) * TICK_DT };
  }
  return { kind: "lying" };
};

/**
 * Why `value` is not a storable bomb timing (ADR 0099's registry), or
 * `undefined`. Shape only: which Asset can be one is the Module's.
 */
export const invalidBombReason = (value: unknown): string | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "a bomb's timing must be an object";
  const { fuseSeconds, returnSeconds, ...rest } = value as Record<string, unknown>;
  const extra = Object.keys(rest);
  if (extra.length > 0) return `a bomb's timing has no "${extra[0]}" — only fuseSeconds and returnSeconds`;
  for (const [name, seconds] of [
    ["fuseSeconds", fuseSeconds],
    ["returnSeconds", returnSeconds],
  ] as const) {
    if (seconds !== undefined && (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0)) {
      return `a bomb's ${name} must be a positive number of seconds`;
    }
  }
  return undefined;
};
