import type {
  SimState,
  SnapshotMessage,
  WelcomeMessage,
} from "@dont-fall/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLobbyConnection, toLobbySnapshot } from "./lobbyConnection.js";

const welcome: WelcomeMessage = {
  type: "welcome",
  playerId: "p1",
  sessionToken: "token",
  spawn: { x: 0, y: 2, z: 0 },
  trackId: "track-1",
  trackRevision: 3,
  config: { snapshotHz: 15, graceWindowMs: 10_000, playersToStart: 2, maxPlayers: 10 },
};

// `state` is never read by the Lobby projection — the fixture carries an
// explicit hole rather than a 60-field SimState nobody asserts on.
const snapshot = (overrides: Partial<SnapshotMessage> = {}): SnapshotMessage =>
  ({
    type: "snapshot",
    matchId: "match-1",
    state: {} as unknown as SimState,
    serverTimeMs: 1000,
    timeLeftMs: 180_000,
    phase: "LOBBY",
    roundRules: {
      timeLimitMs: 180_000,
      fallBehavior: "respawn",
      survivorTarget: 1,
      inputLockMode: "countdown",
    },
    countdownMsLeft: 0,
    dnf: [],
    standingsReady: [],
    trackId: "track-1",
    trackRevision: 3,
    lobby: {
      hostId: "p1",
      players: [{ id: "p1", nickname: "Host", ready: false, joinOrder: 0, accountId: null }],
      roundType: "race",
      matchLength: 3,
      roundPicks: [
        { trackId: null, roundType: null },
        { trackId: null, roundType: "survival" },
      ],
    },
    roundResults: [],
    roundsRemaining: true,
    matchOver: null,
    ...overrides,
  }) as SnapshotMessage;

describe("toLobbySnapshot", () => {
  it("projects the server snapshot onto what the Lobby Screen renders — rendered, never computed", () => {
    expect(toLobbySnapshot("p1", 10, snapshot())).toEqual({
      myId: "p1",
      matchId: "match-1",
      phase: "LOBBY",
      matchOver: null,
      countdownMsLeft: 0,
      hostId: "p1",
      players: [{ id: "p1", nickname: "Host", ready: false, joinOrder: 0, accountId: null }],
      trackId: "track-1",
      trackRevision: 3,
      timeLimitMs: 180_000,
      roundType: "race",
      survivorTarget: 1,
      startBlockedReason: undefined,
      matchLength: 3,
      roundPicks: [
        { trackId: null, roundType: null },
        { trackId: null, roundType: "survival" },
      ],
      maxPlayers: 10,
    });
  });

  it("carries the server's own countdown through, so the overlay's beat can't drift from the Round's start", () => {
    const counting = snapshot({ phase: "COUNTDOWN", countdownMsLeft: 2400 });
    expect(toLobbySnapshot("p1", 10, counting).countdownMsLeft).toBe(2400);
  });

  it("carries the server's own start-blocked reason through, or nothing when it can start", () => {
    const blocked = snapshot({ lobby: { ...snapshot().lobby, startBlockedReason: "a Race needs a Finish Zone" } });
    expect(toLobbySnapshot("p1", 10, blocked).startBlockedReason).toBe("a Race needs a Finish Zone");
  });

  it("carries matchOver through once the server saved the finished Match", () => {
    const over = snapshot({ phase: "RESULTS", matchOver: { matchId: "match-1" } });
    expect(toLobbySnapshot("p1", 10, over).matchOver).toEqual({ matchId: "match-1" });
  });
});

interface FakeSocket {
  url: string;
  readyState: number;
  sent: string[];
  closed: boolean;
  listenerCount: () => number;
  dispatch: (type: string, event?: Record<string, unknown>) => void;
}

const installFakeWebSocket = () => {
  const instances: FakeSocket[] = [];
  class FakeWebSocket {
    static readonly OPEN = 1;
    url: string;
    readyState = FakeWebSocket.OPEN;
    sent: string[] = [];
    closed = false;
    private listeners = new Map<string, Set<EventListener>>();
    constructor(url: string) {
      this.url = url;
      instances.push(this);
    }
    send = (data: string): void => {
      this.sent.push(data);
    };
    close = (): void => {
      this.closed = true;
    };
    addEventListener = (type: string, listener: EventListener): void => {
      const set = this.listeners.get(type) ?? new Set();
      set.add(listener);
      this.listeners.set(type, set);
    };
    removeEventListener = (type: string, listener: EventListener): void => {
      this.listeners.get(type)?.delete(listener);
    };
    listenerCount = (): number => [...this.listeners.values()].reduce((n, set) => n + set.size, 0);
    dispatch = (type: string, event: Record<string, unknown> = {}): void => {
      for (const listener of [...(this.listeners.get(type) ?? [])]) listener({ type, ...event } as unknown as Event);
    };
  }
  vi.stubGlobal("WebSocket", FakeWebSocket);
  return instances;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createLobbyConnection", () => {
  it("opens the brokered port and resolves with the welcome's identity", async () => {
    const instances = installFakeWebSocket();
    const pending = createLobbyConnection({ host: "localhost", serverPort: 51234 });

    expect(instances).toHaveLength(1);
    expect(instances[0]!.url).toBe("ws://localhost:51234/");
    instances[0]!.dispatch("message", { data: JSON.stringify(welcome) });

    const connection = await pending;
    expect(connection.myId).toBe("p1");
    expect(connection.welcome).toEqual(welcome);
    expect(connection.getLobby()).toBeNull(); // no snapshot yet
    // Idle phases broadcast only on change (ADR 0057) — the wrapper asks
    // for the current state outright, so a listener attached after the
    // join-push still gets one on the next tick.
    expect(instances[0]!.sent.map((raw) => JSON.parse(raw))).toEqual([{ type: "sync" }]);
    connection.close();
  });

  it("binds the connection to its Account right after sync when a session is stored (phase 2b)", async () => {
    localStorage.setItem("df_auth_token", "sess-123");
    try {
      const instances = installFakeWebSocket();
      const pending = createLobbyConnection({ host: "localhost", serverPort: 51234 });
      instances[0]!.dispatch("message", { data: JSON.stringify(welcome) });

      const connection = await pending;
      expect(instances[0]!.sent.map((raw) => JSON.parse(raw))).toEqual([
        { type: "sync" },
        { type: "auth", token: "sess-123" },
      ]);
      connection.close();
    } finally {
      localStorage.removeItem("df_auth_token");
    }
  });

  it("stays anonymous when no session is stored — the socket still works", async () => {
    localStorage.removeItem("df_auth_token");
    const instances = installFakeWebSocket();
    const pending = createLobbyConnection({ host: "localhost", serverPort: 51234 });
    instances[0]!.dispatch("message", { data: JSON.stringify(welcome) });

    const connection = await pending;
    expect(instances[0]!.sent.map((raw) => JSON.parse(raw))).toEqual([{ type: "sync" }]);
    connection.close();
  });

  it("notifies subscribers on Lobby-changing snapshots, deduped against the snapshot rate", async () => {
    const instances = installFakeWebSocket();
    const pending = createLobbyConnection({ host: "localhost" });
    instances[0]!.dispatch("message", { data: JSON.stringify(welcome) });
    const connection = await pending;

    const seen: string[] = [];
    const stop = connection.subscribeLobby((lobby) => seen.push(lobby.phase));
    instances[0]!.dispatch("message", { data: JSON.stringify(snapshot()) });
    instances[0]!.dispatch("message", { data: JSON.stringify(snapshot()) }); // identical — swallowed
    instances[0]!.dispatch("message", { data: JSON.stringify(snapshot({ phase: "COUNTDOWN" })) });
    stop();
    instances[0]!.dispatch("message", { data: JSON.stringify(snapshot({ phase: "RUNNING" })) }); // unsubscribed

    expect(seen).toEqual(["LOBBY", "COUNTDOWN"]);
    expect(connection.getLobby()?.phase).toBe("RUNNING");
    connection.close();
  });

  it("sends every Lobby action as the server's own message shape while open", async () => {
    const instances = installFakeWebSocket();
    const pending = createLobbyConnection({ host: "localhost" });
    instances[0]!.dispatch("message", { data: JSON.stringify(welcome) });
    const connection = await pending;

    connection.setNickname("Wobbleton");
    connection.setReady(true);
    connection.selectTrack("track-2");
    connection.setRoundType("survival");
    connection.setMatchLength(5);
    connection.pickRoundSlot(1, null, "race");
    connection.start();
    connection.standingsReady();

    expect(instances[0]!.sent.map((raw) => JSON.parse(raw))).toEqual([
      { type: "sync" }, // asked outright on connect (ADR 0057), before anything else
      { type: "setNickname", nickname: "Wobbleton" },
      { type: "setReady", ready: true },
      { type: "selectTrack", trackId: "track-2" },
      { type: "setRoundType", roundType: "survival" },
      { type: "setMatchLength", matchLength: 5 },
      { type: "pickRoundSlot", roundIndex: 1, trackId: null, roundType: "race" },
      { type: "start" },
      { type: "standingsReady" },
    ]);
    connection.close();
  });

  it("fires onClose when the socket drops, and close() is idempotent with listeners removed", async () => {
    const instances = installFakeWebSocket();
    const pending = createLobbyConnection({ host: "localhost" });
    instances[0]!.dispatch("message", { data: JSON.stringify(welcome) });
    const connection = await pending;

    const closed: string[] = [];
    const stop = connection.onClose(() => closed.push("down"));
    instances[0]!.dispatch("close");
    expect(closed).toEqual(["down"]);

    stop();
    connection.close();
    connection.close();
    expect(instances[0]!.closed).toBe(true);
    expect(instances[0]!.listenerCount()).toBe(0);
  });

  it("rejects and releases the socket when no welcome ever arrives", async () => {
    const instances = installFakeWebSocket();
    const pending = createLobbyConnection({ host: "localhost" });

    instances[0]!.dispatch("error");

    await expect(pending).rejects.toThrow(/before the server's welcome/);
    expect(instances[0]!.closed).toBe(true);
    expect(instances[0]!.listenerCount()).toBe(0);
  });
});
