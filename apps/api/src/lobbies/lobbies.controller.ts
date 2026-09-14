import type { FastifyInstance } from "fastify";
import type { LobbiesService } from "./lobbies.service.js";

/**
 * Lobby routes (grilling session, 2026-09 / ADR 0054) — thin by contract:
 * parse, delegate, set the status. Registry rules, joinability, reaping and
 * match-server spawning all live in `lobbies.service.ts`.
 */
export const registerLobbyRoutes = (app: FastifyInstance, lobbies: LobbiesService): void => {
  app.post("/lobbies", async (request, reply) => {
    const body = (request.body ?? {}) as { isPrivate?: unknown };
    const entry = await lobbies.createLobby(body.isPrivate === true);
    return reply.code(201).send({ id: entry.id, port: entry.port, code: entry.code ?? null, isPrivate: entry.isPrivate });
  });

  app.get("/lobbies", async () => lobbies.listPublic());

  app.get("/lobbies/code/:code", async (request) => {
    const { code } = request.params as { code: string };
    return lobbies.lobbyByCode(code);
  });

  app.get("/lobbies/:id", async (request) => {
    const { id } = request.params as { id: string };
    return lobbies.lobbyById(id);
  });

  app.post("/lobbies/quick-match", async () => lobbies.quickMatch());
};
