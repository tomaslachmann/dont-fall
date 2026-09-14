import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ApiDb } from "../db/db.js";
import { bearerToken } from "../http/cookies.js";
import { whoAmI } from "../auth/auth.service.js";
import type { LobbiesService } from "../lobbies/lobbies.service.js";
import {
  acceptAllFriendRequests,
  acceptFriendRequest,
  declineFriendRequest,
  friendRequests,
  friendsOverview,
  heartbeat,
  inviteFriend,
  ownFriendCode,
  recentPlayers,
  sendFriendRequest,
  unfriend,
  type FriendsEnv,
  type PresenceSource,
} from "./friends.service.js";

/**
 * The broker as a presence source (M9 ticket 12): every tracked Lobby with a
 * live status becomes one seat — its occupancy/phase plus every authed
 * Account sitting in it. Private entries always carry a join code
 * (registry-constructed); the fallback only keeps the type honest.
 */
export const brokerPresenceSource = (lobbies: LobbiesService): PresenceSource => ({
  liveSeats: async () =>
    (await lobbies.liveSeats()).map(({ entry, status }) => ({
      lobbyId: entry.id,
      phase: status.phase,
      round: status.round,
      playerCount: status.playerCount,
      maxPlayers: status.maxPlayers,
      ...(entry.isPrivate
        ? { isPrivate: true as const, code: entry.code ?? "" }
        : { isPrivate: false as const }),
      accountIds: status.accounts,
    })),
});

/**
 * Friends routes (M9 ticket 12) — thin by contract: authenticate, delegate,
 * set the status. Every route needs a Bearer [REDACTED] (`whoAmI` 401s without one);
 * request/invite/presence rules all live in `friends.service.ts`.
 */
export const registerFriendsRoutes = (app: FastifyInstance, db: ApiDb, lobbies: LobbiesService): void => {
  const env: FriendsEnv = { presence: brokerPresenceSource(lobbies) };
  const me = (request: FastifyRequest): string => whoAmI(db, bearerToken(request.headers.authorization)).id;

  app.get("/friends", async (request) => friendsOverview(db, env, me(request)));

  app.get("/friends/code", async (request) => ownFriendCode(db, me(request)));

  app.get("/friends/requests", async (request) => friendRequests(db, me(request)));

  app.get("/friends/recent", async (request) => recentPlayers(db, me(request)));

  app.post("/friends/heartbeat", async (request) => heartbeat(db, env, me(request)));

  app.post("/friends/requests", async (request, reply) => {
    const body = (request.body ?? {}) as { accountId?: unknown; code?: unknown };
    return reply.code(201).send(sendFriendRequest(db, env, me(request), body));
  });

  app.post("/friends/requests/accept-all", async (request) => acceptAllFriendRequests(db, env, me(request)));

  app.post("/friends/requests/:id/accept", async (request) => {
    const { id } = request.params as { id: string };
    return acceptFriendRequest(db, env, me(request), id);
  });

  app.post("/friends/requests/:id/decline", async (request) => {
    const { id } = request.params as { id: string };
    return declineFriendRequest(db, me(request), id);
  });

  app.post("/friends/invite", async (request, reply) => {
    const body = (request.body ?? {}) as { accountId?: unknown; lobby?: unknown };
    return reply.code(201).send(inviteFriend(db, env, me(request), body));
  });

  app.delete("/friends/:accountId", async (request) => {
    const { accountId } = request.params as { accountId: string };
    return unfriend(db, me(request), accountId);
  });
};
