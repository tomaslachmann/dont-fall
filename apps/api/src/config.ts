import { DEFAULT_API_PORT } from "@dont-fall/shared";
import { defaultAssetsDir } from "./assets/assets.service.js";
import type { DiscordOAuthConfig, FetchLike } from "./auth/auth.service.js";
import type { PortRange } from "@dont-fall/server";
import { LobbiesService, resolveMaxPlayers, type LobbiesDeps } from "./lobbies/lobbies.service.js";

export interface ApiConfig {
  /** Port to listen on. Defaults to {@link DEFAULT_API_PORT}. */
  port: number;
  /** Interface to bind. Defaults to all interfaces (Docker needs it; the old `node:http` services bound it implicitly). */
  host: string;
  /** SQLite file path. Defaults to `./data/track-service.sqlite` — the same file as before, so existing dev data survives the merge. */
  dbPath: string;
  /** Module art dir. Defaults to the repo's `assets/` (Docker: `/app/assets` via `TRACK_ASSETS_DIR` + a COPY). */
  assetsDir: string;
  /** Discord app credentials. Defaults to `DISCORD_CLIENT_ID`/`DISCORD_CLIENT_SECRET`/`DISCORD_REDIRECT_URI` env vars. */
  discord?: DiscordOAuthConfig;
  /** Where the browser lands after login. Defaults to `PUBLIC_CLIENT_URL` env var, else `http://localhost:5173`. */
  clientAppUrl: string;
  /** Test-only seam: injects a fake Discord instead of the real network. */
  discordFetch: FetchLike;
  /** This API's own origin, handed to every Lobby it starts (they fetch Tracks from it). */
  apiUrl: string;
  maxPlayers: number;
  /**
   * The match-server service token (ticket 14) — `SERVICE_TOKEN` env, shared
   * with every match server (same process in the broker, same env for a
   * standalone one). Expected on the betting open/settle calls; unset means
   * those calls are refused and betting stays closed.
   */
  serviceToken?: string;
  /**
   * Bind in-process Match servers inside this port range instead of
   * OS-ephemeral ports. Set in Docker (`LOBBY_PORT_MIN`/`LOBBY_PORT_MAX`,
   * matching the compose-published range — the browser can only dial
   * published ports). Absent locally, where ephemeral ports just work.
   */
  matchPortRange?: PortRange;
  /** Lobbies test seams (reaper cadences, match-server/status doubles). Absent in production. */
  lobbies?: Pick<LobbiesDeps, "startMatchServer" | "fetchLobbyStatus" | "statusPollIntervalMs" | "idleGraceMs">;
}

/**
 * Resolves one config from env — every knob in one place, so `index.ts`
 * stays argument-parsing and `buildApp` stays pure construction. Accepts the
 * env record for tests; defaults to the real process env.
 */
/** Parses `LOBBY_PORT_MIN`/`LOBBY_PORT_MAX` — both required, both sane, or the range is off. A half-set range would silently bind somewhere the browser can't reach, so partial counts as absent. */
const resolveMatchPortRange = (env: NodeJS.ProcessEnv): PortRange | undefined => {
  const min = Number(env.LOBBY_PORT_MIN);
  const max = Number(env.LOBBY_PORT_MAX);
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max > 65535 || min > max) return undefined;
  return { min, max };
};

export const resolveConfig = (env: NodeJS.ProcessEnv = process.env): ApiConfig => {
  const port = Number(env.API_PORT);
  const discord =
    env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET && env.DISCORD_REDIRECT_URI
      ? { clientId: env.DISCORD_CLIENT_ID, clientSecret: env.DISCORD_CLIENT_SECRET, redirectUri: env.DISCORD_REDIRECT_URI }
      : undefined;
  const matchPortRange = resolveMatchPortRange(env);
  return {
    port: Number.isInteger(port) && port > 0 ? port : DEFAULT_API_PORT,
    host: env.API_HOST ?? "0.0.0.0",
    dbPath: env.API_DB_PATH ?? env.TRACK_DB_PATH ?? "./data/track-service.sqlite",
    assetsDir: env.TRACK_ASSETS_DIR ?? defaultAssetsDir(),
    ...(discord ? { discord } : {}),
    clientAppUrl: env.PUBLIC_CLIENT_URL ?? "http://localhost:5173",
    discordFetch: fetch,
    apiUrl: env.API_URL ?? `http://localhost:${DEFAULT_API_PORT}`,
    maxPlayers: resolveMaxPlayers(undefined),
    ...(env.SERVICE_TOKEN ? { serviceToken: env.SERVICE_TOKEN } : {}),
    ...(matchPortRange ? { matchPortRange } : {}),
  };
};
