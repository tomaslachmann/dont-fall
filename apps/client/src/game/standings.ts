import { matchScore, rankWithTies, type SnapshotMessage } from "@dont-fall/shared";
import type { StandingsRow } from "./types.js";

/**
 * The Standings table for one RESULTS snapshot (M7 ticket 06, ADR 0110) —
 * pure, so the Round-over-Round arithmetic is pinned without a socket.
 *
 * `matchScore` (packages/shared, ADR 0049) is the only place Score arithmetic
 * lives — this only lays it out. Every row covers a Player who scored in some
 * Round or is connected now (a joiner who has not raced yet still lists, at
 * 0); `gone` is M7 ticket 08's contract: scored, and absent from
 * `lobby.players` now. `gained` and `previousPlacement` measure against the
 * Standings before the Round that just ended, both folds over the server's
 * own `roundResults`.
 */
export const standingsRows = (
  message: Pick<SnapshotMessage, "roundResults" | "standingsReady"> & { lobby: { players: readonly { id: string }[] } },
  nicknameOf: (id: string) => string,
): StandingsRow[] => {
  const totals = matchScore(message.roundResults);
  const earlierTotals = matchScore(message.roundResults.slice(0, -1));
  const earlierOrder = Object.keys(earlierTotals).sort((a, b) => earlierTotals[b]! - earlierTotals[a]! || a.localeCompare(b));
  const earlierRanks = rankWithTies(earlierOrder, (prev, curr) => earlierTotals[prev] === earlierTotals[curr]);
  const previousPlacement = new Map(earlierOrder.map((id, i) => [id, earlierRanks[i]!]));
  const connectedIds = new Set(message.lobby.players.map((player) => player.id));
  const confirmedIds = new Set(message.standingsReady);
  const rowIds = new Set([...Object.keys(totals), ...connectedIds]);
  const unranked = Array.from(rowIds, (id) => ({
    id,
    nickname: nicknameOf(id),
    score: totals[id] ?? 0,
    gone: !connectedIds.has(id),
    confirmed: confirmedIds.has(id),
    gained: (totals[id] ?? 0) - (earlierTotals[id] ?? 0),
    previousPlacement: previousPlacement.get(id) ?? null,
  })).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const placements = rankWithTies(unranked, (prev, curr) => prev.score === curr.score);
  return unranked.map((row, i) => ({ ...row, placement: placements[i]! }));
};

/**
 * A deadline on the server's clock, moved onto this page's `Date.now()` clock
 * through the synced offset (ADR 0019, 0110). `null` without a deadline, or
 * before time sync has settled (`serverNowMs === null`): no number beats a
 * wrong one.
 */
export const localDeadline = (
  serverDeadlineMs: number | null,
  serverNowMs: number | null,
  dateNowMs: number,
): number | null => (serverDeadlineMs === null || serverNowMs === null ? null : dateNowMs + (serverDeadlineMs - serverNowMs));
