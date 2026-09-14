import type { FastifyInstance } from "fastify";
import type { ApiDb } from "../db/db.js";
import { ServiceError } from "../http/errors.js";
import { fetchAnyTrack, fetchTrack, generateTrack, listAllTracks, publishTrack, recordPlay } from "./tracks.service.js";

/**
 * Track routes (ADR 0028/0032/0038/0041) — thin by contract: extract, call
 * the service, set the status. Every domain opinion (validation messages,
 * revision pinning, defaults) lives in `tracks.service.ts`, never here.
 *
 * Split by caller the same way the bets/matches routes split: players read
 * and publish Tracks unauthenticated, while the match server's Round-start
 * play report (`POST /internal/tracks/:id/played`, M9 ticket 16) needs the
 * service token — play counts feed TRENDING, so anyone could stuff the
 * ballot otherwise.
 */
export const registerTrackRoutes = (app: FastifyInstance, db: ApiDb, serviceToken: string | undefined): void => {
  app.get("/tracks", async () => listAllTracks(db));

  app.post("/internal/tracks/:id/played", async (request, reply) => {
    const token = request.headers["x-service-token"];
    if (typeof serviceToken !== "string" || serviceToken.length === 0 || token !== serviceToken) {
      throw new ServiceError(403, "match servers only");
    }
    const { id } = request.params as { id: string };
    return reply.code(200).send(recordPlay(db, id));
  });

  app.post("/tracks", async (request, reply) => {
    const saved = publishTrack(db, (request.body ?? {}) as Parameters<typeof publishTrack>[1]);
    return reply.code(201).send(saved);
  });

  app.post("/tracks/generate", async (request, reply) => {
    const generated = generateTrack(db, (request.body ?? {}) as { name?: unknown; count?: unknown });
    return reply.code(201).send(generated);
  });

  app.get("/tracks/any", async () => fetchAnyTrack(db));

  app.get("/tracks/:id", async (request) => {
    const { id } = request.params as { id: string };
    const { revision } = request.query as { revision?: string | string[] };
    return fetchTrack(db, id, revision);
  });
};
