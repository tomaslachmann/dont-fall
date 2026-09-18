import { MAX_ROUND_SCORE, QUALIFICATION_SCORE_BONUS } from "../tuning/match.js";
import type { LobbyPlayer } from "./Lobby.js";
import { rankWithTies } from "./ranking.js";
import { buildResults, type DnfEntry, type ResultsCharacter, type ResultsRow } from "./Results.js";

/**
 * One Player's placement in one finished Round, ready to score (M7 ticket
 * 03, ADR 0049). 1-based and **continuous across the whole ranked field** —
 * Qualified first, then the non-Qualified — unlike `ResultsRow.placement`,
 * which the Results Screen only ever fills in for the Qualified tier.
 * Standard competition ranking throughout: a tie shares a placement and the
 * next one skips.
 */
export interface RoundResultRow {
  id: string;
  placement: number;
  qualified: boolean;
}

/**
 * One finished Round's scoreable outcome (ADR 0049) — built from
 * `buildResults`, not alongside it: the tiers and their relative order are
 * exactly what `buildResults` already computed, one ranking rule in the
 * codebase. This only continues a single global placement across those
 * tiers, reading ties from the same `finishTick`/`eliminatedTick`/
 * `checkpointIndex` values `buildResults` itself sorted by — never a second,
 * independent tie rule.
 *
 * A DNF row (M4 ticket 05) is left out of `rows` entirely: "not a result to
 * place among the ones that were played out" (`buildResults`' own
 * docstring) applies to Score exactly as it does to placement. `rows.length`
 * is therefore this Round's own scoring field size — the Round's, not the
 * Match's (a mid-Round drop shrinks it, same as it already shrinks who a
 * Race waits on).
 */
export interface RoundResult {
  rows: readonly RoundResultRow[];
}

/** Whether `curr` ties `prev` — same underlying value `buildResults` itself sorted the pair by, never a second rule. Different tiers never tie. */
const tiesWithPrevious = (characters: Record<string, ResultsCharacter>) => (prev: ResultsRow, curr: ResultsRow): boolean => {
  if (curr.qualified !== prev.qualified) return false;
  const p = characters[prev.id];
  const c = characters[curr.id];
  if (curr.qualified) return (p?.finishTick ?? null) === (c?.finishTick ?? null);
  const pTick = p?.eliminatedTick ?? null;
  const cTick = c?.eliminatedTick ?? null;
  if (pTick !== null || cTick !== null) return pTick === cTick;
  return (p?.checkpointIndex ?? null) === (c?.checkpointIndex ?? null);
};

/** Build one Round's {@link RoundResult} — see that type's own doc for what this does and doesn't reimplement. */
export const buildRoundResult = (
  characters: Record<string, ResultsCharacter>,
  players: readonly LobbyPlayer[],
  dnfEntries: readonly DnfEntry[],
): RoundResult => {
  const ranked = buildResults(characters, players, dnfEntries).filter((row) => !row.dnf);
  const placements = rankWithTies(ranked, tiesWithPrevious(characters));
  const rows: RoundResultRow[] = ranked.map((row, i) => ({ id: row.id, placement: placements[i]!, qualified: row.qualified }));

  return { rows };
};

/**
 * The Score one Round placement pays (ADR 0049): percentile-normalised to
 * {@link MAX_ROUND_SCORE} over the `playerCount` actually ranked in that
 * Round, so a Round played by four and one played by six pay the same
 * currency — first always takes the max, last always takes zero, whatever
 * `playerCount` is. Plus a flat {@link QUALIFICATION_SCORE_BONUS} for
 * Qualifying.
 *
 * `playerCount <= 1` is guarded rather than dividing by zero — a solo Round
 * has nobody to out-rank, so its one Player takes the full percentile share.
 */
export const roundScore = (placement: number, playerCount: number, qualified: boolean): number => {
  const percentile = playerCount <= 1 ? MAX_ROUND_SCORE : (1 - (placement - 1) / (playerCount - 1)) * MAX_ROUND_SCORE;
  return percentile + (qualified ? QUALIFICATION_SCORE_BONUS : 0);
};

/**
 * Total Score per Player across every Round played so far (ADR 0049) — a
 * pure fold, the same discipline `buildResults`/`qualificationPlacement`
 * already follow. A Player absent from a given Round's `rows` (never
 * connected to it, or DNF'd out of it) simply adds nothing for that Round —
 * the one mechanism a mid-Match disconnect and a spectator who joined after
 * the Match started both fall out of for free (ticket 08 relies on this;
 * this function doesn't need to know why a Player is missing from a Round).
 */
export const matchScore = (results: readonly RoundResult[]): Record<string, number> => {
  const totals: Record<string, number> = {};
  for (const result of results) {
    const playerCount = result.rows.length;
    for (const row of result.rows) {
      totals[row.id] = (totals[row.id] ?? 0) + roundScore(row.placement, playerCount, row.qualified);
    }
  }
  return totals;
};

/** One Player tied for the highest Match total (see {@link matchWinner}). */
export interface MatchWinner {
  id: string;
  score: number;
}

/**
 * Whoever has the highest total Score once the Match ends (ADR 0049), tied
 * broken by placement in the **last** Round played. Returns every Player
 * still tied after that tiebreak — length 1 in the ordinary case, but a
 * genuine tie is reported as one rather than silently resolved by object-key
 * iteration order.
 */
export const matchWinner = (results: readonly RoundResult[]): MatchWinner[] => {
  const totals = matchScore(results);
  const ids = Object.keys(totals);
  if (ids.length === 0) return [];

  const maxScore = Math.max(...ids.map((id) => totals[id]!));
  const contenders = ids.filter((id) => totals[id] === maxScore);
  if (contenders.length === 1) return [{ id: contenders[0]!, score: maxScore }];

  const lastRound = results[results.length - 1];
  const lastPlacement = new Map(lastRound?.rows.map((row) => [row.id, row.placement]) ?? []);
  const tiebreak = (id: string): number => lastPlacement.get(id) ?? Number.POSITIVE_INFINITY;

  const bestTiebreak = Math.min(...contenders.map(tiebreak));
  return contenders
    .filter((id) => tiebreak(id) === bestTiebreak)
    .sort()
    .map((id) => ({ id, score: maxScore }));
};

/** One Player's final standing in a finished Match — the results page's table row, best first. */
export interface MatchPlacement {
  id: string;
  score: number;
  placement: number;
}

/**
 * The whole Match ranked, best first (ADR 0049): totals are `matchScore`,
 * display order breaks total-ties by last-Round placement (then id, so the
 * order is deterministic), and placements share across equal totals with the
 * next one skipping — standard competition ranking, the same rule as every
 * other rank in the codebase. This is the exact derivation the results page
 * used to hand-roll over a fetched Match; the API's save now stores these
 * same placements per participant, so career history can never disagree with
 * the table the Player actually saw.
 */
export const matchPlacements = (results: readonly RoundResult[]): MatchPlacement[] => {
  const totals = matchScore(results);
  const lastRound = results[results.length - 1];
  const lastPlacement = new Map(lastRound?.rows.map((row) => [row.id, row.placement]) ?? []);
  const ordered = Object.keys(totals).sort((a, b) => {
    if (totals[b]! !== totals[a]!) return totals[b]! - totals[a]!;
    const delta = (lastPlacement.get(a) ?? Number.POSITIVE_INFINITY) - (lastPlacement.get(b) ?? Number.POSITIVE_INFINITY);
    return delta !== 0 ? delta : a.localeCompare(b);
  });
  const placements = rankWithTies(ordered, (prev, curr) => totals[prev] === totals[curr]);
  return ordered.map((id, i) => ({ id, score: totals[id]!, placement: placements[i]! }));
};
