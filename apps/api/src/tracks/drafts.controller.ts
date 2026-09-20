import type { FastifyInstance } from "fastify";
import type { ApiDb } from "../db/db.js";
import {
  createDraft,
  discardDraft,
  fetchDraft,
  listAllDrafts,
  patchDraft,
  replaceDraftTrack,
} from "./drafts.service.js";

/**
 * Draft routes (ADR 0114) — thin by the same contract as the track routes:
 * extract, call the service, set the status. Unauthenticated like tracks:
 * drafts are a local authoring tool, and nothing here touches published
 * Revisions (only `POST /tracks` does that, by copying a draft's fields).
 */
export const registerDraftRoutes = (app: FastifyInstance, db: ApiDb): void => {
  app.get("/drafts", async () => listAllDrafts(db));

  app.post("/drafts", async (request, reply) => {
    const saved = createDraft(db, (request.body ?? {}) as Parameters<typeof createDraft>[1]);
    return reply.code(201).send(saved);
  });

  app.get("/drafts/:id", async (request) => {
    const { id } = request.params as { id: string };
    return fetchDraft(db, id);
  });

  app.put("/drafts/:id/segments", async (request) => {
    const { id } = request.params as { id: string };
    const { track } = (request.body ?? {}) as { track?: unknown };
    return replaceDraftTrack(db, id, track);
  });

  app.patch("/drafts/:id", async (request) => {
    const { id } = request.params as { id: string };
    return patchDraft(db, id, (request.body ?? {}) as Parameters<typeof patchDraft>[2]);
  });

  app.delete("/drafts/:id", async (request) => {
    const { id } = request.params as { id: string };
    return discardDraft(db, id);
  });
};
