import type { FastifyInstance } from "fastify";
import type { ApiDb } from "../db/db.js";
import { bearerToken } from "../http/cookies.js";
import { ServiceError } from "../http/errors.js";
import { whoAmI } from "../auth/auth.service.js";
import { readPersonalBest, recordPersonalBests } from "./personalBests.service.js";

/**
 * Personal Best routes (ADR 0088) — thin by contract, split by caller the way
 * the match-results routes split:
 *
 * - The match server (`X-Service-Token`) reports a Race Round's finished runs:
 *   `POST /internal/personal-bests`. A run's time is only as honest as its
 *   reporter, so nobody else may write one.
 * - A Player (Bearer [REDACTED] reads their own record on a Track for the Race HUD:
 *   `GET /tracks/:id/personal-best`.
 */
export const registerPersonalBestRoutes = (app: FastifyInstance, db: ApiDb, serviceToken: string | undefined): void => {
  app.post("/internal/personal-bests", async (request, reply) => {
    const token = request.headers["x-service-token"];
    if (typeof serviceToken !== "string" || serviceToken.length === 0 || token !== serviceToken) {
      throw new ServiceError(403, "match servers only");
    }
    return reply.code(200).send(recordPersonalBests(db, request.body ?? {}));
  });

  app.get("/tracks/:id/personal-best", async (request) => {
    const account = whoAmI(db, bearerToken(request.headers.authorization));
    const { id } = request.params as { id: string };
    return readPersonalBest(db, account.id, id);
  });
};
