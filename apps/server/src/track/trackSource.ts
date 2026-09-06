import {
  DEFAULT_TIME_LIMIT_MS,
  TRACK_FETCH_ATTEMPT_TIMEOUT_MS,
  TRACK_FETCH_MAX_WAIT_MS,
  TRACK_FETCH_RETRY_DELAY_MS,
  type Track,
} from "@dont-fall/shared";

export interface FetchedTrack {
  id: string;
  revision: number;
  track: Track;
  /** The Time Limit published with this Revision (M4 ticket 03, ADR 0038). */
  timeLimitMs: number;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetches a fully-resolved Track from track-service (ADR 0028) — the Match
 * server never holds Module data or generates a Track itself, whether it's
 * hand-built or randomly assembled makes no difference here. `id`/`revision`
 * are carried into every client's `welcome` (ticket 11) so a client fetches
 * this *exact* Revision, never "latest" independently — a publish landing
 * mid-Match could otherwise desync a client from what the server is running.
 *
 * Retries with backoff (ticket 12) — track-service may still be starting up
 * (e.g. Docker container ordering isn't instant); a single-shot fetch failing
 * on that transient race isn't the same problem as track-service being
 * genuinely gone. Still fails loudly (and unmasked) once the budget runs out.
 * Each attempt itself is bounded ({@link TRACK_FETCH_ATTEMPT_TIMEOUT_MS}) —
 * without that, a single hung request (track-service accepts the connection
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
  }: { maxWaitMs?: number; retryDelayMs?: number; attemptTimeoutMs?: number; trackId?: string } = {},
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
      const body = (await res.json()) as { id: string; revision: number; track: Track; timeLimitMs?: number };
      if (attempt > 1) console.log(`DON'T FALL: track-service reachable after ${attempt} attempts`);
      return {
        id: body.id,
        revision: body.revision,
        track: body.track,
        // Defaulted rather than required, so a track-service that predates
        // the column (ADR 0038's own backfill hasn't run yet) still yields a
        // playable Round rather than a Match server that won't start.
        timeLimitMs: body.timeLimitMs ?? DEFAULT_TIME_LIMIT_MS,
      };
    } catch (err) {
      lastError = err;
      console.warn(`DON'T FALL: track-service fetch attempt ${attempt} failed, retrying: ${(err as Error).message}`);
      await sleep(retryDelayMs);
    }
  }
  throw new Error(
    `track-service unreachable or has no Track at ${trackServiceUrl} after ${attempt} attempts (ADR 0028): ${(lastError as Error)?.message}`,
  );
};
