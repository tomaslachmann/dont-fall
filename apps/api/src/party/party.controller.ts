import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ApiDb } from "../db/db.js";
import { bearerToken } from "../http/cookies.js";
import { whoAmI } from "../auth/auth.service.js";
import type { PresenceSource } from "../friends/friends.service.js";
import type { PartiesService } from "./parties.service.js";
import { inviteToParty, joinPartyByCode, lookupPartyCode, partyCandidates } from "./party.service.js";

/**
 * Party routes (ADR 0112) — thin by contract: authenticate, delegate, set
 * the status. Every route needs a session (`whoAmI` 401s without one); the
 * rules live in `PartiesService`, the rows around it in `party.service.ts`.
 * The routes only act — what changed reaches every member over its Account
 * socket.
 */
export const registerPartyRoutes = (app: FastifyInstance, db: ApiDb, parties: PartiesService, presence: PresenceSource): void => {
  const me = (request: FastifyRequest): string => whoAmI(db, bearerToken(request.headers.authorization)).id;

  app.get("/party/candidates", async (request) => partyCandidates(db, parties, presence, me(request)));

  app.get("/party/lookup/:code", async (request) => {
    const { code } = request.params as { code: string };
    return lookupPartyCode(db, parties, me(request), code);
  });

  app.post("/party/invites", async (request, reply) => {
    const body = (request.body ?? {}) as { accountId?: unknown; code?: unknown };
    return reply.code(201).send(inviteToParty(db, parties, me(request), body));
  });

  app.delete("/party/invites/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    parties.cancelInvite(me(request), id);
    return reply.code(204).send();
  });

  app.post("/party/invites/:id/accept", async (request) => {
    const { id } = request.params as { id: string };
    return parties.acceptInvite(me(request), id);
  });

  app.post("/party/invites/:id/decline", async (request, reply) => {
    const { id } = request.params as { id: string };
    parties.declineInvite(me(request), id);
    return reply.code(204).send();
  });

  app.post("/party/join", async (request) => {
    const body = (request.body ?? {}) as { code?: unknown };
    return joinPartyByCode(parties, me(request), body);
  });

  app.post("/party/leave", async (request, reply) => {
    parties.leave(me(request));
    return reply.code(204).send();
  });

  app.delete("/party/members/:accountId", async (request, reply) => {
    const { accountId } = request.params as { accountId: string };
    parties.remove(me(request), accountId);
    return reply.code(204).send();
  });
};
