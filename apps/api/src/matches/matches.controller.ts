import type { FastifyInstance } from "fastify";
import type { ApiDb } from "../db/db.js";
import { bearerToken } from "../http/cookies.js";
import { ServiceError } from "../http/errors.js";
import { whoAmI } from "../auth/auth.service.js";
import { getMatchResult, saveMatchResult } from "./matches.service.js";

/**
 * Match-results routes (ADR 0059) — thin by contract, split by caller the
 * same way the secrets split (the bets routes' own posture):
 *
 * - The match server (`X-Service-Token`) saves each Match once, at its
 *   terminal RESULTS: `POST /internal/match-results`.
 * - Players (Bearer [REDACTED] the finished Match back for the results page:
 *   `GET /matches/:id`. Any account may read any finished Match — results
 *   aren't secret, and the id is unguessable.
 */
export const registerMatchesRoutes = (app: FastifyInstance, db: ApiDb, serviceToken: string | undefined): void => {
  const requireServiceToken = (token: unknown): void => {
    if (typeof serviceToken !== "string" || serviceToken.length === 0 || token !== serviceToken) {
      throw new ServiceError(403, "match servers only");
    }
  };

  app.post("/internal/match-results", async (request, reply) => {
    requireServiceToken(request.headers["x-service-token"]);
    return reply.code(200).send(saveMatchResult(db, request.body ?? {}));
  });

  app.get("/matches/:id", async (request) => {
    whoAmI(db, bearerToken(request.headers.authorization));
    const { id } = request.params as { id: string };
    return getMatchResult(db, id);
  });
};
