import type { LobbyPlayer } from "./Lobby.js";

/**
 * One row of a Results Screen (M4 ticket 08, CONTEXT.md "Results"): a
 * Qualified Character, an Eliminated one, or a Player who DNF'd.
 */
export interface ResultsRow {
  id: string;
  nickname: string;
  qualified: boolean;
  /** 1-based competition ranking among Qualified rows (ties share, the next skips); `null` for everyone else. */
  placement: number | null;
  checkpointIndex: number | null;
  fallCount: number;
  /** Disconnected mid-Round rather than merely not Qualifying (M4 ticket 05) — a different kind of row, not a worse rank. */
  dnf: boolean;
}

/** The slice of a Character's state a Results row is built from. */
export interface ResultsCharacter {
  finishTick: number | null;
  checkpointIndex: number | null;
  fallCount: number;
}

/**
 * A Player who dropped mid-Round (M4 ticket 05) — their `LobbyPlayer` entry
 * is deleted with their socket, so this is what still says who they were.
 *
 * Their Character may or may not still be in `characters`: since M5 ticket 04
 * a drop *during* a Round marks it eliminated and leaves it in the world (ADR
 * 0042), while a drop outside one still removes it. {@link buildResults}
 * handles both, and never lists the same Player twice.
 */
export interface DnfEntry {
  id: string;
  nickname: string;
}

/**
 * Ranks a Round's outcome for the Results Screen (CONTEXT.md: "rank with
 * Qualified ordered by finish time and the rest by Track progress, and a way
 * back to the Lobby"):
 *
 * 1. Every Qualified Character, earliest finish Tick first — standard
 *    competition ranking, the same convention `qualificationPlacement`
 *    already uses client-side: a tie shares a placement and the next one
 *    skips, rather than inventing a tie-break the simulation doesn't have
 *    (a Finish Zone is an area, not a line).
 * 2. Everyone still connected but not Qualified, furthest Checkpoint
 *    progress first.
 * 3. Everyone who DNF'd (M4 ticket 05) — always last, and unranked: leaving
 *    is not a result to place among the ones that were played out. Where
 *    their Character is still in the world (M5 ticket 04), the row carries
 *    the progress it actually made rather than blanks.
 *
 * A Player appears exactly once. A drop mid-Round now leaves an eliminated
 * Character behind (M5 ticket 04) as well as a DNF entry, and the DNF row is
 * the truthful one — except where they had already Qualified before dropping,
 * which is a result they earned and keep.
 *
 * A pure projection of state both sides already have on the wire (ADR
 * 0040): nothing new rides the snapshot for this, the same discipline
 * `isEliminated` already follows.
 */
export const buildResults = (
  characters: Record<string, ResultsCharacter>,
  players: readonly LobbyPlayer[],
  dnfEntries: readonly DnfEntry[],
): ResultsRow[] => {
  const nicknames = new Map(players.map((p) => [p.id, p.nickname]));
  const nicknameFor = (id: string): string => nicknames.get(id) ?? "Player";

  const qualified = Object.entries(characters)
    .filter(([, c]) => c.finishTick !== null)
    .sort(([, a], [, b]) => a.finishTick! - b.finishTick!);

  let lastTick: number | null = null;
  let lastPlacement = 0;
  const qualifiedRows: ResultsRow[] = qualified.map(([id, c], index) => {
    if (c.finishTick !== lastTick) {
      lastPlacement = index + 1;
      lastTick = c.finishTick;
    }
    return {
      id,
      nickname: nicknameFor(id),
      qualified: true,
      placement: lastPlacement,
      checkpointIndex: c.checkpointIndex,
      fallCount: c.fallCount,
      dnf: false,
    };
  });

  const dnfIds = new Set(dnfEntries.map((entry) => entry.id));
  const qualifiedIds = new Set(qualifiedRows.map((row) => row.id));

  const eliminatedRows: ResultsRow[] = Object.entries(characters)
    .filter(([id, c]) => c.finishTick === null && !dnfIds.has(id))
    .sort(([, a], [, b]) => (b.checkpointIndex ?? -1) - (a.checkpointIndex ?? -1))
    .map(([id, c]) => ({
      id,
      nickname: nicknameFor(id),
      qualified: false,
      placement: null,
      checkpointIndex: c.checkpointIndex,
      fallCount: c.fallCount,
      dnf: false,
    }));

  const dnfRows: ResultsRow[] = dnfEntries
    .filter((entry) => !qualifiedIds.has(entry.id))
    .map((entry) => {
      const character = characters[entry.id];
      return {
        id: entry.id,
        nickname: entry.nickname,
        qualified: false,
        placement: null,
        checkpointIndex: character?.checkpointIndex ?? null,
        fallCount: character?.fallCount ?? 0,
        dnf: true,
      };
    });

  return [...qualifiedRows, ...eliminatedRows, ...dnfRows];
};
