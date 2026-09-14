import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ASSET_DEMO_TRACK,
  ASSET_DEMO_TRACK_ID,
  loadAssetLibrary,
  MODULE_LIBRARY,
  type Module,
  type Track,
} from "@dont-fall/shared";
import { M1_SEED_TRACK_ID, startApi, type ApiService } from "@dont-fall/api";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { drawRound, hasFinishZone, type DrawContext } from "./roundDraw.js";
import type { FetchedTrack } from "../track/trackSource.js";

// Each test gets its own fresh in-memory the API instance rather than
// one shared for the whole file — the pool-exhaustion/no-repeat tests below
// need to know exactly what's published, which a shared instance polluted
// by every other test's own publishes would make impossible to assert on.
let trackService: ApiService;
let trackServiceUrl: string;

beforeEach(async () => {
  trackService = await startApi({ port: 0, dbPath: ":memory:" });
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
 * looks like, not by the logic under test. The M8 asset demo seed
 * (`ASSET_DEMO_TRACK_ID`) is race-compatible too, so it is pre-excluded for
 * the same reason.)
 */
const newContext = (): DrawContext => ({
  trackServiceUrl,
  trackFetchRetryOptions: { maxWaitMs: 2_000, retryDelayMs: 50, attemptTimeoutMs: 1_000 },
  usedTrackIds: new Set<string>([M1_SEED_TRACK_ID, ASSET_DEMO_TRACK_ID]),
  library: MODULE_LIBRARY,
});

/** The full Module world the production runtime resolves against (M8 ticket 04) — M1 plus real asset geometry. */
const assetsRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "assets");
const fullAssetLibrary = async (): Promise<Record<string, Module>> => ({
  ...MODULE_LIBRARY,
  ...(await loadAssetLibrary(async (url: string): Promise<Uint8Array> => {
    const fileName = url.substring(url.lastIndexOf("/") + 1);
    return new Uint8Array(readFileSync(join(assetsRoot, fileName)));
  }, "http://assets.test")),
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
    // A fresh the API always seeds two Race-compatible Tracks (the M1
    // seed and the M8 asset demo seed), so marking them "used" here is
    // exactly this case, not a way to construct "genuinely no compatible
    // Track anywhere" — that premise is untestable against a real
    // the API, since the seeds make it impossible to publish a pool
    // with zero Race-compatible Tracks in the first place.
    await publishTrack(SURVIVAL_ONLY_TRACK);
    const ctx = newContext(); // pre-excludes both seeds as "used"

    const { fetched, roundType } = await drawRound(ctx, { trackId: null, roundType: "race" });

    // Either seed is a legitimate repeat — the point is a repeat, not which.
    expect([M1_SEED_TRACK_ID, ASSET_DEMO_TRACK_ID]).toContain(fetched.id);
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
    // drawn, plus the pre-excluded seeds) — the next draw must reset and
    // repool rather than throw. The reset clears the whole set, seeds
    // included, so the repool draws from the *actual* full pool — any of
    // these is a legitimately predictable answer, not a failure.
    const second = await drawRound(ctx, undefined);
    expect([id, M1_SEED_TRACK_ID, ASSET_DEMO_TRACK_ID]).toContain(second.fetched.id);
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

describe("drawRound — asset-module Tracks (M8 ticket 04)", () => {
  const demoFetched = (): FetchedTrack => ({
    id: ASSET_DEMO_TRACK_ID,
    revision: 1,
    track: ASSET_DEMO_TRACK,
    timeLimitMs: 120_000,
    survivorTarget: 1,
  });

  it("reads the Finish Zone off the asset demo Track through the full library", async () => {
    expect(hasFinishZone(demoFetched(), await fullAssetLibrary())).toBe(true);
  });

  it("throws unknown-Module against the procedural-only library — the crash this guards", () => {
    expect(() => hasFinishZone(demoFetched(), MODULE_LIBRARY)).toThrow(/unknown Module/);
  });

  it("honours a host-picked Race on the seeded asset demo Track", async () => {
    const ctx = { ...newContext(), library: await fullAssetLibrary() };

    const { fetched, roundType } = await drawRound(ctx, { trackId: ASSET_DEMO_TRACK_ID, roundType: "race" });

    expect(fetched.id).toBe(ASSET_DEMO_TRACK_ID);
    expect(roundType).toBe("race");
  });

  it("finds the seeded asset demo Track when a forced Race searches the pool", async () => {
    await publishTrack(SURVIVAL_ONLY_TRACK);
    // Only the M1 seed counts as used here — the asset demo seed stays
    // unused, and the survival-only publish can never satisfy a forced Race,
    // so the search lands on the demo Track whatever order the pool
    // shuffles into.
    const ctx = {
      ...newContext(),
      usedTrackIds: new Set<string>([M1_SEED_TRACK_ID]),
      library: await fullAssetLibrary(),
    };

    const { fetched, roundType } = await drawRound(ctx, { trackId: null, roundType: "race" });

    expect(fetched.id).toBe(ASSET_DEMO_TRACK_ID);
    expect(roundType).toBe("race");
  });
});
