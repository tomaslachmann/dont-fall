import type { FastifyInstance } from "fastify";
import type { ApiDb } from "../db/db.js";
import { bearerToken } from "../http/cookies.js";
import { whoAmI } from "../auth/auth.service.js";
import { claimMatchRewards, getRewardsBalance } from "./rewards.service.js";

/**
 * Rewards routes — thin by contract: the Bearer [REDACTED] in, the service out.
 * `POST /rewards/claim` banks one Match, idempotent per `matchId` (ADR 0059 —
 * a replay returns the stored numbers, never a second credit);
 * `GET /rewards/me` reads lifetime totals for anywhere else that wants a
 * level or a coin count.
 */
export const registerRewardsRoutes = (app: FastifyInstance, db: ApiDb): void => {
  app.post("/rewards/claim", async (request, reply) => {
    const account = whoAmI(db, bearerToken(request.headers.authorization));
    return reply.code(200).send(claimMatchRewards(db, account.id, request.body ?? {}));
  });

  app.get("/rewards/me", async (request) => {
    const account = whoAmI(db, bearerToken(request.headers.authorization));
    return getRewardsBalance(db, account.id);
  });
};
