import type { FastifyInstance } from "fastify";
import type { ApiDb } from "../db/db.js";
import { bearerToken } from "../http/cookies.js";
import { ServiceError } from "../http/errors.js";
import { whoAmI } from "../auth/auth.service.js";
import { getBettingState, openBettingRound, placeBet, settleBettingRound } from "./bets.service.js";

/**
 * Betting routes — thin by contract, split by caller the same way the
 * secrets split:
 *
 * - Players (Bearer [REDACTED] `POST /bets` stakes beans on one runner;
 *   `GET /bets/:matchId/:round` reads the board, live pools/odds and the
 *   ticker for the Spectator panel's poll.
 * - The match server (`X-Service-Token`, the `SERVICE_TOKEN` env both sides
 *   share) opens each Round when its Countdown starts and settles it when
 *   the Round ends. No token configured — or the wrong one — and both
 *   calls are refused: betting stays closed rather than running unauthenticated.
 */
export const registerBetsRoutes = (app: FastifyInstance, db: ApiDb, serviceToken: string | undefined): void => {
  const requireServiceToken = (token: unknown): void => {
    if (typeof serviceToken !== "string" || serviceToken.length === 0 || token !== serviceToken) {
      throw new ServiceError(403, "match servers only");
    }
  };

  app.post("/bets/rounds/open", async (request, reply) => {
    requireServiceToken(request.headers["x-service-token"]);
    const body = (request.body ?? {}) as { matchId?: unknown; round?: unknown; closesAtMs?: unknown; runners?: unknown };
    return reply
      .code(200)
      .send(openBettingRound(db, body as { matchId: string; round: number; closesAtMs: number; runners: [] }));
  });

  app.post("/bets/rounds/settle", async (request, reply) => {
    requireServiceToken(request.headers["x-service-token"]);
    const body = (request.body ?? {}) as { matchId?: unknown; round?: unknown; winnerIds?: unknown };
    return reply
      .code(200)
      .send(settleBettingRound(db, body as { matchId: string; round: number; winnerIds: string[] }, Date.now()));
  });

  app.post("/bets", async (request, reply) => {
    const account = whoAmI(db, bearerToken(request.headers.authorization));
    const body = (request.body ?? {}) as { matchId?: unknown; round?: unknown; targetId?: unknown; amount?: unknown };
    return reply
      .code(201)
      .send(
        placeBet(
          db,
          account,
          body as { matchId: string; round: number; targetId: string; amount: number },
          Date.now(),
        ),
      );
  });

  app.get("/bets/:matchId/:round", async (request) => {
    whoAmI(db, bearerToken(request.headers.authorization));
    const { matchId, round } = request.params as { matchId: string; round: string };
    return getBettingState(db, matchId, Number(round), Date.now());
  });
};
