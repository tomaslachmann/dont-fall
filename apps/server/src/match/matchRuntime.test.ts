import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BASE_RACE_TRACK,
  IDLE_INPUTS,
  MODULE_LIBRARY,
  TICK_RATE_HZ,
  initPhysics,
  M1_TRACK,
  RapierSimulation,
  loadAssetLibrary,
  resolveTrack,
  trackSpawn,
  type Track,
} from "@dont-fall/shared";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { MatchRuntime, type MatchConfig } from "./matchRuntime.js";
import { handleLobbyMessage } from "./lobby.js";
import type { FetchedTrack } from "../track/trackSource.js";

beforeAll(async () => {
  await initPhysics();
});

const fetched: FetchedTrack = {
  id: "test-track",
  revision: 1,
  track: M1_TRACK,
  timeLimitMs: 60_000,
  survivorTarget: 1,
};

const config: MatchConfig = {
  matchId: "test-match",
  trackServiceUrl: "http://unused",
  trackFetchRetryOptions: {},
  countdownMs: 0,
  roundEndMs: 0,
  standingsReadyTimeoutMs: 0,
  playersToStart: 2,
  maxPlayers: 10,
};

const seat = (
  rt: MatchRuntime,
  ...ids: (string | { id: string; accountId: string | null })[]
): void => {
  ids.forEach((entry, joinOrder) => {
    const id = typeof entry === "string" ? entry : entry.id;
    const accountId = typeof entry === "string" ? null : entry.accountId;
    rt.lobbyPlayers.set(id, { id, nickname: id, ready: true, joinOrder, accountId, bodySkin: null });
  });
};

const authedRuntime = (resolveAccount: (token: string) => Promise<{ accountId: string; bodySkin: number | null } | null>): MatchRuntime =>
  new MatchRuntime(config, fetched, undefined, undefined, undefined, undefined, { resolveAccount });

const characterIds = (rt: MatchRuntime): string[] => Object.keys(rt.simulation.snapshot().characters).sort();

describe("MatchRuntime spectators (M7 ticket 08)", () => {
  it("seats every Lobby Player when nobody is spectating", () => {
    const rt = new MatchRuntime(config, fetched);
    seat(rt, "a", "b");

    const built = rt.buildSimulationFor(M1_TRACK);

    expect(Object.keys(built.simulation.snapshot().characters).sort()).toEqual(["a", "b"]);
    built.simulation.dispose();
    rt.simulation.dispose();
  });

  it("leaves a mid-Match spectator in the Lobby's list but out of the Round", () => {
    const rt = new MatchRuntime(config, fetched);
    seat(rt, "a", "b", "c");
    rt.spectators.add("c");

    const built = rt.buildSimulationFor(M1_TRACK);

    expect([...rt.lobbyPlayers.keys()].sort()).toEqual(["a", "b", "c"]);
    expect(Object.keys(built.simulation.snapshot().characters).sort()).toEqual(["a", "b"]);
    built.simulation.dispose();
    rt.simulation.dispose();
  });

  it("keeps spectators out of the next Round — they play from the next Match, not its next Round", () => {
    const rt = new MatchRuntime(config, fetched);
    seat(rt, "a", "b", "c");
    rt.spectators.add("c");

    rt.startNextRound(M1_TRACK);

    expect(rt.match.phase).toBe("COUNTDOWN");
    expect(characterIds(rt)).toEqual(["a", "b"]);
    rt.simulation.dispose();
  });

  it("a fresh Lobby clears spectators and seats everyone waiting again", () => {
    const rt = new MatchRuntime(config, fetched);
    seat(rt, "a", "b", "c");
    rt.spectators.add("c");
    rt.roundResults.push({ rows: [{ id: "a", placement: 1, qualified: true }] });
    rt.matchNicknames.set("a", "Ann");
    rt.totalFalls = { a: 2 };
    rt.resultsSavedMatchId = "m1";
    rt.resultsSavedAtMs = 5_000;
    rt.closeRequested = true;

    rt.resetToFreshLobby(M1_TRACK);

    expect(rt.spectators.size).toBe(0);
    expect(rt.match.phase).toBe("LOBBY");
    expect(rt.roundResults).toEqual([]);
    expect(rt.matchNicknames.size).toBe(0);
    expect(rt.totalFalls).toEqual({});
    expect(rt.resultsSavedMatchId).toBeNull();
    expect(rt.resultsSavedAtMs).toBeNull();
    expect(rt.closeRequested).toBe(false);
    expect(characterIds(rt)).toEqual(["a", "b", "c"]);
    rt.simulation.dispose();
  });
});

describe("MatchRuntime asset worlds (M8 ticket 02)", () => {
  const assetsRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "assets");

  it("server-built and client-built worlds answer identically", async () => {
    const assets = await loadAssetLibrary(async (url: string) => {
      const fileName = url.substring(url.lastIndexOf("/") + 1);
      return new Uint8Array(readFileSync(join(assetsRoot, fileName)));
    }, "http://assets.test");
    const library = { ...MODULE_LIBRARY, ...assets };
    // The seeded base race — maintained where the asset set is, so this
    // equivalence pin never hardcodes module ids that can be deleted.
    const track: Track = BASE_RACE_TRACK;

    // Server path: the runtime builds (seats nobody — no lobby players yet).
    const rt = new MatchRuntime(config, { ...fetched, track }, library);
    const serverSim = rt.simulation;
    // Spawned on the Start, where a Round seats its first Player.
    const spawn = trackSpawn(track, 0, library);
    serverSim.addCharacter("p", spawn);

    // Client path: resolve plus construct, the way prediction builds it.
    const clientSim = new RapierSimulation({ ...resolveTrack(library, track), withDefaultCharacter: false });
    clientSim.addCharacter("p", spawn);

    const walk = { ...IDLE_INPUTS, moveDirection: { x: 0, y: 0, z: -1 } };
    for (let n = 0; n < Math.round(4 * TICK_RATE_HZ); n += 1) {
      serverSim.tick({ p: walk });
      clientSim.tick({ p: walk });
    }

    const a = serverSim.snapshot().characters["p"]!;
    const b = clientSim.snapshot().characters["p"]!;
    expect(a.position.x).toBeCloseTo(b.position.x, 10);
    expect(a.position.y).toBeCloseTo(b.position.y, 10);
    expect(a.position.z).toBeCloseTo(b.position.z, 10);
    expect(a.grounded).toBe(b.grounded);
    clientSim.dispose();
    rt.simulation.dispose();
  });
});

describe("auth message binding (M9 ticket 11 phase 2b)", () => {
  const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

  it("binds a resolving token's Account to the sender's Lobby row", async () => {
    const resolveAccount = vi.fn(async () => ({ accountId: "acc-1", bodySkin: 2 }));
    const rt = authedRuntime(resolveAccount);
    try {
      seat(rt, "a");

      expect(handleLobbyMessage(rt, "a", { type: "auth", token: "tok" })).toBe(true);
      await flush();

      expect(resolveAccount).toHaveBeenCalledWith("tok");
      expect(rt.lobbyPlayers.get("a")?.accountId).toBe("acc-1");
      expect(rt.lobbyPlayers.get("a")?.bodySkin).toBe(2);
    } finally {
      rt.simulation.dispose();
    }
  });

  it("a null resolution leaves the seat anonymous — never closed, never bound", async () => {
    const rt = authedRuntime(async () => null);
    try {
      seat(rt, "a");

      handleLobbyMessage(rt, "a", { type: "auth", token: "stale" });
      await flush();

      expect(rt.lobbyPlayers.get("a")?.accountId).toBeNull();
    } finally {
      rt.simulation.dispose();
    }
  });

  it("a resolution landing after the Player left binds nothing and throws nothing", async () => {
    let release!: (id: { accountId: string; bodySkin: number | null } | null) => void;
    const gate = new Promise<{ accountId: string; bodySkin: number | null } | null>((resolve) => {
      release = resolve;
    });
    const rt = authedRuntime(() => gate);
    try {
      seat(rt, "a");
      handleLobbyMessage(rt, "a", { type: "auth", token: "tok" });
      rt.lobbyPlayers.delete("a");

      release({ accountId: "acc-1", bodySkin: 2 });
      await flush();

      expect(rt.lobbyPlayers.has("a")).toBe(false);
    } finally {
      rt.simulation.dispose();
    }
  });

  it("re-auth re-binds — latest send wins", async () => {
    const rt = authedRuntime(async (token) => ({ accountId: `acc-for-${token}`, bodySkin: null }));
    try {
      seat(rt, "a");

      handleLobbyMessage(rt, "a", { type: "auth", token: "one" });
      handleLobbyMessage(rt, "a", { type: "auth", token: "two" });
      await flush();

      expect(rt.lobbyPlayers.get("a")?.accountId).toBe("acc-for-two");
    } finally {
      rt.simulation.dispose();
    }
  });

  it("ignores a malformed auth — no token, no resolution, row untouched", async () => {
    const resolveAccount = vi.fn(async () => ({ accountId: "acc-1", bodySkin: 2 }));
    const rt = authedRuntime(resolveAccount);
    try {
      seat(rt, "a");

      handleLobbyMessage(rt, "a", { type: "auth", token: "" });
      await flush();

      expect(resolveAccount).not.toHaveBeenCalled();
      expect(rt.lobbyPlayers.get("a")?.accountId).toBeNull();
    } finally {
      rt.simulation.dispose();
    }
  });
});
