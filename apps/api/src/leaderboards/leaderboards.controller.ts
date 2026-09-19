import type { FastifyInstance } from "fastify";
import type { ApiDb } from "../db/db.js";
import { bearerToken } from "../http/cookies.js";
import { whoAmI } from "../auth/auth.service.js";
import { getLeaderboard } from "./leaderboards.service.js";

/**
 * Leaderboard routes (ADR 0110) — thin by contract. Signed in, since every
 * board carries the caller's own row: `GET /leaderboards/wins`,
 * `GET /leaderboards/survival`, `GET /leaderboards/race/:trackId`.
 */
export const registerLeaderboardRoutes = (app: FastifyInstance, db: ApiDb): void => {
  app.get("/leaderboards/race/:trackId", async (request) => {
    const account = whoAmI(db, bearerToken(request.headers.authorization));
    const { trackId } = request.params as { trackId: string };
    return getLeaderboard(db, "race", account.id, trackId);
  });

  app.get("/leaderboards/:board", async (request) => {
    const account = whoAmI(db, bearerToken(request.headers.authorization));
    const { board } = request.params as { board: string };
    return getLeaderboard(db, board, account.id);
  });
};
