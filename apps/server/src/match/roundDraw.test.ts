import { type Track } from "@dont-fall/shared";
import { M1_SEED_TRACK_ID, startTrackService, type TrackService } from "@dont-fall/track-service";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { drawRound, type DrawContext } from "./roundDraw.js";

// Each test gets its own fresh in-memory track-service instance rather than
// one shared for the whole file — the pool-exhaustion/no-repeat tests below
// need to know exactly what's published, which a shared instance polluted
// by every other test's own publishes would make impossible to assert on.
let trackService: TrackService;
let trackServiceUrl: string;

beforeEach(async () => {
  trackService = await startTrackService({ port: 0, dbPath: ":memory:" });
  trackServiceUrl = `http://localhost:${trackService.port}`;
});

afterEach(async () => {
  await trackService.close();
});

/** A Track with a Finish Zone right at spawn — Race-compatible. */
const RACE_TRACK: Track = [{ moduleId: "finish", position: { x: 0, y: 0, z: 10 }, rotation: 0 }];
/** A Track with no Finish Zone at all — Survival-only ("every Track has ground to be shoved off"). */
const SURVIVAL_ONLY_TRACK: Track = [{ moduleId: "arena", position: { x: 0, y: 0, z: 0 }, rotation: 0 }];

const publishTrack = async (track: Track): Promise<string> => {
  const res = await fetch(`${trackServiceUrl}/tracks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ track }),
  });
  const body = (await res.json()) as { id: string };
  return body.id;
};

/**
 * A fresh `startTrackService` instance still seeds the M1 playground Track
 * (`M1_SEED_TRACK_ID`, ADR 0028) — pre-excluded here so every test below
 * controls its own pool precisely, over only the Tracks it explicitly
 * publishes. (It happens to have a Finish Zone, so leaving it in would make
 * "no Track supports Race" tests pass by accident of what M1's own Track
 * looks like, not by the logic under test.)
 */
const newContext = (): DrawContext => ({
  trackServiceUrl,
  trackFetchRetryOptions: { maxWaitMs: 2_000, retryDelayMs: 50, attemptTimeoutMs: 1_000 },
  usedTrackIds: new Set<string>([M1_SEED_TRACK_ID]),
});

describe("drawRound — an explicit host pick (M7 ticket 05, ADR 0049)", () => {
  it("honours a fully host-picked Track and Round type", async () => {
    const trackId = await publishTrack(RACE_TRACK);
    const ctx = newContext();

    const { fetched, roundType } = await drawRound(ctx, { trackId, roundType: "race" });

    expect(fetched.id).toBe(trackId);
    expect(roundType).toBe("race");
    expect(ctx.usedTrackIds.has(trackId)).toBe(true);
  });

  it("draws a Round type when only the Track is picked, honouring a Race pick when the Track supports it", async () => {
    const trackId = await publishTrack(RACE_TRACK);
    const ctx = newContext();

    const { fetched, roundType } = await drawRound(ctx, { trackId, roundType: null });

    expect(fetched.id).toBe(trackId);
    expect(["race", "survival"]).toContain(roundType);
  });

  it("falls back to Survival when only the Track is picked and it has no Finish Zone", async () => {
    const trackId = await publishTrack(SURVIVAL_ONLY_TRACK);
    const ctx = newContext();

    const { roundType } = await drawRound(ctx, { trackId, roundType: null });

    expect(roundType).toBe("survival");
  });

  it("drops an incompatible manual combination (Race picked against a Track with no Finish Zone) rather than blocking the Match", async () => {
    const trackId = await publishTrack(SURVIVAL_ONLY_TRACK);
    const ctx = newContext();

    const { fetched, roundType } = await drawRound(ctx, { trackId, roundType: "race" });

    expect(fetched.id).toBe(trackId); // the Track pick is still honoured
    expect(roundType).toBe("survival"); // the incompatible type pick is not
  });

  it("searches the pool for a Track that supports a forced Race with no Track picked", async () => {
    const survivalOnlyId = await publishTrack(SURVIVAL_ONLY_TRACK);
    const raceId = await publishTrack(RACE_TRACK);
    const ctx = newContext();
    ctx.usedTrackIds.add(survivalOnlyId); // steer the draw toward the Race-compatible one deterministically

    const { fetched, roundType } = await drawRound(ctx, { trackId: null, roundType: "race" });

    expect(fetched.id).toBe(raceId);
    expect(roundType).toBe("race");
  });

  it("falls back to an already-used Track for a forced Race rather than finding nothing, once every unused Track is incompatible", async () => {
    // `drawCompatibleTrack` deliberately searches unused candidates first,
    // then already-used ones — a repeat is still a better answer than none.
    // A fresh track-service always seeds one Race-compatible Track
    // (`M1_SEED_TRACK_ID`), so marking it "used" here is exactly this case,
    // not a way to construct "genuinely no compatible Track anywhere" —
    // that premise is untestable against a real track-service, since the
    // seed makes it impossible to publish a pool with zero Race-compatible
    // Tracks in the first place.
    await publishTrack(SURVIVAL_ONLY_TRACK);
    const ctx = newContext(); // pre-excludes the seed as "used"

    const { fetched, roundType } = await drawRound(ctx, { trackId: null, roundType: "race" });

    expect(fetched.id).toBe(M1_SEED_TRACK_ID);
    expect(roundType).toBe("race");
  });
});

describe("drawRound — nothing picked at all", () => {
  it("draws the only published Track and a Round type it actually supports", async () => {
    const trackId = await publishTrack(SURVIVAL_ONLY_TRACK);
    const ctx = newContext();

    const { fetched, roundType } = await drawRound(ctx, undefined);

    expect(fetched.id).toBe(trackId);
    expect(roundType).toBe("survival"); // this Track never supports Race
  });
});

describe("drawRound — not drawn twice until the pool is exhausted (M7 ticket 05)", () => {
  it("never repeats a Track while unused ones remain", async () => {
    const ids = [await publishTrack(RACE_TRACK), await publishTrack(RACE_TRACK), await publishTrack(RACE_TRACK)];
    const ctx = newContext();

    const drawn = new Set<string>();
    for (let i = 0; i < ids.length; i += 1) {
      const { fetched } = await drawRound(ctx, undefined);
      expect(drawn.has(fetched.id)).toBe(false);
      drawn.add(fetched.id);
    }
    expect(drawn).toEqual(new Set(ids));
  });

  it("repeats predictably once the pool is exhausted, rather than failing", async () => {
    const id = await publishTrack(RACE_TRACK);
    const ctx = newContext();

    const first = await drawRound(ctx, undefined);
    expect(first.fetched.id).toBe(id);
    // Every Track this context knows about is now "used" (the one just
    // drawn, plus the pre-excluded seed) — the next draw must reset and
    // repool rather than throw. The reset clears the whole set, seed
    // included, so the repool draws from the *actual* full pool — either
    // Track is a legitimately predictable answer, not a failure.
    const second = await drawRound(ctx, undefined);
    expect([id, M1_SEED_TRACK_ID]).toContain(second.fetched.id);
  });
});

describe("drawRound — mutates ctx.usedTrackIds in place", () => {
  it("adds the drawn Track's id so the next draw sees it as used", async () => {
    const trackId = await publishTrack(RACE_TRACK);
    const ctx = newContext();
    expect(ctx.usedTrackIds.has(trackId)).toBe(false);

    await drawRound(ctx, { trackId, roundType: "race" });

    expect(ctx.usedTrackIds.has(trackId)).toBe(true);
  });

  it("honours a host-picked Track that is already used — an explicit pick always wins, repeat or not (code review)", async () => {
    const trackId = await publishTrack(RACE_TRACK);
    const ctx = newContext();
    ctx.usedTrackIds.add(trackId); // already "used" — a host pick is not a draw, so this must not matter

    const { fetched } = await drawRound(ctx, { trackId, roundType: "race" });

    expect(fetched.id).toBe(trackId);
  });
});
