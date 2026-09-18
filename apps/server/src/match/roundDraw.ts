import {
  TRACK_FETCH_ATTEMPT_TIMEOUT_MS,
  TRACK_FETCH_MAX_WAIT_MS,
  TRACK_FETCH_RETRY_DELAY_MS,
  resolveTrack,
  roundStartBlockedReason,
  type Module,
  type RoundType,
} from "@dont-fall/shared";
import { fetchTrack, type FetchedTrack, type TrackFetchRetryOptions } from "../track/trackSource.js";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One Round slot's host pick (M7 ticket 05, ADR 0049) — either field may be
 * `null`, meaning "the server draws this." Mirrors the wire shape
 * (`PickRoundSlotMessage`) exactly; there is deliberately no third "absent
 * entirely" state distinct from "both fields null" — a slot always has an
 * opinion, even if that opinion is "no opinion."
 */
export interface RoundSlotPick {
  trackId: string | null;
  roundType: RoundType | null;
}

/** What {@link drawRound} needs from the runtime — a narrow slice, not the whole `MatchRuntime`, so this stays testable without a live server. */
export interface DrawContext {
  trackServiceUrl: string;
  trackFetchRetryOptions: TrackFetchRetryOptions;
  /** Track ids already used this Match — mutated in place as Rounds are drawn (ticket 05: "not drawn twice until the pool is exhausted"). */
  usedTrackIds: Set<string>;
  /**
   * Every Module a published Track may place (M8 ticket 04) — the static
   * registry composed with the fetched asset half, threaded from the runtime
   * that already resolves its own world against it. Answering "does this
   * Track carry a Finish Zone" against the procedural-only registry instead
   * throws unknown-Module on asset Tracks rather than answering.
   */
  library: Record<string, Module>;
}

/**
 * Lists every published Track's id — retried with backoff exactly like
 * {@link fetchTrack} (code review: this used to be a bare, unretried
 * `fetch`, the one the API call in this file that didn't match the
 * rest), each attempt bounded so one hung request can't eat the whole wait
 * budget on its own.
 */
const listTrackIds = async (
  trackServiceUrl: string,
  { maxWaitMs = TRACK_FETCH_MAX_WAIT_MS, retryDelayMs = TRACK_FETCH_RETRY_DELAY_MS, attemptTimeoutMs = TRACK_FETCH_ATTEMPT_TIMEOUT_MS }: DrawContext["trackFetchRetryOptions"],
): Promise<string[]> => {
  const deadline = Date.now() + maxWaitMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${trackServiceUrl}/tracks`, { signal: AbortSignal.timeout(attemptTimeoutMs) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { id: string }[];
      return body.map((t) => t.id);
    } catch (err) {
      lastError = err;
      console.warn(`DON'T FALL: the API Track listing failed, retrying: ${(err as Error).message}`);
      await sleep(retryDelayMs);
    }
  }
  throw new Error(`the API unreachable listing Tracks at ${trackServiceUrl} (ADR 0028): ${(lastError as Error)?.message}`);
};

/** Fisher-Yates — every candidate order is equally likely, not just "not sorted." */
const shuffled = <T,>(items: readonly T[]): T[] => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
};

/**
 * Whether a fetched Track carries a Finish Zone (M8 ticket 04) — resolved
 * against the context library, never the procedural-only registry. Exported
 * for tests: the pure seam where an asset-Module Track used to crash the
 * draw with unknown-Module instead of answering race-compatible or not.
 */
export const hasFinishZone = (fetched: FetchedTrack, library: Record<string, Module>): boolean =>
  resolveTrack(library, fetched.track).finishZones.length > 0;

/**
 * Every published Track supports Survival (`roundStartBlockedReason`: "every
 * Track has ground to be shoved off") — so drawing *a* Track never needs to
 * search or reject candidates, only drawing one compatible with a
 * *specifically forced* Race does.
 */
const drawUnusedTrackId = async (ctx: DrawContext): Promise<string> => {
  const pool = await listTrackIds(ctx.trackServiceUrl, ctx.trackFetchRetryOptions);
  if (pool.length === 0) throw new Error("the API has no published Tracks to draw from");
  const unused = shuffled(pool.filter((id) => !ctx.usedTrackIds.has(id)));
  if (unused.length > 0) return unused[0]!;
  // Exhausted — start over rather than fail (ticket 05: "repeats rather
  // than failing, and does so predictably"). Cleared here, not left for the
  // caller: the very next draw must see a full pool again.
  ctx.usedTrackIds.clear();
  return shuffled(pool)[0]!;
};

/**
 * Draws a Track compatible with a *forced* `type` (only ever called for
 * `"race"` — see {@link drawUnusedTrackId}'s own doc) — tries unused
 * candidates first, then already-used ones, since a Race-compatible repeat
 * is still a better answer than none at all.
 */
const drawCompatibleTrack = async (ctx: DrawContext, type: RoundType): Promise<FetchedTrack> => {
  const pool = await listTrackIds(ctx.trackServiceUrl, ctx.trackFetchRetryOptions);
  const ordered = [
    ...shuffled(pool.filter((id) => !ctx.usedTrackIds.has(id))),
    ...shuffled(pool.filter((id) => ctx.usedTrackIds.has(id))),
  ];
  for (const id of ordered) {
    const fetched = await fetchTrack(ctx.trackServiceUrl, { ...ctx.trackFetchRetryOptions, trackId: id });
    if (roundStartBlockedReason(type, hasFinishZone(fetched, ctx.library)) === undefined) return fetched;
  }
  throw new Error(`no published Track supports Round type "${type}" (ticket 05's draw has nothing to offer)`);
};

/**
 * Resolves one Round slot into a real Track and Round type (M7 ticket 05,
 * ADR 0049 "pick or shuffle") — the host's own pick honoured field by field,
 * whatever is left `null` drawn. Draws the pair together rather than a Track
 * then a type: picking a type first and failing to find a Track for it is
 * the version of this that ends in a retry loop (the ticket's own warning).
 *
 * A host-picked `trackId` is **never checked against `ctx.usedTrackIds`**
 * (code review, confirmed intentional, not a gap) — "not drawn twice" is a
 * rule about what the *server* draws when nobody said otherwise, not a cap
 * on what a host may deliberately choose; "the host may pick, but does not
 * have to" (the ticket's own words) means an explicit pick always wins,
 * repeat or not. It still counts as used afterward, same as any drawn Track,
 * so an *un*picked Round drawn after it won't repeat it for free.
 *
 * Mutates `ctx.usedTrackIds` — this Round's own Track counts as used the
 * moment it's drawn, for whichever Round draws next.
 */
export const drawRound = async (ctx: DrawContext, pick: RoundSlotPick | undefined): Promise<{ fetched: FetchedTrack; roundType: RoundType }> => {
  let fetched: FetchedTrack;
  if (pick?.trackId) {
    fetched = await fetchTrack(ctx.trackServiceUrl, { ...ctx.trackFetchRetryOptions, trackId: pick.trackId });
  } else if (pick?.roundType === "race") {
    // A forced Race with no Track picked is the one case that needs a real
    // search — every other path can draw any Track (Survival always fits).
    fetched = await drawCompatibleTrack(ctx, "race");
  } else {
    fetched = await fetchTrack(ctx.trackServiceUrl, { ...ctx.trackFetchRetryOptions, trackId: await drawUnusedTrackId(ctx) });
  }

  // The host's own Round-type pick wins if the (possibly host-picked, possibly
  // drawn) Track actually supports it; an incompatible manual combination
  // (a Race pick against a Track with no Finish Zone) falls through to a
  // drawn type rather than blocking a Match already in progress.
  const picked = pick?.roundType;
  const roundType: RoundType =
    picked && roundStartBlockedReason(picked, hasFinishZone(fetched, ctx.library)) === undefined
      ? picked
      : hasFinishZone(fetched, ctx.library) && Math.random() < 0.5
        ? "race"
        : "survival";

  ctx.usedTrackIds.add(fetched.id);
  return { fetched, roundType };
};
