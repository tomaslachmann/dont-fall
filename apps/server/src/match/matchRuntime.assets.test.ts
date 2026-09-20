import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  M1_TRACK,
  MODULE_LIBRARY,
  SEAT_RESERVATION_TTL_MS,
  createAssetLibraryLoader,
  initPhysics,
  type AssetLibraryLoader,
  type Track,
} from "@dont-fall/shared";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FetchedTrack } from "../track/trackSource.js";

const drawRound = vi.hoisted(() => vi.fn());
vi.mock("./roundDraw.js", () => ({ drawRound }));

const { MatchRuntime } = await import("./matchRuntime.js");
type MatchConfig = import("./matchRuntime.js").MatchConfig;

beforeAll(async () => {
  await initPhysics();
});

beforeEach(() => {
  drawRound.mockReset();
});

const assetsRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "assets");

/** A loader over the real files that remembers what it was asked to fetch. */
const countingLoader = (): { loader: AssetLibraryLoader; fetched: string[] } => {
  const fetched: string[] = [];
  const loader = createAssetLibraryLoader(async (url) => {
    const fileName = url.substring(url.lastIndexOf("/") + 1);
    fetched.push(fileName);
    return new Uint8Array(readFileSync(join(assetsRoot, fileName)));
  }, "http://assets.test");
  return { loader, fetched };
};

/** One kaykit deck to stand on, plus the procedural Start the M1 pieces spawn from. */
const assetTrack = (moduleId: string): Track => [
  ...M1_TRACK,
  { moduleId, position: { x: 0, y: 0, z: -40 }, rotation: 0 },
];

const fetchedTrack = (id: string, track: Track): FetchedTrack => ({ id, revision: 1, track, timeLimitMs: 60_000, survivorTarget: 1 });

const configWith = (assets?: AssetLibraryLoader): MatchConfig => ({
  matchId: "asset-match",
  trackServiceUrl: "http://unused",
  trackFetchRetryOptions: {},
  countdownMs: 0,
  roundEndMs: 0,
  standingsReadyTimeoutMs: 0,
  playersToStart: 1,
  maxPlayers: 4,
  reservationTtlMs: SEAT_RESERVATION_TTL_MS,
  matchLengthOverride: 2,
  ...(assets === undefined ? {} : { assets }),
});

describe("a Match loads only the Assets its Tracks place (memory-footprint ticket 01)", () => {
  it("adds a new Track's Assets to the library, fetching only what it lacks", async () => {
    const { loader, fetched } = countingLoader();
    const boot = fetchedTrack("boot", assetTrack("kaykit_arch_green"));
    const library = { ...MODULE_LIBRARY, ...(await loader.load(["kaykit_arch_green"])) };
    const rt = new MatchRuntime(configWith(loader), boot, library);
    fetched.length = 0;

    await rt.loadAssetsFor([...assetTrack("kaykit_arch_green"), { moduleId: "kaykit_arch_blue", position: { x: 0, y: 0, z: -60 }, rotation: 0 }]);

    expect(fetched).toEqual(["kaykit_arch_blue.glb"]);
    expect(rt.library.kaykit_arch_blue?.asset).toBeDefined();
    expect(rt.library.kaykit_arch_green).toBe(library.kaykit_arch_green);
    rt.simulation.dispose();
  });

  it("refuses to build a world on a Track whose Assets it has not loaded, naming them", async () => {
    const rt = new MatchRuntime(configWith(countingLoader().loader), fetchedTrack("boot", M1_TRACK), MODULE_LIBRARY);
    expect(() => rt.buildSimulationFor(assetTrack("kaykit_arch_red"))).toThrow(/not loaded: kaykit_arch_red/);
    rt.simulation.dispose();
  });

  it("loads a drawn Round's Assets before the Match structure is ready", async () => {
    const { loader, fetched } = countingLoader();
    const rt = new MatchRuntime(configWith(loader), fetchedTrack("boot", M1_TRACK), MODULE_LIBRARY);
    drawRound.mockResolvedValue({ fetched: fetchedTrack("drawn", assetTrack("kaykit_arch_red")), roundType: "survival" });

    await rt.buildMatchStructure();

    expect(fetched).toEqual(["kaykit_arch_red.glb"]);
    expect(rt.matchStructure[1]?.fetched.id).toBe("drawn");
    // So the Round can start on it.
    rt.startNextRound(rt.matchStructure[1]!.fetched.track);
    rt.simulation.dispose();
  });

  it("treats a drawn Round whose Assets fail to load as a failed draw", async () => {
    const failing: AssetLibraryLoader = { load: async () => Promise.reject(new Error("GET answered 503")) };
    const rt = new MatchRuntime(configWith(failing), fetchedTrack("boot", M1_TRACK), MODULE_LIBRARY);
    drawRound.mockResolvedValue({ fetched: fetchedTrack("drawn", assetTrack("kaykit_arch_red")), roundType: "survival" });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await rt.buildMatchStructure();

    expect(rt.matchStructure[1]).toBeUndefined();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("503"));
    error.mockRestore();
    rt.simulation.dispose();
  });

  it("draws with every Module's defs, never waiting on geometry", async () => {
    const rt = new MatchRuntime(configWith(countingLoader().loader), fetchedTrack("boot", M1_TRACK), MODULE_LIBRARY);
    drawRound.mockResolvedValue({ fetched: fetchedTrack("drawn", M1_TRACK), roundType: "survival" });

    await rt.buildMatchStructure();

    const library = drawRound.mock.calls[0]![0].library as Record<string, { asset?: unknown }>;
    expect(library.kaykit_arch_red).toBeDefined();
    expect(library.kaykit_arch_red!.asset).toBeUndefined();
    rt.simulation.dispose();
  });

  it("loads nothing when it was handed a finished library", async () => {
    const rt = new MatchRuntime(configWith(), fetchedTrack("boot", M1_TRACK), MODULE_LIBRARY);
    const before = rt.library;
    await rt.loadAssetsFor(assetTrack("kaykit_arch_red"));
    expect(rt.library).toBe(before);
    rt.simulation.dispose();
  });
});
