import {
  COUNTDOWN_MS,
  DEFAULT_API_PORT,
  MAX_PLAYERS,
  PLAYERS_TO_START,
  ROUND_END_MS,
  STANDINGS_READY_TIMEOUT_MS,
} from "@dont-fall/shared";
import type { TrackFetchRetryOptions } from "../track/trackSource.js";

/**
 * What a Match server is started with, and what that resolves to.
 *
 * Two types, on purpose: {@link StartServerConfig} is what a caller may say,
 * where everything is optional and a default may come from the environment;
 * {@link ServerRuntimeConfig} is what the process then runs on, where nothing
 * is optional any more except the genuine overrides. `buildRuntimeConfig` is
 * the one place the first becomes the second, so a default is read once and
 * read here.
 */

export interface PortRange {
  min: number;
  max: number;
}

/**
 * Knobs a test needs and production never sets. Grouped rather than spread
 * through {@link StartServerConfig}, so the shape of what a real caller sets
 * (a port, an API URL, how many Players start a Round) is readable on its own.
 *
 * They are all overrides of something a Track or a constant already decides,
 * and they exist because the real numbers are measured in seconds: waiting out
 * a three-second Countdown, a ten-second Time Limit floor (the API's, ADR
 * 0038) or a full three-Round Match is not a thing a test should do.
 */
export interface TestOverrides {
  /** Hold the Countdown for this long instead of {@link COUNTDOWN_MS} (M4 ticket 04). */
  countdownMs?: number;
  /** Hold ROUND_END for this long before RESULTS instead of {@link ROUND_END_MS} (M4 ticket 05). */
  roundEndMs?: number;
  /** Wait this long for every Player to confirm Ready in Standings before advancing anyway (M7 ticket 10, ADR 0051). */
  standingsReadyTimeoutMs?: number;
  /** Ignore the Revision's authored Time Limit (ADR 0038 puts the clock on the Track) and use this. */
  timeLimitMsOverride?: number;
  /** Ignore the Revision's authored Survivor Target (M5 ticket 05) and use this. */
  survivorTargetOverride?: number;
  /** Force this Match's own length over `DEFAULT_MATCH_LENGTH` (M7 ticket 04, ADR 0049). */
  matchLengthOverride?: number;
  /** Bound the startup Track fetch's retries (ticket 12); production uses `fetchTrack`'s own defaults. */
  trackFetchMaxWaitMs?: number;
  trackFetchRetryDelayMs?: number;
  trackFetchAttemptTimeoutMs?: number;
}

/**
 * The authoritative Match server's configuration (ADR 0002): one
 * `RapierSimulation` per process serving whoever connects to it. No
 * matchmaking and no on-demand spin-up here (ADR 0011) — a Lobby starts one
 * of these in-process inside the API (ADR 0054/0058), and that caller is the
 * one that sets the fields below.
 */
export interface StartServerConfig extends TestOverrides {
  /** Port to listen on. `0` asks the OS for an ephemeral port. Defaults to `DEFAULT_SERVER_PORT`. */
  port?: number;
  /**
   * Bind the first free port inside `[min, max]` instead of `port`.
   * Docker publishes only known ports, so an OS-ephemeral port bound inside
   * the API container is unreachable from the browser — the lobby broker
   * hands that port to the client, which dials it and never gets a welcome.
   * Local dev leaves this unset (ephemeral ports on localhost just work).
   */
  portRange?: PortRange;
  /** Track-serving API base URL (ADR 0028, merged into one service by ADR 0058 — the names are historical). Defaults to `TRACK_SERVICE_URL`, then localhost:{@link DEFAULT_API_PORT}. */
  trackServiceUrl?: string;
  /**
   * How many connected Players a Round waits for before its Countdown starts
   * (M4 ticket 04, ADR 0040). Defaults to the `PLAYERS_TO_START` env, then
   * {@link PLAYERS_TO_START}. Configurable so a developer playing alone can
   * set it to 1 instead of sitting in LOBBY forever.
   */
  playersToStart?: number;
  /**
   * How many connections this server accepts before refusing the next one
   * outright (grilling session, 2026-09). Defaults to the `MAX_PLAYERS` env,
   * then {@link MAX_PLAYERS}. A flat cap on connections held, spectators
   * included — it is what a Player-facing "N SLOTS OPEN" means.
   */
  maxPlayers?: number;
}

/**
 * {@link StartServerConfig} with every default already applied — what the
 * runtime actually runs on. The only optional fields left are the overrides,
 * where "unset" is a meaning of its own (use the Track's / the constant's).
 */
export interface ServerRuntimeConfig {
  trackServiceUrl: string;
  trackFetchRetryOptions: TrackFetchRetryOptions;
  countdownMs: number;
  roundEndMs: number;
  /** Ceiling on how long Standings waits for every connected Player to confirm Ready (M7 ticket 10, ADR 0051) before advancing anyway. */
  standingsReadyTimeoutMs: number;
  playersToStart: number;
  /** How many connections this server accepts before refusing the next one outright (grilling session, 2026-09). */
  maxPlayers: number;
  timeLimitMsOverride?: number | undefined;
  /** Force this Match's `RoundRules.survivorTarget` over whatever Track it loads (M5 ticket 05). */
  survivorTargetOverride?: number | undefined;
  /** Force this Match's own length over `DEFAULT_MATCH_LENGTH` (M7 ticket 04, ADR 0049). */
  matchLengthOverride?: number | undefined;
}

/**
 * A count read from the environment, or `fallback` when it is absent or not a
 * positive whole number. Deliberately forgiving: a typo in a deployment's env
 * must not stop a Match server booting, it must leave it on the default.
 */
export const readPositiveIntEnv = (env: NodeJS.ProcessEnv, name: string, fallback: number): number => {
  const value = Number(env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

/** Resolves what a caller asked for against the environment and the constants, once. */
export const buildRuntimeConfig = (config: StartServerConfig, env: NodeJS.ProcessEnv): ServerRuntimeConfig => ({
  // ADR 0028: the Match server never holds Module data or generates a Track
  // itself — it always fetches one from here.
  trackServiceUrl: config.trackServiceUrl ?? env.TRACK_SERVICE_URL ?? `http://localhost:${DEFAULT_API_PORT}`,
  // Shared by every `fetchTrack` this server makes — the boot one and a
  // Playtest connection's live reload — so a test bounds both the same way.
  trackFetchRetryOptions: {
    ...(config.trackFetchMaxWaitMs !== undefined ? { maxWaitMs: config.trackFetchMaxWaitMs } : {}),
    ...(config.trackFetchRetryDelayMs !== undefined ? { retryDelayMs: config.trackFetchRetryDelayMs } : {}),
    ...(config.trackFetchAttemptTimeoutMs !== undefined ? { attemptTimeoutMs: config.trackFetchAttemptTimeoutMs } : {}),
  },
  countdownMs: config.countdownMs ?? COUNTDOWN_MS,
  roundEndMs: config.roundEndMs ?? ROUND_END_MS,
  standingsReadyTimeoutMs: config.standingsReadyTimeoutMs ?? STANDINGS_READY_TIMEOUT_MS,
  playersToStart: config.playersToStart ?? readPositiveIntEnv(env, "PLAYERS_TO_START", PLAYERS_TO_START),
  maxPlayers: config.maxPlayers ?? readPositiveIntEnv(env, "MAX_PLAYERS", MAX_PLAYERS),
  ...(config.timeLimitMsOverride !== undefined ? { timeLimitMsOverride: config.timeLimitMsOverride } : {}),
  ...(config.survivorTargetOverride !== undefined ? { survivorTargetOverride: config.survivorTargetOverride } : {}),
  ...(config.matchLengthOverride !== undefined ? { matchLengthOverride: config.matchLengthOverride } : {}),
});
