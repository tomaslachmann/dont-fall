import type { FastifyInstance } from "fastify";
import type { ApiDb } from "../db/db.js";
import { bearerToken } from "../http/cookies.js";
import { ServiceError } from "../http/errors.js";
import { getAccountBySessionToken } from "../auth/accounts.dao.js";
import { lookUpClientError, reportClientError } from "./clientErrors.service.js";

/**
 * Client-error routes (ADR 0110) — thin by contract:
 *
 * - The error screen (anyone, signed in or not — a crash can come before
 *   sign-in) files a report: `POST /client-errors`. A Bearer [REDACTED] when there
 *   is a valid one, attaches the Account; a missing or dead one is no reason
 *   to lose the report.
 * - Support reads one back by its code with the service token:
 *   `GET /internal/client-errors/:code`.
 */
export const registerClientErrorRoutes = (app: FastifyInstance, db: ApiDb, serviceToken: string | undefined): void => {
  app.post("/client-errors", async (request, reply) => {
    const token = bearerToken(request.headers.authorization);
    const account = token ? getAccountBySessionToken(db, token) : undefined;
    return reply.code(201).send(reportClientError(db, request.body ?? {}, account?.id ?? null, Date.now()));
  });

  app.get("/internal/client-errors/:code", async (request) => {
    const token = request.headers["x-service-token"];
    if (typeof serviceToken !== "string" || serviceToken.length === 0 || token !== serviceToken) {
      throw new ServiceError(403, "support only");
    }
    const { code } = request.params as { code: string };
    return lookUpClientError(db, code);
  });
};
