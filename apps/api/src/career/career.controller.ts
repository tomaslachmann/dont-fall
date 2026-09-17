import type { FastifyInstance } from "fastify";
import type { ApiDb } from "../db/db.js";
import { bearerToken } from "../http/cookies.js";
import { whoAmI } from "../auth/auth.service.js";
import { getCareer } from "./career.service.js";

/**
 * The career route — thin by contract: the Bearer [REDACTED] in, the whole
 * career out. `GET /career` is the Profile screen's one fetch (stats tiles,
 * badges, recent Matches); a career with no finished Matches is zeros and
 * an empty list, never a 404 — the screen renders zeros, not an error.
 */
export const registerCareerRoutes = (app: FastifyInstance, db: ApiDb): void => {
  app.get("/career", async (request) => {
    const account = whoAmI(db, bearerToken(request.headers.authorization));
    return getCareer(db, account.id);
  });
};
