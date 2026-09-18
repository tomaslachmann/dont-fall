import {
  DEFAULT_SURVIVOR_TARGET,
  DEFAULT_TIME_LIMIT_MS,
  TRACK_FETCH_ATTEMPT_TIMEOUT_MS,
  TRACK_FETCH_MAX_WAIT_MS,
  TRACK_FETCH_RETRY_DELAY_MS,
  type Track,
  type TrackRoundDefaults,
} from "@dont-fall/shared";

/** How hard a Track fetch tries before giving up (ticket 12). Every field defaults to its shared constant, so `{}` means "production". */
export interface TrackFetchRetryOptions {
  maxWaitMs?: number;
  retryDelayMs?: number;
  attemptTimeoutMs?: number;
}

export interface FetchedTrack extends TrackRoundDefaults {
  id: string;
  revision: number;
  track: Track;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetches a fully-resolved Track from the API (ADR 0028) — the Match
 * server never holds Module data or generates a Track itself, whether it's
 * hand-built or randomly assembled makes no difference here. `id`/`revision`
 * are carried into every client's `welcome` (ticket 11) so a client fetches
 * this *exact* Revision, never "latest" independently — a publish landing
 * mid-Match could otherwise desync a client from what the server is running.
 *
 * Retries with backoff (ticket 12) — the API may still be starting up
 * (e.g. Docker container ordering isn't instant); a single-shot fetch failing
 * on that transient race isn't the same problem as the API being
 * genuinely gone. Still fails loudly (and unmasked) once the budget runs out.
 * Each attempt itself is bounded ({@link TRACK_FETCH_ATTEMPT_TIMEOUT_MS}) —
 * without that, a single hung request (the API accepts the connection
 * but never responds) could block past the whole retry budget instead of
 * being abandoned and retried.
 *
 * `trackId`, when given, fetches that exact id's latest Revision (`GET
 * /tracks/:id`) instead of a random one (`GET /tracks/any`) — the Track
 * Builder's Playtest button (a connecting client's own `?track=` query
 * param, see {@link startServer}) is the only caller that ever passes this;
 * the normal boot-time fetch never does.
 */
export const fetchTrack = async (
  trackServiceUrl: string,
  {
    maxWaitMs = TRACK_FETCH_MAX_WAIT_MS,
    retryDelayMs = TRACK_FETCH_RETRY_DELAY_MS,
    attemptTimeoutMs = TRACK_FETCH_ATTEMPT_TIMEOUT_MS,
    trackId,
  }: TrackFetchRetryOptions & { trackId?: string } = {},
): Promise<FetchedTrack> => {
  const path = trackId !== undefined ? `/tracks/${encodeURIComponent(trackId)}` : "/tracks/any";
  const deadline = Date.now() + maxWaitMs;
  let attempt = 0;
  let lastError: unknown;
  while (Date.now() < deadline) {
    attempt += 1;
    try {
      const res = await fetch(`${trackServiceUrl}${path}`, { signal: AbortSignal.timeout(attemptTimeoutMs) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as {
        id: string;
        revision: number;
        track: Track;
        timeLimitMs?: number;
        survivorTarget?: number;
      };
      if (attempt > 1) console.log(`DON'T FALL: the API reachable after ${attempt} attempts`);
      return {
        id: body.id,
        revision: body.revision,
        track: body.track,
        // Defaulted rather than required, so a the API that predates
        // either column (ADR 0038/0041's own backfills haven't run yet) still
        // yields a playable Round rather than a Match server that won't start.
        timeLimitMs: body.timeLimitMs ?? DEFAULT_TIME_LIMIT_MS,
        survivorTarget: body.survivorTarget ?? DEFAULT_SURVIVOR_TARGET,
      };
    } catch (err) {
      lastError = err;
      console.warn(`DON'T FALL: the API fetch attempt ${attempt} failed, retrying: ${(err as Error).message}`);
      await sleep(retryDelayMs);
    }
  }
  throw new Error(
    `the API unreachable or has no Track at ${trackServiceUrl} after ${attempt} attempts (ADR 0028): ${(lastError as Error)?.message}`,
  );
};
