import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BASE_RACE_TRACK,
  BOT_NICKNAMES,
  SEAT_RESERVATION_TTL_MS,
  TICK_MS,
  initNavigation,
  initPhysics,
  loadAssetLibrary,
  type ClientMessage,
  type LobbyBots,
  type Module,
  type PersistedMatchResult,
  type SnapshotMessage,
} from "@dont-fall/shared";
import type { WebSocket } from "ws";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { handleConnection } from "../server/connections.js";
import type { FetchedTrack } from "../track/trackSource.js";
import type { BettingRoundOpen } from "./betting.js";
import { startMatchLoop } from "./matchLoop.js";
import { MatchRuntime, type MatchConfig } from "./matchRuntime.js";
import type { TickScheduler, TickSchedulerTimers } from "./tickScheduler.js";

/**
 * M17 ticket 10 on a real `MatchRuntime`, the real connection handler, Lobby
 * messages and tick loop: the host's Bot settings, the fill at the start, who
 * hosts, and a Match's worth of Bots that keep nothing.
 */

const assetsRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "assets");
let library: Record<string, Module>;

beforeAll(async () => {
  await Promise.all([initPhysics(), initNavigation()]);
  library = await loadAssetLibrary(
    async (url) => new Uint8Array(readFileSync(join(assetsRoot, url.substring(url.lastIndexOf("/") + 1)))),
    "http://assets.test",
  );
});

const fetched: FetchedTrack = { id: "base-race", revision: 1, track: BASE_RACE_TRACK, timeLimitMs: 300_000, survivorTarget: 1 };

const configWith = (overrides: Partial<MatchConfig>): MatchConfig => ({
  matchId: "bot-fill-match",
  // Nothing listens here: a later Round's draw fails at once and replays the
  // Track already loaded (`buildMatchStructure`'s own fallback).
  trackServiceUrl: "http://127.0.0.1:9",
  trackFetchRetryOptions: { maxWaitMs: 0, retryDelayMs: 0, attemptTimeoutMs: 200 },
  countdownMs: 0,
  roundEndMs: 0,
  standingsReadyTimeoutMs: 0,
  playersToStart: 2,
  maxPlayers: 4,
  reservationTtlMs: SEAT_RESERVATION_TTL_MS,
  matchLengthOverride: 1,
  ...overrides,
});

/** What this Match reported to the (absent) API, kept for the test to read. */
interface Reports {
  bettingOpened: BettingRoundOpen[];
  saved: PersistedMatchResult[];
  plays: string[];
  personalBestRuns: number;
}

const runtime = (overrides: Partial<MatchConfig> = {}): { rt: MatchRuntime; reports: Reports } => {
  const reports: Reports = { bettingOpened: [], saved: [], plays: [], personalBestRuns: 0 };
  const rt = new MatchRuntime(
    configWith(overrides),
    fetched,
    library,
    {
      openRound: async (round) => void reports.bettingOpened.push(round),
      closeRound: async () => {},
      settleRound: async () => {},
    },
    { saveResult: async (result) => (reports.saved.push(result), true) },
    { recordPlay: async (trackId) => void reports.plays.push(trackId) },
    // Every token is the host's Account.
    { resolveAccount: async () => ({ accountId: "acc-host", displayName: "Hosty", color: 1, skin: null, hat: null }) },
    { recordRuns: async (report) => void (reports.personalBestRuns += report.runs.length) },
  );
  return { rt, reports };
};

class FakeSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  readonly sent: { type: string }[] = [];
  closeCode: number | undefined;
  send(payload: string): void {
    this.sent.push(JSON.parse(payload) as { type: string });
  }
  close(code?: number): void {
    this.closeCode = code;
    this.readyState = 3;
    this.emit("close");
  }
  say(message: ClientMessage): void {
    this.emit("message", Buffer.from(JSON.stringify(message)));
  }
  lastSnapshot(): SnapshotMessage {
    const snapshots = this.sent.filter((m) => m.type === "snapshot");
    return snapshots[snapshots.length - 1] as SnapshotMessage;
  }
}

const connect = async (rt: MatchRuntime): Promise<FakeSocket> => {
  const socket = new FakeSocket();
  await handleConnection(rt, socket as unknown as WebSocket, { url: "/" } as IncomingMessage);
  return socket;
};

const manualClock = (): { timers: TickSchedulerTimers; ticks: (n: number) => void } => {
  let nowMs = 0;
  let pending: (() => void) | null = null;
  return {
    timers: {
      now: () => nowMs,
      setTimer: (fn) => {
        pending = fn;
        return () => {
          pending = null;
        };
      },
    },
    ticks: (n) => {
      for (let i = 0; i < n; i += 1) {
        nowMs += TICK_MS;
        const wake = pending;
        pending = null;
        wake?.();
      }
    },
  };
};

const setBots = (bots: LobbyBots): ClientMessage => ({ type: "setBots", ...bots });

let current: MatchRuntime | undefined;
let loop: TickScheduler | undefined;
afterEach(() => {
  loop?.stop();
  if (current) current.closed = true;
  current?.bots.dispose();
  current?.simulation.dispose();
  loop = undefined;
  current = undefined;
});

describe("Bots fill a Lobby (M17 ticket 10, ADR 0129)", () => {
  it("takes Bot settings from the host alone, in LOBBY alone, validated whole, and sends them on the snapshot", async () => {
    const { rt } = runtime();
    current = rt;
    const clock = manualClock();
    loop = startMatchLoop(rt, { timers: clock.timers });
    const host = await connect(rt);
    const guest = await connect(rt);

    guest.say(setBots({ enabled: true, max: 2, level: "hard" }));
    host.say(setBots({ enabled: true, max: 4, level: "hard" })); // past capacity less the host
    host.say({ type: "setBots", enabled: true, max: 1, level: "insane" } as unknown as ClientMessage);
    clock.ticks(1);
    expect(host.lastSnapshot().lobby.bots).toEqual({ enabled: false, max: 3, level: "normal" });

    host.say(setBots({ enabled: true, max: 2, level: "easy" }));
    clock.ticks(1);
    expect(host.lastSnapshot().lobby.bots).toEqual({ enabled: true, max: 2, level: "easy" });
    expect(guest.lastSnapshot().lobby.bots).toEqual({ enabled: true, max: 2, level: "easy" });

    // Once `start` is sent the fill has happened, and a change would describe Bots never seated.
    host.say({ type: "setReady", ready: true });
    guest.say({ type: "setReady", ready: true });
    host.say({ type: "start" });
    host.say(setBots({ enabled: false, max: 0, level: "normal" }));
    expect(rt.lobbyBots).toEqual({ enabled: true, max: 2, level: "easy" });
  });

  it("starts from the settings the Lobby was created with", () => {
    const { rt } = runtime({ bots: { enabled: true, max: 1, level: "hard" } });
    current = rt;
    expect(rt.lobbyBots).toEqual({ enabled: true, max: 1, level: "hard" });
  });

  it("lets a host alone start against Bots, filling min(max, free seats) behind every human", async () => {
    const { rt, reports } = runtime({ maxPlayers: 4, playersToStart: 2 });
    current = rt;
    const clock = manualClock();
    loop = startMatchLoop(rt, { timers: clock.timers });
    const host = await connect(rt);
    host.say({ type: "setReady", ready: true });

    // Alone and without Bots, the bar of two is not met.
    host.say({ type: "start" });
    clock.ticks(1);
    expect(rt.match.phase).toBe("LOBBY");

    host.say(setBots({ enabled: true, max: 3, level: "normal" }));
    host.say({ type: "start" });
    clock.ticks(1);
    expect(rt.match.phase).toBe("LOADING");

    const snapshot = host.lastSnapshot();
    const hostRow = snapshot.lobby.players.find((row) => !rt.bots.has(row.id))!;
    const botRows = snapshot.lobby.players.filter((row) => row.id !== hostRow.id);
    // Four seats, one taken: three Bots, each behind the host in line.
    expect(botRows).toHaveLength(3);
    expect(snapshot.lobby.hostId).toBe(hostRow.id);
    for (const bot of botRows) {
      expect(bot.joinOrder).toBeGreaterThan(hostRow.joinOrder);
      expect(BOT_NICKNAMES).toContain(bot.nickname);
      expect(bot.hat).not.toBeNull();
      expect((bot.color === null) !== (bot.skin === null)).toBe(true);
      // A row like a Player's, and nothing on it says otherwise.
      expect(Object.keys(bot).sort()).toEqual(Object.keys(hostRow).sort());
    }
    expect(new Set(botRows.map((bot) => bot.nickname)).size).toBe(3);
    // The Round's board opened with the Bots as runners one can back.
    expect(reports.bettingOpened[0]!.runners.map((runner) => runner.playerId).sort()).toEqual(
      snapshot.lobby.players.map((row) => row.id).sort(),
    );
  });

  it("never fills a place a live Reservation holds", async () => {
    const { rt } = runtime({ maxPlayers: 4 });
    current = rt;
    await connect(rt);
    rt.setLobbyBots({ enabled: true, max: 3, level: "normal" });
    expect(rt.botsToFill()).toBe(3);
    expect("granted" in rt.reserveSeats(["friend"])).toBe(true);
    expect(rt.botsToFill()).toBe(2);
  });

  it("never makes a Bot host, even one that joined ahead of the humans left", async () => {
    const { rt } = runtime();
    current = rt;
    const clock = manualClock();
    loop = startMatchLoop(rt, { timers: clock.timers });
    const first = await connect(rt);
    // Ticket 03's case: a Bot seated in the Lobby before a later human.
    const botId = rt.addBot()!;
    const second = await connect(rt);
    first.close();
    clock.ticks(1);

    const snapshot = second.lastSnapshot();
    expect(snapshot.lobby.hostId).not.toBe(botId);
    expect(snapshot.lobby.hostId).toBe(rt.hostId());
    expect(rt.hostId()).toBeDefined();
    expect(rt.bots.has(rt.hostId()!)).toBe(false);
  });

  it("keeps the same Bots for every Round of the Match, and none of them keeps anything", async () => {
    const { rt, reports } = runtime({ matchLengthOverride: 2, playersToStart: 2, maxPlayers: 3, timeLimitMsOverride: 1_000 });
    current = rt;
    const clock = manualClock();
    loop = startMatchLoop(rt, { timers: clock.timers });
    const host = await connect(rt);
    host.say({ type: "auth", token: "host-token" });
    await new Promise((resolve) => setImmediate(resolve));
    host.say(setBots({ enabled: true, max: 2, level: "normal" }));
    host.say({ type: "setReady", ready: true });
    host.say({ type: "start" });
    clock.ticks(1);
    const loaded = (): void => host.say({ type: "loaded", trackId: rt.fetched.id, trackRevision: rt.fetched.revision });
    loaded();
    await rt.bots.whenReady();
    clock.ticks(2);
    expect(rt.match.phase).toBe("RUNNING");
    const roundOneBots = [...rt.bots.ids()].map((id) => ({ ...rt.lobbyPlayers.get(id)! }));
    expect(roundOneBots).toHaveLength(2);

    // Round 1 runs out its clock, and the Standings move on once Round 2's draw
    // has failed over to the same Track.
    clock.ticks(40);
    expect(rt.match.phase).toBe("RESULTS");
    await rt.matchStructurePromise;
    await new Promise((resolve) => setImmediate(resolve));
    clock.ticks(1);
    expect(rt.match.phase).toBe("LOADING");
    loaded();
    await rt.bots.whenReady();
    clock.ticks(2);
    expect(rt.match.phase).toBe("RUNNING");
    // The same Bots, the same names and looks, and in the world again.
    expect([...rt.bots.ids()].map((id) => rt.lobbyPlayers.get(id))).toEqual(roundOneBots);
    for (const bot of roundOneBots) expect(rt.simulation.snapshot().characters[bot.id]).toBeDefined();

    clock.ticks(40);
    expect(rt.match.phase).toBe("RESULTS");
    await new Promise((resolve) => setImmediate(resolve));

    // Placed in every Round, named on the results, and attributed to no Account.
    const saved = reports.saved[0]!;
    expect(saved.results).toHaveLength(2);
    for (const round of saved.results) {
      for (const bot of roundOneBots) expect(round.rows.some((row) => row.id === bot.id && row.placement >= 1)).toBe(true);
    }
    for (const bot of roundOneBots) expect(saved.nicknames[bot.id]).toBe(bot.nickname);
    expect(Object.values(saved.accountIds ?? {})).toEqual(["acc-host"]);
    // Each Round is one play of its Track, however many Bots were in it.
    expect(reports.plays).toEqual([fetched.id, fetched.id]);
  });

  it("sends every Bot away when the Lobby goes back to LOBBY, keeps the settings, and the next start fills afresh", async () => {
    const { rt } = runtime({ maxPlayers: 4, playersToStart: 1 });
    current = rt;
    const clock = manualClock();
    loop = startMatchLoop(rt, { timers: clock.timers });
    const host = await connect(rt);
    host.say(setBots({ enabled: true, max: 2, level: "hard" }));
    host.say({ type: "setReady", ready: true });
    host.say({ type: "start" });
    clock.ticks(1);
    const firstBots = [...rt.bots.ids()];
    expect(firstBots).toHaveLength(2);

    rt.resetToFreshLobby(rt.fetched.track);
    expect(rt.bots.size).toBe(0);
    for (const id of firstBots) expect(rt.lobbyPlayers.has(id)).toBe(false);
    expect(rt.lobbyBots).toEqual({ enabled: true, max: 2, level: "hard" });

    host.say({ type: "setReady", ready: true });
    host.say({ type: "start" });
    clock.ticks(1);
    expect(rt.bots.size).toBe(2);
    for (const id of rt.bots.ids()) expect(firstBots).not.toContain(id);
  });
});
