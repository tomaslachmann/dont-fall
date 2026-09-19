import { roundScore, type EliminationCredit, type EliminationHow } from "@dont-fall/shared";

/**
 * Your run just ended, mid-Round (ticket 14) — the FinishedOrOut verdict's
 * facts. Raised once per Round, off the authoritative snapshot, never the
 * local prediction: only the server knows when anyone else crossed, so only
 * it can place you among them.
 */
export interface RunEndEvent {
  /** Race finish or Survival elimination — decided by which edge fired. */
  outcome: "finished" | "out";
  /**
   * Where you landed: finish order among everyone who crossed before you
   * (race), or one past everyone still in it when you went out (survival —
   * going out with six others still racing is #7).
   */
  placement: number;
  /** The Round's field — every Character the snapshot still carries. */
  playerCount: number;
  /**
   * The server's own rule (`buildResults` partitions on it): a finish
   * qualifies, going out doesn't. Known the instant the edge fires, no
   * waiting for RESULTS to confirm it.
   */
  qualified: boolean;
  /** This run's own Score (`roundScore`, the same formula earnings use). */
  points: number;
  /** Server-clock race time — finished runs only. */
  raceTimeMs: number | null;
  /** Server-clock time survived — knocked-out runs only. */
  survivedMs: number | null;
  /**
   * Last checkpoint crossed (0-based, `null` before the first) — the
   * verdict's progress pips for a run that didn't finish them all.
   */
  checkpointIndex: number | null;
  /** Who put you out, and how — knocked-out runs only, and only when someone did (ADR 0110). */
  outBy: { nickname: string; how: EliminationHow } | null;
}

interface RunCharacter {
  finishTick: number | null;
  eliminated: boolean;
  checkpointIndex: number | null;
  eliminatedBy?: EliminationCredit | null;
}

/**
 * The edge from \"still in it\" to \"done\" (ticket 14) — pure, so the verdict
 * tests pin it without a socket or a loop. Both edges on one snapshot can't
 * happen (a finisher can't be eliminated, the eliminated never cross), but
 * if it ever did, the finish wins: a result earned beats a result suffered.
 */
export const detectRunEnd = (args: {
  wasFinished: boolean;
  wasEliminated: boolean;
  /** Your Character this snapshot — absent for a mid-Match joiner with no run to end. */
  character: RunCharacter | undefined;
  characters: Record<string, RunCharacter>;
  myId: string;
  /** Server-clock stopwatches, measured by the caller from the Round's start — the event only picks. */
  raceTimeMs: number;
  survivedMs: number;
  /** Names whoever put you out — anyone ever seen this Match, including those since gone. */
  nicknameOf: (id: string) => string;
}): RunEndEvent | null => {
  const me = args.character;
  if (me === undefined) return null;
  const playerCount = Object.keys(args.characters).length;
  const finishedEdge = !args.wasFinished && me.finishTick !== null;
  const outEdge = !args.wasEliminated && me.eliminated;
  if (finishedEdge) {
    const placement =
      1 +
      Object.entries(args.characters).filter(
        ([id, other]) => id !== args.myId && other.finishTick !== null && other.finishTick < me.finishTick!,
      ).length;
    return {
      outcome: "finished",
      placement,
      playerCount,
      qualified: true,
      points: roundScore(placement, playerCount, true),
      raceTimeMs: args.raceTimeMs,
      survivedMs: null,
      checkpointIndex: me.checkpointIndex,
      outBy: null,
    };
  }
  if (outEdge) {
    const placement =
      1 + Object.entries(args.characters).filter(([id, other]) => id !== args.myId && !other.eliminated).length;
    return {
      outcome: "out",
      placement,
      playerCount,
      qualified: false,
      points: roundScore(placement, playerCount, false),
      raceTimeMs: null,
      survivedMs: args.survivedMs,
      checkpointIndex: me.checkpointIndex,
      outBy: me.eliminatedBy ? { nickname: args.nicknameOf(me.eliminatedBy.byId), how: me.eliminatedBy.how } : null,
    };
  }
  return null;
};
