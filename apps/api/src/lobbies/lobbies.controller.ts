import type { FastifyInstance, FastifyRequest } from "fastify";
import type { LobbyPrivacy } from "@dont-fall/shared";
import type { ApiDb } from "../db/db.js";
import { bearerToken } from "../http/cookies.js";
import { getAccountBySessionToken } from "../auth/accounts.dao.js";
import { LobbyEntryLimit } from "./entryLimit.js";
import type { LobbiesService } from "./lobbies.service.js";

/**
 * Lobby routes (grilling session, 2026-09 / ADR 0054) — thin by contract:
 * parse, delegate, set the status. Registry rules, joinability, reaping,
 * match-server spawning and the Party-aware entries (ADR 0112) all live in
 * `lobbies.service.ts`.
 *
 * Every entry reads the caller's session when it sends one: signed in, the
 * caller's Party is seated with Reservations; anonymous (or an unknown
 * token), it enters as it always did, with none. Each one is rate limited
 * (`LobbyEntryLimit`), because seats reserved by a caller that never arrives
 * hold the Lobby's Start.
 */
export const registerLobbyRoutes = (app: FastifyInstance, lobbies: LobbiesService, db: ApiDb): void => {
  const entryLimit = new LobbyEntryLimit();
  const caller = (request: FastifyRequest): string | null => {
    const token = bearerToken(request.headers.authorization);
    return (token ? getAccountBySessionToken(db, token)?.id : undefined) ?? null;
  };
  /**
   * Who is entering, one of their entries spent (429 once they have none
   * left). A caller with no session is its connection: `raw.socket` is the
   * real one in production, and the request itself stands in where a test
   * injects without a socket, which is one connection per call.
   */
  const entering = (request: FastifyRequest): string | null => {
    const accountId = caller(request);
    entryLimit.take(accountId, request.raw.socket ?? request.raw);
    return accountId;
  };

  app.post("/lobbies", async (request, reply) => {
    const body = (request.body ?? {}) as { isPrivate?: unknown; matchLength?: unknown; privacy?: unknown };
    // ADR 0110: a private Lobby is set up where it is created — its ROUNDS and
    // WHO CAN JOIN, and who created it (whose friends a FRIENDS Lobby shows up for).
    const created = await lobbies.create(
      body.isPrivate === true,
      {
        ...(body.matchLength !== undefined ? { matchLength: body.matchLength as number } : {}),
        ...(body.privacy !== undefined ? { privacy: body.privacy as LobbyPrivacy } : {}),
      },
      entering(request),
    );
    return reply.code(201).send(created);
  });

  app.get("/lobbies", async () => lobbies.listPublic());

  // A POST, not a GET: resolving a Lobby by code or id now reserves seats (ADR 0112).
  app.post("/lobbies/join", async (request) => {
    const body = (request.body ?? {}) as { code?: unknown; lobbyId?: unknown };
    return lobbies.join(body, entering(request));
  });

  app.post("/lobbies/quick-match", async (request) => lobbies.quickMatch(entering(request)));
};
