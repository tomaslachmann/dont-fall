import type { BotLevel } from "../match/LobbyBots.js";
import { BOT_LEVEL_SPREADS, type BotLevelSpread, type BotRange } from "../tuning/bots.js";
import { botDraw } from "./random.js";

/**
 * One Bot's spread around the host's level (M17 ticket 08, ADR 0129: "the
 * host picks one level, each Bot draws its own spread"). `reactionTicks` and
 * `clumsiness` are applied now, by `withPerceptionDelay` wrapping a Bot from
 * the outside — not by anything a goal's leaves do. The rest are drawn here,
 * on the same seed, so their numbers are already settled and repeatable once
 * the tickets that read them land:
 *
 * - `lookAheadTicks` / `timingErrorTicks`: obstacle look-ahead and timing
 *   error, M17 ticket 07's fields.
 * - `aimError` / `aggression` / `chanceTaking`: the Fight's, read by
 *   `Fighter` (M17 ticket 09).
 */
export interface BotProfile {
  /** Ticks of perception staleness a Bot's decisions run behind the world (`withPerceptionDelay`). */
  readonly reactionTicks: number;
  /** 0 (steady) to 1 (stumbles almost every Tick): extra staleness on top of `reactionTicks`. */
  readonly clumsiness: number;
  /** Ticks ahead a Bot foresees a Motion. Unread until M17 ticket 07. */
  readonly lookAheadTicks: number;
  /** Ticks of jitter on a foreseen Motion's timing. Unread until M17 ticket 07. */
  readonly timingErrorTicks: number;
  /** Radians of error on where a Hit or a throw is aimed: the Fight's (M17 ticket 09). */
  readonly aimError: number;
  /** 0..1, how readily a Bot turns from its goal to a fight: the Fight's (M17 ticket 09). */
  readonly aggression: number;
  /** 0..1, how often a Bot takes the riskier of two ways — a Grab over a Hit, a catch of a Shooter's Bomb (M17 ticket 09). */
  readonly chanceTaking: number;
}

const draw = (seed: string, field: string, { min, max }: BotRange): number => min + (max - min) * botDraw(seed, `profile ${field}`);

/**
 * Draws one Bot's {@link BotProfile}: a uniform draw per field, within
 * `level`'s range (`BOT_LEVEL_SPREADS`), on `seed`. The seed is the Match and
 * the seat (`BotDriver.add`), so a suite's Bots play the same every run and a
 * live Lobby's do not repeat.
 */
export const botProfile = (level: BotLevel, seed: string): BotProfile => {
  const spread: BotLevelSpread = BOT_LEVEL_SPREADS[level];
  return {
    reactionTicks: Math.round(draw(seed, "reactionTicks", spread.reactionTicks)),
    clumsiness: draw(seed, "clumsiness", spread.clumsiness),
    lookAheadTicks: Math.round(draw(seed, "lookAheadTicks", spread.lookAheadTicks)),
    timingErrorTicks: Math.round(draw(seed, "timingErrorTicks", spread.timingErrorTicks)),
    aimError: draw(seed, "aimError", spread.aimError),
    aggression: draw(seed, "aggression", spread.aggression),
    chanceTaking: draw(seed, "chanceTaking", spread.chanceTaking),
  };
};
