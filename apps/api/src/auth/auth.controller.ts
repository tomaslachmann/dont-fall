import type { FastifyInstance } from "fastify";
import { AVATAR_MIME } from "@dont-fall/shared";
import type { ApiDb } from "../db/db.js";
import { bearerToken } from "../http/cookies.js";
import { getAccountAvatar } from "./accounts.dao.js";
import {
  beginDiscordLogin,
  finishDiscordLogin,
  linkPassword,
  loginWithPassword,
  logout,
  removeAvatar,
  signupWithPassword,
  updateBindings,
  updateCosmetics,
  uploadAvatar,
  whoAmI,
  type DiscordOAuthConfig,
  type FetchLike,
} from "./auth.service.js";

export interface AuthRouteDeps {
  discord?: DiscordOAuthConfig;
  clientAppUrl: string;
  discordFetch: FetchLike;
  /** An Account just signed out — its Account socket goes with the session (ADR 0112). Absent in suites with no sockets. */
  onSignOut?: (accountId: string) => void;
}

/** First of a repeated query param wins — mirrors `URLSearchParams.get`, so `?code=a&code=b` reads `a` on both stacks. */
const firstQuery = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

/**
 * Account routes (ADR 0052/0053) — thin by contract: cookies/headers in,
 * service out, status+body/redirect back. The OAuth dance, validation
 * messages, and session rules live in `auth.service.ts`.
 */
export const registerAuthRoutes = (app: FastifyInstance, db: ApiDb, deps: AuthRouteDeps): void => {
  app.get("/auth/discord/authorize", async (request, reply) => {
    const { authorizeUrl, setCookies } = beginDiscordLogin(db, deps.discord, bearerToken(request.headers.authorization));
    return reply.header("Set-Cookie", setCookies).redirect(authorizeUrl);
  });

  app.get("/auth/discord/callback", async (request, reply) => {
    const query = request.query as { code?: string | string[]; state?: string | string[] };
    const result = await finishDiscordLogin(
      db,
      deps.discord,
      deps.clientAppUrl,
      { code: firstQuery(query.code), state: firstQuery(query.state), cookieHeader: request.headers.cookie },
      deps.discordFetch,
    );
    return reply.header("Set-Cookie", result.setCookies).redirect(result.location);
  });

  app.post("/auth/signup", async (request, reply) => {
    const { account, token } = signupWithPassword(db, (request.body ?? {}) as Parameters<typeof signupWithPassword>[1]);
    return reply.code(201).send({ account, token });
  });

  app.post("/auth/login", async (request, reply) => {
    const { account, token } = loginWithPassword(db, (request.body ?? {}) as Parameters<typeof loginWithPassword>[1]);
    return reply.code(200).send({ account, token });
  });

  app.post("/auth/link/password", async (request, reply) => {
    const linked = linkPassword(
      db,
      bearerToken(request.headers.authorization),
      (request.body ?? {}) as Parameters<typeof linkPassword>[2],
    );
    return reply.code(200).send(linked);
  });

  // Mandatory-login gate (ADR 0052): every other app entry point calls this
  // to check the Bearer [REDACTED] it's holding. 401, not a redirect — this is a
  // JSON API; the client owns navigating to `/auth` on a 401.
  app.get("/auth/me", async (request) => whoAmI(db, bearerToken(request.headers.authorization)));

  app.put("/auth/me/cosmetics", async (request, reply) => {
    const updated = updateCosmetics(
      db,
      bearerToken(request.headers.authorization),
      (request.body ?? {}) as Parameters<typeof updateCosmetics>[2],
    );
    return reply.code(200).send(updated);
  });

  // ADR 0110: the caller's own avatar. The body is JSON (`{ image }`, a WebP
  // data URL), the same shape a Track Thumbnail is sent in.
  app.put("/auth/me/avatar", async (request, reply) => {
    const updated = uploadAvatar(
      db,
      bearerToken(request.headers.authorization),
      (request.body ?? {}) as { image?: unknown },
      Date.now(),
    );
    return reply.code(200).send(updated);
  });

  app.delete("/auth/me/avatar", async (request, reply) => {
    return reply.code(200).send(removeAvatar(db, bearerToken(request.headers.authorization)));
  });

  // Every Account's picture at one address (ADR 0110): the upload, else a
  // redirect to its Discord picture, else 404 — which the client answers with
  // the bean-coloured disc. Public: an avatar is shown to everyone in a Lobby.
  // A versioned read (`?v=` the upload time) never changes, so it caches for
  // good; an unversioned one is someone else's, and may change within a minute.
  app.get("/avatars/:accountId", async (request, reply) => {
    const { accountId } = request.params as { accountId: string };
    const { v } = request.query as { v?: string };
    const avatar = getAccountAvatar(db, accountId);
    if (avatar && "image" in avatar) {
      const versioned = v !== undefined && Number(v) === avatar.updatedAt;
      reply.header("Cache-Control", versioned ? "public, max-age=31536000, immutable" : "public, max-age=60");
      return reply.type(AVATAR_MIME).send(avatar.image);
    }
    reply.header("Cache-Control", "public, max-age=60");
    if (avatar && "discordUrl" in avatar) return reply.redirect(avatar.discordUrl, 302);
    return reply.code(404).send({ error: "no avatar" });
  });

  app.put("/auth/me/bindings", async (request, reply) => {
    const updated = updateBindings(
      db,
      bearerToken(request.headers.authorization),
      (request.body ?? {}) as Parameters<typeof updateBindings>[2],
    );
    return reply.code(200).send(updated);
  });

  app.post("/auth/logout", async (request, reply) => {
    const signedOut = logout(db, bearerToken(request.headers.authorization));
    // The session is gone, so the Account socket it authenticated goes too,
    // rather than living on until the next beat's re-check (ADR 0112).
    if (signedOut !== undefined) deps.onSignOut?.(signedOut);
    return reply.code(204).send();
  });
};
