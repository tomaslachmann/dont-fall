import type { FastifyInstance, FastifyRequest } from "fastify";
import { whoAmI } from "../auth/auth.service.js";
import type { ApiDb } from "../db/db.js";
import { bearerToken } from "../http/cookies.js";
import { ServiceError } from "../http/errors.js";
import { listMutes, setMuted } from "./mutes.dao.js";

/**
 * Voice chat's one HTTP surface (ADR 0111): an Account's Mutes. Everything
 * else about voice travels its own socket.
 *
 * A write answers with the whole list and tells the relay at once, so the
 * Player stops hearing whoever they Muted without waiting for anything to
 * reconnect.
 */
export const registerVoiceRoutes = (
  app: FastifyInstance,
  db: ApiDb,
  onMutesChanged: (accountId: string, muted: readonly string[]) => void = () => {},
): void => {
  const me = (request: FastifyRequest): string => whoAmI(db, bearerToken(request.headers.authorization)).id;

  app.get("/voice/mutes", async (request) => ({ muted: listMutes(db, me(request)) }));

  app.put("/voice/mutes/:accountId", async (request) => {
    const { accountId } = request.params as { accountId: string };
    const { muted } = (request.body ?? {}) as { muted?: unknown };
    if (typeof muted !== "boolean") throw new ServiceError(400, "muted must be true or false");
    const accountIdOfCaller = me(request);
    const list = setMuted(db, accountIdOfCaller, accountId, muted);
    onMutesChanged(accountIdOfCaller, list);
    return { muted: list };
  });
};
