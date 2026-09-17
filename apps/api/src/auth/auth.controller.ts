import type { FastifyInstance } from "fastify";
import type { ApiDb } from "../db/db.js";
import { bearerToken } from "../http/cookies.js";
import {
  beginDiscordLogin,
  finishDiscordLogin,
  linkPassword,
  loginWithPassword,
  logout,
  signupWithPassword,
  updateBindings,
  updateCosmetics,
  whoAmI,
  type DiscordOAuthConfig,
  type FetchLike,
} from "./auth.service.js";

export interface AuthRouteDeps {
  discord?: DiscordOAuthConfig;
  clientAppUrl: string;
  discordFetch: FetchLike;
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

  app.put("/auth/me/bindings", async (request, reply) => {
    const updated = updateBindings(
      db,
      bearerToken(request.headers.authorization),
      (request.body ?? {}) as Parameters<typeof updateBindings>[2],
    );
    return reply.code(200).send(updated);
  });

  app.post("/auth/logout", async (request, reply) => {
    logout(db, bearerToken(request.headers.authorization));
    return reply.code(204).send();
  });
};
