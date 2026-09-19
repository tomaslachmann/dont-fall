import type { Leaderboard, LeaderboardBoard } from "@dont-fall/shared";
import { apiGet } from "./base.js";

/** One board (ADR 0110) — the Race board names its Track. */
export const fetchLeaderboard = (board: LeaderboardBoard, trackId?: string): Promise<Leaderboard> =>
  apiGet<Leaderboard>(board === "race" ? `/leaderboards/race/${encodeURIComponent(trackId ?? "")}` : `/leaderboards/${board}`);
