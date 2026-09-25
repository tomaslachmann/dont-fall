import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BASE_RACE_TRACK,
  SEAT_RESERVATION_TTL_MS,
  TICK_MS,
  TICK_RATE_HZ,
  buildBotTrackData,
  initNavigation,
  initPhysics,
  loadAssetLibrary,
  type ClientMessage,
  type Module,
  type ResolvedTrack,
  type TrackNavData,
  type SnapshotMessage,
  type Vec3,
} from "@dont-fall/shared";
import type { WebSocket } from "ws";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { handleConnection } from "../server/connections.js";
import type { FetchedTrack } from "../track/trackSource.js";
import { startMatchLoop } from "./matchLoop.js";
import { MatchRuntime, type MatchConfig } from "./matchRuntime.js";
import type { BotTrackBuilder } from "./botTracks.js";
import type { TickScheduler, TickSchedulerTimers } from "./tickScheduler.js";

/**
 * M17 ticket 03 on a real `MatchRuntime`, the real connection handler and the
 * real tick loop, on a clock the test turns Tick by Tick: one Player on a
 * socket, one Bot with none, and a Race on the base race.
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

const configWith = (maxPlayers: number): MatchConfig => ({
  matchId: "bot-match",
  trackServiceUrl: "http://unused",
  trackFetchRetryOptions: {},
  countdownMs: 0,
  roundEndMs: 0,
  standingsReadyTimeoutMs: 0,
  playersToStart: 1,
  maxPlayers,
  reservationTtlMs: SEAT_RESERVATION_TTL_MS,
  // One Round: a `start` here draws nothing from the (absent) API.
  matchLengthOverride: 1,
});

/** No API behind this Match: every report it makes lands nowhere. */
const quietRuntime = (maxPlayers: number, botTracks?: BotTrackBuilder): MatchRuntime =>
  new MatchRuntime(
    configWith(maxPlayers),
    fetched,
    library,
    { openRound: async () => {}, closeRound: async () => {}, settleRound: async () => {} },
    { saveResult: async () => true },
    { recordPlay: async () => {} },
    { resolveAccount: async () => null },
    { recordRuns: async () => {} },
    botTracks,
  );

/** Enough of a `ws` socket for the connection handler and the loop: it records what it is sent. */
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

/** A clock the loop runs on that moves only when the test says. */
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

const groundDistance = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.z - b.z);

let rt: MatchRuntime | undefined;
let loop: TickScheduler | undefined;
afterEach(() => {
  loop?.stop();
  rt?.bots.dispose();
  rt?.simulation.dispose();
  loop = undefined;
  rt = undefined;
});

describe("a Bot is an input source on the authority (M17 ticket 03)", () => {
  it("one Player and one Bot start a Race, and the Bot runs toward the finish", async () => {
    rt = quietRuntime(4);
    const clock = manualClock();
    loop = startMatchLoop(rt, { timers: clock.timers });
    const player = await connect(rt);
    const botId = rt.addBot()!;
    expect(botId).not.toBeNull();

    // The host starts; the Bot needs no Ready and no `loaded` (ADR 0089).
    player.say({ type: "setReady", ready: true });
    player.say({ type: "start" });
    clock.ticks(1);
    expect(rt.match.phase).toBe("LOADING");
    player.say({ type: "loaded", trackId: fetched.id, trackRevision: fetched.revision });
    // The Bots' navmesh comes from the worker thread (ticket 05); the Round waits for it.
    await rt.bots.whenReady();
    clock.ticks(3);
    expect(rt.match.phase).toBe("RUNNING");

    const firstCheckpoint = rt.raceTargets.checkpoints[0]!;
    const before = rt.simulation.snapshot().characters[botId]!.position;
    clock.ticks(8 * TICK_RATE_HZ);
    const after = rt.simulation.snapshot().characters[botId]!;

    expect(groundDistance(after.position, firstCheckpoint)).toBeLessThan(groundDistance(before, firstCheckpoint) - 20);
    expect(after.fallCount).toBe(0);
    // Its body is turned the way it ran, as a client's is (ADR 0085): facing
    // yaw 0 looks down −Z.
    const run = Math.atan2(after.position.x - before.x, -(after.position.z - before.z));
    expect(Math.cos(after.facing - run)).toBeGreaterThan(0.9);
  });

  it("looks like a Player on the wire: a row like anyone's, loaded and Ready, with nothing marking it", async () => {
    rt = quietRuntime(4);
    const clock = manualClock();
    loop = startMatchLoop(rt, { timers: clock.timers });
    const player = await connect(rt);
    const botId = rt.addBot()!;
    player.say({ type: "setReady", ready: true });
    player.say({ type: "start" });
    clock.ticks(2);

    const snapshot = player.lastSnapshot();
    const playerRow = snapshot.lobby.players.find((row) => row.id !== botId)!;
    const botRow = snapshot.lobby.players.find((row) => row.id === botId)!;
    expect(Object.keys(botRow).sort()).toEqual(Object.keys(playerRow).sort());
    expect(botRow).toMatchObject({ accountId: null, ready: true });
    expect(snapshot.loaded).toContain(botId);
    expect(Object.keys(snapshot.state.characters[botId]!).sort()).toEqual(
      Object.keys(snapshot.state.characters[playerRow.id]!).sort(),
    );
  });

  it("counts a Bot's seat with the connections and the Reservations, and a held Reservation wins", async () => {
    rt = quietRuntime(3);
    await connect(rt);
    expect("granted" in rt.reserveSeats(["friend"])).toBe(true);
    expect(rt.addBot()).not.toBeNull();

    // Three seats of three: no Bot, no Reservation and no connection gets a fourth.
    expect(rt.addBot()).toBeNull();
    expect(rt.reserveSeats(["stranger"])).toEqual({ refused: expect.any(String) });
    const refused = await connect(rt);
    expect(refused.closeCode).toBe(4003);
  });

  it("leaves with the last Player, so an empty Lobby is not held open by its Bots", async () => {
    rt = quietRuntime(4);
    const player = await connect(rt);
    const botId = rt.addBot()!;

    player.close();

    expect(rt.bots.size).toBe(0);
    expect(rt.lobbyPlayers.has(botId)).toBe(false);
    expect(rt.seatsTaken()).toBe(0);
  });

  it("holds the Round in LOADING until the Bots' navmesh arrives from the worker, and a failed build never holds it forever (ticket 05)", async () => {
    // A builder the test answers by hand, so the gate is proven Tick by Tick.
    const builds: { resolve: (data: TrackNavData) => void; reject: (error: Error) => void; resolved: ResolvedTrack }[] = [];
    const byHand: BotTrackBuilder = (resolved) => new Promise((resolve, reject) => builds.push({ resolve, reject, resolved }));
    rt = quietRuntime(4, byHand);
    const clock = manualClock();
    loop = startMatchLoop(rt, { timers: clock.timers });
    const player = await connect(rt);
    expect(rt.addBot()).not.toBeNull();
    player.say({ type: "setReady", ready: true });
    player.say({ type: "start" });
    clock.ticks(1);
    player.say({ type: "loaded", trackId: fetched.id, trackRevision: fetched.revision });
    clock.ticks(30);
    expect(rt.match.phase).toBe("LOADING");
    expect(builds).toHaveLength(1);

    builds[0]!.resolve(buildBotTrackData(builds[0]!.resolved));
    await rt.bots.whenReady();
    clock.ticks(3);
    expect(rt.match.phase).toBe("RUNNING");

    // A build that fails: the Bots stand still, and the Round is not held.
    rt.bots.worldChanged(builds[0]!.resolved);
    expect(rt.bots.ready()).toBe(false);
    builds[1]!.reject(new Error("no navmesh"));
    await rt.bots.whenReady();
    expect(rt.bots.ready()).toBe(true);
  });
});
