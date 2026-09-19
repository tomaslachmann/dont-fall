import { LEADERBOARD_SIZE, rankWithTies, type Leaderboard, type LeaderboardBoard, type LeaderboardRow } from "@dont-fall/shared";
import type { ApiDb } from "../db/db.js";
import { ServiceError } from "../http/errors.js";
import { boardAccounts, raceBoard, survivalBoard, winsBoard, type BoardEntry } from "./leaderboards.dao.js";

/**
 * A board, best first, as the Leaderboards screen reads it (ADR 0110): the
 * top `LEADERBOARD_SIZE`, ranked with ties shared, and the caller's own row
 * wherever it lands. The whole board is read to rank the caller — at this
 * project's scale a full scan is the established pattern.
 */
const toBoard = (
  db: ApiDb,
  board: LeaderboardBoard,
  entries: BoardEntry[],
  callerId: string,
  trackId?: string,
): Leaderboard => {
  const ranks = rankWithTies(entries, (prev, curr) => prev.value === curr.value);
  const mine = entries.findIndex((entry) => entry.accountId === callerId);
  const shown = entries.slice(0, LEADERBOARD_SIZE);
  const named = boardAccounts(db, [...shown.map((entry) => entry.accountId), callerId]);
  const row = (entry: BoardEntry, index: number): LeaderboardRow => ({
    rank: ranks[index]!,
    accountId: entry.accountId,
    displayName: named.get(entry.accountId)?.displayName ?? "Player",
    color: named.get(entry.accountId)?.color ?? 0,
    value: entry.value,
  });
  return {
    board,
    ...(trackId === undefined ? {} : { trackId }),
    rows: shown.map(row),
    you: mine === -1 ? null : row(entries[mine]!, mine),
  };
};

export const getLeaderboard = (db: ApiDb, board: string, callerId: string, trackId?: string): Leaderboard => {
  switch (board) {
    case "wins":
      return toBoard(db, "wins", winsBoard(db), callerId);
    case "survival":
      return toBoard(db, "survival", survivalBoard(db), callerId);
    case "race":
      if (!trackId) throw new ServiceError(400, "the Race board needs a Track");
      return toBoard(db, "race", raceBoard(db, trackId), callerId, trackId);
    default:
      throw new ServiceError(404, `no board "${board}"`);
  }
};
