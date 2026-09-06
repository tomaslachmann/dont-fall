import { createServer } from "node:http";
import {
  COUNTDOWN_MS,
  DEFAULT_TIME_LIMIT_MS,
  M1_TRACK,
  MIN_TIME_LIMIT_MS,
  RapierSimulation,
  type ClientMessage,
  type ServerMessage,
  type SimInputs,
  type Track,
} from "@dont-fall/shared";
import { startTrackService, type TrackService } from "@dont-fall/track-service";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { startServer, type MatchServer } from "./index.js";

// ADR 0028: the Match server now has a hard runtime dependency on track-service.
// One shared instance for this whole file, pointed to by TRACK_SERVICE_URL, so
// every existing `startServer({ port: 0, playersToStart: 1, countdownMs: 0 })` call site below keeps working
// unchanged — `startServer` picks up the env var as its default.
let trackService: TrackService;

beforeAll(async () => {
  trackService = await startTrackService({ port: 0, dbPath: ":memory:" });
  process.env.TRACK_SERVICE_URL = `http://localhost:${trackService.port}`;
});

afterAll(async () => {
  await trackService.close();
  delete process.env.TRACK_SERVICE_URL;
});

// M4 ticket 04: a Round now waits for `PLAYERS_TO_START` (2) connected
// Players before its Countdown starts, and input is locked until it is
// RUNNING (ADR 0040). Every test below that predates M4 is about netcode —
// input application, reconciliation, disconnects — and needs a server that is
// simply *in* a Round with the one client it connects, so it asks for a
// one-Player start with no Countdown to sit through. The Countdown block at
// the bottom of this file is where the real two-Player trigger and the real
// three-second hold are exercised.
let server: MatchServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

/** `query` (e.g. `"?track=<id>"`) rides straight through to `req.url` on the server's own 'connection' handler. */
const connect = (port: number, query = ""): WebSocket => new WebSocket(`ws://localhost:${port}${query}`);

const nextMessage = (socket: WebSocket): Promise<ServerMessage> =>
  new Promise((resolve) => socket.once("message", (raw) => resolve(JSON.parse(raw.toString()) as ServerMessage)));

/**
 * Publishes `track` to the shared test track-service instance, returning its
 * trackId — Track Builder Playtest's own publish step, without going through
 * the builder itself. Passing `id` republishes that exact id as a new
 * Revision (ADR 0032) instead of creating a fresh one — Playtest always
 * reuses the same fixed reserved id across repeated clicks.
 */
const publishTrack = async (track: Track = M1_TRACK, id?: string, timeLimitMs?: number): Promise<string> => {
  const res = await fetch(`http://localhost:${trackService.port}/tracks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ track, ...(id ? { id } : {}), ...(timeLimitMs !== undefined ? { timeLimitMs } : {}) }),
  });
  const body = (await res.json()) as { id: string };
  return body.id;
};

const nextClose = (socket: WebSocket): Promise<{ code: number; reason: string }> =>
  new Promise((resolve) => socket.once("close", (code, reason) => resolve({ code, reason: reason.toString() })));

const NORTH: SimInputs = { moveDirection: { x: 0, y: 0, z: -1 }, jumpHeld: false, dashHeld: false };

const sendInput = (socket: WebSocket, tick: number, input: SimInputs): void =>
  socket.send(JSON.stringify({ type: "input", inputs: [{ tick, input }] } satisfies ClientMessage));

/** Send several ticks' inputs in one packet — exercises the redundant-input array (ADR 0021). */
const sendInputs = (socket: WebSocket, entries: { tick: number; input: SimInputs }[]): void =>
  socket.send(JSON.stringify({ type: "input", inputs: entries } satisfies ClientMessage));

/**
 * The Lobby dance (M4 ticket 07) every pre-ticket-07 test below needs before
 * it can reach COUNTDOWN/RUNNING, now that a Round no longer auto-starts the
 * instant enough Players connect: everyone marks themselves Ready, then the
 * host — `sockets[0]`, since the server resolves the host as the first
 * joiner and these tests always connect in the order they list — asks to
 * start. Call it right after every socket in `sockets` has its `welcome`.
 *
 * Waits for a snapshot confirming every Player's `ready` before sending
 * `start`: `setReady` and `start` travel independent WebSocket connections,
 * so nothing orders "b's setReady lands" before "a's start is processed" —
 * sending `start` right away is a real race the server loses just as often
 * as it wins, seen as `start` reading a stale, not-yet-Ready `b`.
 */
const startMatch = async (...sockets: WebSocket[]): Promise<void> => {
  for (const socket of sockets) socket.send(JSON.stringify({ type: "setReady", ready: true } satisfies ClientMessage));
  const host = sockets[0];
  if (!host) return;
  await new Promise<void>((resolve) => {
    const onMessage = (raw: Buffer): void => {
      const message = JSON.parse(raw.toString()) as ServerMessage;
      if (message.type !== "snapshot") return;
      if (message.lobby.players.length < sockets.length) return;
      if (!message.lobby.players.every((p) => p.ready)) return;
      host.off("message", onMessage);
      resolve();
    };
    host.on("message", onMessage);
  });
  host.send(JSON.stringify({ type: "start" } satisfies ClientMessage));
};

describe("startServer", () => {
  it("welcomes each client with a public playerId, a secret sessionToken, the spawn, and config", async () => {
    server = await startServer({ port: 0, playersToStart: 1, countdownMs: 0 });
    const socket = connect(server.port);
    const welcome = await nextMessage(socket);

    expect(welcome.type).toBe("welcome");
    if (welcome.type !== "welcome") throw new Error("unreachable");
    expect(typeof welcome.playerId).toBe("string");
    // Bearer credential — high entropy, base64url, never a UUID (ADR 0024).
    expect(welcome.sessionToken).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(welcome.sessionToken).not.toBe(welcome.playerId);
    expect(welcome.config.snapshotHz).toBeGreaterThan(0);
    expect(welcome.config.graceWindowMs).toBeGreaterThan(0);
    // ticket 11: every client learns the exact Track (id + Revision) the
    // server fetched, so it can fetch that same one instead of "latest".
    expect(typeof welcome.trackId).toBe("string");
    expect(welcome.trackRevision).toBeGreaterThanOrEqual(1);
    // The client seeds its local prediction from the spawn, so it must be where
    // the server actually placed the Character (before it settles under gravity).
    const snapshot = await nextMessage(socket);
    if (snapshot.type !== "snapshot") throw new Error("unreachable");
    const p = snapshot.state.characters[welcome.playerId]!.position;
    expect(p.x).toBeCloseTo(welcome.spawn.x, 5);
    expect(p.z).toBeCloseTo(welcome.spawn.z, 5);
    socket.close();
  });

  it("stamps every snapshot with serverTimeMs and this client's commandQueueDepth", async () => {
    server = await startServer({ port: 0, playersToStart: 1, countdownMs: 0 });
    const socket = connect(server.port);
    await nextMessage(socket); // welcome
    const snapshot = await nextMessage(socket);
    if (snapshot.type !== "snapshot") throw new Error("unreachable");
    expect(snapshot.serverTimeMs).toBeGreaterThan(0);
    expect(snapshot.commandQueueDepth).toBe(0); // nothing sent yet
    socket.close();
  });

  it("replies to a ping with a pong echoing the client time plus the server time", async () => {
    server = await startServer({ port: 0, playersToStart: 1, countdownMs: 0 });
    const socket = connect(server.port);
    await nextMessage(socket); // welcome

    socket.send(JSON.stringify({ type: "ping", clientTimeMs: 123456 }));
    let pong: ServerMessage | undefined;
    for (let i = 0; i < 20 && !pong; i += 1) {
      const m = await nextMessage(socket);
      if (m.type === "pong") pong = m;
    }
    if (pong?.type !== "pong") throw new Error("no pong");
    expect(pong.clientTimeMs).toBe(123456);
    expect(pong.serverTimeMs).toBeGreaterThan(0);
    socket.close();
  });

  it("applies a batch of inputs from one packet and dedupes repeats by tick (ADR 0021)", async () => {
    server = await startServer({ port: 0, playersToStart: 1, countdownMs: 0 });
    const socket = connect(server.port);
    const welcome = await nextMessage(socket);
    if (welcome.type !== "welcome") throw new Error("unreachable");
    await startMatch(socket);
    const first = await nextMessage(socket);
    if (first.type !== "snapshot") throw new Error("unreachable");
    const startZ = first.state.characters[welcome.playerId]!.position.z;
    // ADR 0027: the server applies `input[serverTick]`, so tick numbers must
    // share the server's own tick space — not an arbitrary small counter,
    // which would already be stale by the time it arrives.
    const base = first.state.tick;

    // One packet carrying the next 10 ticks, then re-send the last 5 (the
    // redundant tail) — the server must apply each tick once and walk north.
    sendInputs(socket, Array.from({ length: 10 }, (_, i) => ({ tick: base + 1 + i, input: NORTH })));
    sendInputs(socket, Array.from({ length: 5 }, (_, i) => ({ tick: base + 6 + i, input: NORTH })));

    let acked = 0;
    let z = startZ;
    for (let i = 0; i < 30 && acked < base + 10; i += 1) {
      const m = await nextMessage(socket);
      if (m.type === "snapshot") {
        acked = m.state.characters[welcome.playerId]!.lastInputTick;
        z = m.state.characters[welcome.playerId]!.position.z;
      }
    }
    expect(acked).toBe(base + 10); // every batched tick applied, no dupes stuck in the queue
    expect(z).toBeLessThan(startZ); // and it actually moved
    socket.close();
  });

  it("broadcasts a snapshot every tick containing the connected client's Character", async () => {
    server = await startServer({ port: 0, playersToStart: 1, countdownMs: 0 });
    const socket = connect(server.port);
    const welcome = await nextMessage(socket);
    const id = (welcome as { playerId: string }).playerId;

    const snapshot = await nextMessage(socket);
    expect(snapshot.type).toBe("snapshot");
    if (snapshot.type !== "snapshot") throw new Error("unreachable");
    expect(Object.keys(snapshot.state.characters)).toEqual([id]);
    socket.close();
  });

  it("moves the Character in the direction of the input the client sends", async () => {
    server = await startServer({ port: 0, playersToStart: 1, countdownMs: 0 });
    const socket = connect(server.port);
    const welcome = await nextMessage(socket);
    const id = (welcome as { playerId: string }).playerId;
    await startMatch(socket);

    const first = await nextMessage(socket);
    if (first.type !== "snapshot") throw new Error("unreachable");
    const startZ = first.state.characters[id]!.position.z;

    // Chase the server's own tick each iteration (ADR 0027) — a small lead so
    // a packet isn't already stale by the time it's simulated.
    let tick = first.state.tick;
    let lastZ = startZ;
    let lastSnapshot: ServerMessage | undefined;
    for (let i = 0; i < 30; i += 1) {
      sendInput(socket, tick + 2, NORTH);
      const message = await nextMessage(socket);
      if (message.type === "snapshot") {
        tick = message.state.tick;
        lastZ = message.state.characters[id]!.position.z;
        lastSnapshot = message;
      }
    }

    expect(lastZ).toBeLessThan(startZ - 1); // NORTH walks toward -z
    // The server echoes the last input tick it applied, for reconciliation (ticket 05).
    if (lastSnapshot?.type !== "snapshot") throw new Error("unreachable");
    expect(lastSnapshot.state.characters[id]!.lastInputTick).toBeGreaterThan(0);
    socket.close();
  });

  it("a single failed physics tick does not permanently desync serverTick from state.tick (ADR 0027)", async () => {
    // `RapierSimulation.tick()` only advances its own tick count after
    // `world.step()` succeeds. Force exactly one throw, mid-session (once a
    // real client is already connected and walking, not on the server's cold
    // start before anyone's joined), and prove the server's own tick counter
    // doesn't advance past it either — which would desync every subsequent
    // input match against that client, forever.
    let armed = false;
    let failuresInjected = 0;
    const realTick = RapierSimulation.prototype.tick;
    const patched = vi.spyOn(RapierSimulation.prototype, "tick").mockImplementation(function (
      this: RapierSimulation,
      ...args: Parameters<typeof realTick>
    ) {
      if (armed && failuresInjected === 0) {
        failuresInjected += 1;
        throw new Error("injected physics failure");
      }
      return realTick.apply(this, args);
    });
    try {
      server = await startServer({ port: 0, playersToStart: 1, countdownMs: 0 });
      const socket = connect(server.port);
      const welcome = await nextMessage(socket);
      const id = (welcome as { playerId: string }).playerId;
      await startMatch(socket);

      const first = await nextMessage(socket);
      if (first.type !== "snapshot") throw new Error("unreachable");
      const startZ = first.state.characters[id]!.position.z;

      let tick = first.state.tick;
      let lastZ = startZ;
      let prevAcked = -1;
      const ackGaps: number[] = [];
      for (let i = 0; i < 40; i += 1) {
        if (i === 10) armed = true; // client is already up and walking — now inject the failure
        sendInput(socket, tick + 2, NORTH);
        const message = await nextMessage(socket);
        if (message.type === "snapshot") {
          tick = message.state.tick;
          lastZ = message.state.characters[id]!.position.z;
          const acked = message.state.characters[id]!.lastInputTick;
          if (prevAcked >= 0) ackGaps.push(acked - prevAcked);
          prevAcked = acked;
        }
      }

      expect(failuresInjected).toBe(1); // the forced failure actually fired
      expect(lastZ).toBeLessThan(startZ - 1); // still walked normally through and after it
      // Every gap between consecutive acks is exactly 1 — `state.tick` and
      // the server's own input-matching tick never drift apart, even across
      // the injected failure. A permanent desync (the bug this test guards
      // against) would show up as every gap *after* the failure jumping to 0
      // (the ack stuck repeating the tick that failed) while `state.tick`
      // itself kept advancing underneath it.
      expect(ackGaps.every((g) => g === 1)).toBe(true);
      socket.close();
    } finally {
      patched.mockRestore();
    }
  });

  it("puts both connected players in the snapshot, at distinct spawn points", async () => {
    server = await startServer({ port: 0, playersToStart: 1, countdownMs: 0 });
    const a = connect(server.port);
    const aId = (await nextMessage(a) as { playerId: string }).playerId;
    const b = connect(server.port);
    const bId = (await nextMessage(b) as { playerId: string }).playerId;

    let both: ServerMessage | undefined;
    for (let i = 0; i < 30; i += 1) {
      const message = await nextMessage(b);
      if (message.type === "snapshot" && aId in message.state.characters && bId in message.state.characters) {
        both = message;
        break;
      }
    }
    if (both?.type !== "snapshot") throw new Error("never saw both players in one snapshot");

    const pa = both.state.characters[aId]!.position;
    const pb = both.state.characters[bId]!.position;
    expect(pa).not.toEqual(pb); // solid Characters must not spawn on the same spot

    a.close();
    b.close();
  });

  it("removes a disconnected client's Character so it stops appearing in broadcasts", async () => {
    server = await startServer({ port: 0, playersToStart: 1, countdownMs: 0 });
    const first = connect(server.port);
    const firstWelcome = await nextMessage(first);
    const firstId = (firstWelcome as { playerId: string }).playerId;
    await nextMessage(first); // first snapshot while both are about to connect

    const second = connect(server.port);
    const secondWelcome = await nextMessage(second);
    const secondId = (secondWelcome as { playerId: string }).playerId;

    first.close();
    await new Promise((resolve) => first.once("close", resolve));

    // Drain snapshots on the second socket until the first Character is gone.
    let sawOnlySecond = false;
    for (let i = 0; i < 30 && !sawOnlySecond; i += 1) {
      const message = await nextMessage(second);
      if (message.type === "snapshot" && Object.keys(message.state.characters).sort().join() === secondId) {
        sawOnlySecond = true;
      }
    }
    expect(sawOnlySecond).toBe(true);
    second.close();
  });
});

describe("startServer — disconnects (ticket 07)", () => {
  const drainUntil = async (
    socket: WebSocket,
    predicate: (message: Extract<ServerMessage, { type: "snapshot" }>) => boolean,
    tries = 40,
  ): Promise<boolean> => {
    for (let i = 0; i < tries; i += 1) {
      const message = await nextMessage(socket);
      if (message.type === "snapshot" && predicate(message)) return true;
    }
    return false;
  };

  it("survives an abrupt drop (no close frame) and keeps serving the remaining player", async () => {
    server = await startServer({ port: 0, playersToStart: 1, countdownMs: 0 });
    const survivor = connect(server.port);
    const survivorId = (await nextMessage(survivor) as { playerId: string }).playerId;
    const leaver = connect(server.port);
    const leaverId = (await nextMessage(leaver) as { playerId: string }).playerId;

    await drainUntil(survivor, (m) => leaverId in m.state.characters); // both present
    await startMatch(survivor, leaver);

    leaver.terminate(); // hard TCP drop, no WebSocket close handshake

    const gone = await drainUntil(
      survivor,
      (m) => !(leaverId in m.state.characters) && survivorId in m.state.characters,
    );
    expect(gone).toBe(true);

    // The survivor's own input still works — the Match kept running. Chase
    // the server's own tick each iteration (ADR 0027), same as any real client.
    const baseline = await nextMessage(survivor);
    if (baseline.type !== "snapshot") throw new Error("unreachable");
    const startZ = baseline.state.characters[survivorId]!.position.z;
    let tick = baseline.state.tick;
    let z = startZ;
    for (let i = 0; i < 20; i += 1) {
      sendInput(survivor, tick + 2, NORTH);
      const m = await nextMessage(survivor);
      if (m.type === "snapshot") {
        tick = m.state.tick;
        z = m.state.characters[survivorId]!.position.z;
      }
    }
    expect(z).toBeLessThan(startZ - 0.3); // it actually moved, not just an advancing ack
    survivor.close();
  });

  it("lets a new client connect and play normally after another has disconnected", async () => {
    server = await startServer({ port: 0, playersToStart: 1, countdownMs: 0 });
    const a = connect(server.port);
    const aId = (await nextMessage(a) as { playerId: string }).playerId;
    a.close();
    await new Promise((resolve) => a.once("close", resolve));

    const b = connect(server.port);
    const bWelcome = await nextMessage(b);
    if (bWelcome.type !== "welcome") throw new Error("unreachable");
    expect(bWelcome.playerId).not.toBe(aId);
    await startMatch(b);

    const first = await nextMessage(b);
    if (first.type !== "snapshot") throw new Error("unreachable");
    const startZ = first.state.characters[bWelcome.playerId]!.position.z;
    // Chase the server's own tick each iteration (ADR 0027).
    let tick = first.state.tick;
    let z = startZ;
    for (let i = 0; i < 30; i += 1) {
      sendInput(b, tick + 2, NORTH);
      const m = await nextMessage(b);
      if (m.type === "snapshot") {
        tick = m.state.tick;
        z = m.state.characters[bWelcome.playerId]!.position.z;
      }
    }
    expect(z).toBeLessThan(startZ - 1);
    b.close();
  });
});

describe("startServer — track-service startup retry (ticket 12)", () => {
  it("retries the startup fetch and succeeds once track-service comes up", async () => {
    const port = 34567 + Math.floor(Math.random() * 1000);
    const trackServiceUrl = `http://localhost:${port}`;

    const serverPromise = startServer({
      port: 0,
      trackServiceUrl,
      trackFetchMaxWaitMs: 10_000,
      trackFetchRetryDelayMs: 50,
    });

    // track-service isn't listening on `port` yet — give the first couple of
    // retry attempts a chance to fail before it comes up.
    await new Promise((resolve) => setTimeout(resolve, 150));
    const lateTrackService = await startTrackService({ port, dbPath: ":memory:" });

    try {
      server = await serverPromise;
      expect(server.port).toBeGreaterThan(0);
    } finally {
      await lateTrackService.close();
    }
  });

  it("gives up with a clear, ADR-0028-naming error once the wait budget is exhausted", async () => {
    const unreachableUrl = "http://localhost:1"; // nothing listens on port 1
    await expect(
      startServer({ port: 0, playersToStart: 1, countdownMs: 0, trackServiceUrl: unreachableUrl, trackFetchMaxWaitMs: 200, trackFetchRetryDelayMs: 50 }),
    ).rejects.toThrow(/ADR 0028/);
  });

  it("bounds a single hung request instead of letting it block past the wait budget", async () => {
    // Accepts the connection but never responds — track-service stalling
    // (a DB lock, a GC pause), not track-service being down. Without a
    // per-attempt timeout, a single `fetch` here would hang for the whole
    // test; with one, it fails fast and retries within the budget instead.
    const hangingServer = createServer(() => {});
    await new Promise<void>((resolve) => hangingServer.listen(0, resolve));
    const address = hangingServer.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const start = Date.now();
    await expect(
      startServer({
        port: 0,
        trackServiceUrl: `http://localhost:${port}`,
        trackFetchMaxWaitMs: 300,
        trackFetchRetryDelayMs: 20,
        trackFetchAttemptTimeoutMs: 50,
      }),
    ).rejects.toThrow(/ADR 0028/);
    expect(Date.now() - start).toBeLessThan(2000);

    await new Promise<void>((resolve) => hangingServer.close(() => resolve()));
  });
});

describe("startServer — Track Builder Playtest override (`?track=` on the connecting client)", () => {
  it("loads the requested Track when no players are connected yet", async () => {
    server = await startServer({ port: 0, playersToStart: 1, countdownMs: 0 });
    // Published after the server's own boot-time fetch, so it can never have
    // been that fetch's own (random) pick — guarantees the reload path
    // actually runs, not a same-track no-op.
    const altTrackId = await publishTrack();

    const socket = connect(server.port, `?track=${altTrackId}`);
    const welcome = await nextMessage(socket);
    if (welcome.type !== "welcome") throw new Error("unreachable");
    expect(welcome.trackId).toBe(altTrackId);
    socket.close();
  });

  it("connects normally — no reload, no refusal — when `?track=` already matches the currently-loaded Track", async () => {
    server = await startServer({ port: 0, playersToStart: 1, countdownMs: 0 });
    const first = connect(server.port);
    const firstWelcome = await nextMessage(first);
    if (firstWelcome.type !== "welcome") throw new Error("unreachable");
    first.close();
    await new Promise((resolve) => first.once("close", resolve));

    const second = connect(server.port, `?track=${firstWelcome.trackId}`);
    const secondWelcome = await nextMessage(second);
    if (secondWelcome.type !== "welcome") throw new Error("unreachable");
    expect(secondWelcome.trackId).toBe(firstWelcome.trackId);
    second.close();
  });

  it("refuses a mismatched `?track=` while another player is already connected, instead of swapping the Track under them", async () => {
    server = await startServer({ port: 0, playersToStart: 1, countdownMs: 0 });
    const already = connect(server.port);
    const alreadyWelcome = await nextMessage(already);
    if (alreadyWelcome.type !== "welcome") throw new Error("unreachable");

    const altTrackId = await publishTrack();
    const conflicting = connect(server.port, `?track=${altTrackId}`);
    const { code, reason } = await nextClose(conflicting);
    expect(code).toBe(4001);
    expect(reason).toMatch(/player/i);

    // The already-connected player is completely unaffected by the refusal.
    const stillGoing = await nextMessage(already);
    expect(stillGoing.type).toBe("snapshot");
    already.close();
  });

  it("picks up a newer Revision republished under the SAME (fixed, reserved) id — never keeps serving the first Revision it ever loaded (code review)", async () => {
    // Playtest always republishes to one fixed id across repeated clicks —
    // comparing `requestedTrackId === fetched.id` alone (the original bug)
    // would treat every later click as a no-op forever, since the id itself
    // never changes.
    const reservedId = `playtest-${Math.random().toString(36).slice(2)}`;
    await publishTrack(M1_TRACK, reservedId); // Revision 1

    server = await startServer({ port: 0, playersToStart: 1, countdownMs: 0 });
    const first = connect(server.port, `?track=${reservedId}`);
    const firstWelcome = await nextMessage(first);
    if (firstWelcome.type !== "welcome") throw new Error("unreachable");
    expect(firstWelcome.trackRevision).toBe(1);
    first.close();
    await new Promise((resolve) => first.once("close", resolve));

    await publishTrack(M1_TRACK, reservedId); // Revision 2, same id

    const second = connect(server.port, `?track=${reservedId}`);
    const secondWelcome = await nextMessage(second);
    if (secondWelcome.type !== "welcome") throw new Error("unreachable");
    expect(secondWelcome.trackId).toBe(reservedId);
    expect(secondWelcome.trackRevision).toBe(2);
    second.close();
  });

  it("refuses a genuinely concurrent mismatched `?track=` that arrives while another one's reload is still in flight, instead of racing it", async () => {
    server = await startServer({ port: 0, playersToStart: 1, countdownMs: 0 });
    const altA = await publishTrack();
    const altB = await publishTrack();

    // Both requested before either has resolved — the second must see the
    // first one's Character already registered (or vice versa) and refuse,
    // never silently replace a `simulation` the other's Character only
    // exists in (code review: the check-then-act race this closes reads
    // `sockets.size` only immediately before the synchronous mutation, not
    // before the `await` above it).
    const connA = connect(server.port, `?track=${altA}`);
    const connB = connect(server.port, `?track=${altB}`);

    const results = await Promise.all(
      [connA, connB].map(
        (socket) =>
          new Promise<{ welcome?: ServerMessage; close?: { code: number } }>((resolve) => {
            socket.once("message", (raw) => resolve({ welcome: JSON.parse(raw.toString()) as ServerMessage }));
            socket.once("close", (code) => resolve({ close: { code } }));
          }),
      ),
    );

    const welcomed = results.filter((r) => r.welcome);
    const refused = results.filter((r) => r.close);
    expect(welcomed.length).toBe(1);
    expect(refused.length).toBe(1);
    expect(refused[0]!.close!.code).toBe(4001);
    connA.close();
    connB.close();
  });

  it("closes with a clear reason when the requested Track can't be loaded", async () => {
    server = await startServer({ port: 0, playersToStart: 1, countdownMs: 0, trackFetchMaxWaitMs: 200, trackFetchRetryDelayMs: 20 });
    const socket = connect(server.port, "?track=this-track-id-does-not-exist");
    const { code, reason } = await nextClose(socket);
    expect(code).toBe(4002);
    expect(reason).toMatch(/this-track-id-does-not-exist/);
  });

  it("a client connecting after a reload can still move — the reload must not leave serverTick permanently ahead of the new simulation's own tick", async () => {
    server = await startServer({ port: 0, playersToStart: 1, countdownMs: 0 });

    // Advance the server's own tick counter well past zero before anyone
    // reloads, exactly like a dev server that's been up for a while.
    const first = connect(server.port);
    const firstWelcome = await nextMessage(first);
    if (firstWelcome.type !== "welcome") throw new Error("unreachable");
    await startMatch(first);
    let tick = (await nextMessage(first) as { type: "snapshot"; state: { tick: number } }).state.tick;
    for (let i = 0; i < 15; i += 1) {
      sendInput(first, tick + 2, NORTH);
      const message = await nextMessage(first);
      if (message.type === "snapshot") tick = message.state.tick;
    }
    expect(tick).toBeGreaterThan(10); // serverTick is now well past zero

    first.close();
    await new Promise((resolve) => first.once("close", resolve));

    // Reload — a genuinely different Track, with no one connected, so the
    // reload path actually runs and replaces `simulation` (whose own tick
    // counter restarts at 0) without resetting the server's `serverTick`.
    const altTrackId = await publishTrack();
    const second = connect(server.port, `?track=${altTrackId}`);
    const secondWelcome = await nextMessage(second);
    if (secondWelcome.type !== "welcome") throw new Error("unreachable");
    const id = secondWelcome.playerId;
    await startMatch(second);

    const postReloadFirst = await nextMessage(second);
    if (postReloadFirst.type !== "snapshot") throw new Error("unreachable");
    const startZ = postReloadFirst.state.characters[id]!.position.z;
    // The new simulation's own tick counter restarted at 0 — this is exactly
    // what the client would seed `predictionTick` from post-reload.
    expect(postReloadFirst.state.tick).toBeLessThan(10);

    let postTick = postReloadFirst.state.tick;
    let lastZ = startZ;
    for (let i = 0; i < 30; i += 1) {
      sendInput(second, postTick + 2, NORTH);
      const message = await nextMessage(second);
      if (message.type === "snapshot") {
        postTick = message.state.tick;
        lastZ = message.state.characters[id]!.position.z;
      }
    }

    expect(lastZ).toBeLessThan(startZ - 1); // NORTH must still walk the Character, post-reload
    second.close();
  });
});

describe("startServer — the Round clock (M4 ticket 03, ADR 0038)", () => {
  /** The next `snapshot` (skipping the welcome and any pongs). */
  const nextSnapshot = (socket: WebSocket): Promise<Extract<ServerMessage, { type: "snapshot" }>> =>
    new Promise((resolve) => {
      const onMessage = (raw: Buffer): void => {
        const message = JSON.parse(raw.toString()) as ServerMessage;
        if (message.type !== "snapshot") return;
        socket.off("message", onMessage);
        resolve(message);
      };
      socket.on("message", onMessage);
    });

  it("counts down from the Revision's own authored Time Limit, not a server-wide default", async () => {
    const trackId = await publishTrack(M1_TRACK, undefined, 45_000);
    server = await startServer({ port: 0, playersToStart: 1, countdownMs: 0 });
    const socket = connect(server.port, `?track=${trackId}`);

    const first = await nextSnapshot(socket);

    // The whole point of ADR 0038: a long Track can be given more time than a
    // short one, so this has to be the authored number and nothing else.
    expect(first.timeLeftMs).toBeLessThanOrEqual(45_000);
    expect(first.timeLeftMs).toBeGreaterThan(44_000);
    socket.close();
  });

  it("gives a Revision published without one the backfill default", async () => {
    const trackId = await publishTrack();
    server = await startServer({ port: 0, playersToStart: 1, countdownMs: 0 });
    const socket = connect(server.port, `?track=${trackId}`);

    const first = await nextSnapshot(socket);

    expect(first.timeLeftMs).toBeLessThanOrEqual(DEFAULT_TIME_LIMIT_MS);
    expect(first.timeLeftMs).toBeGreaterThan(DEFAULT_TIME_LIMIT_MS - 1_000);
    socket.close();
  });

  it("keeps counting down as the server Ticks", async () => {
    const trackId = await publishTrack(M1_TRACK, undefined, 45_000);
    server = await startServer({ port: 0, playersToStart: 1, countdownMs: 0 });
    const socket = connect(server.port, `?track=${trackId}`);
    await nextMessage(socket); // welcome — the socket has to be open before startMatch can send on it
    await startMatch(socket);

    const first = await nextSnapshot(socket);
    let later = first;
    for (let i = 0; i < 12; i += 1) later = await nextSnapshot(socket);

    expect(later.timeLeftMs).toBeLessThan(first.timeLeftMs);
    socket.close();
  });

  it("shows every client the same clock — one Round, one authority", async () => {
    const trackId = await publishTrack(M1_TRACK, undefined, 45_000);
    server = await startServer({ port: 0, playersToStart: 1, countdownMs: 0 });
    // The first connection loads the Track; the second just joins whatever is
    // already running (a `?track=` reload is refused while anyone is here).
    const a = connect(server.port, `?track=${trackId}`);
    await nextSnapshot(a);
    const b = connect(server.port);

    const [snapA, snapB] = await Promise.all([nextSnapshot(a), nextSnapshot(b)]);

    // Both are built from the same server Tick in the same broadcast, so they
    // agree exactly — the client never computes time remaining (ADR 0038).
    expect(snapA.state.tick === snapB.state.tick ? snapA.timeLeftMs : snapB.timeLeftMs).toBe(snapB.timeLeftMs);
    expect(Math.abs(snapA.timeLeftMs - snapB.timeLeftMs)).toBeLessThan(200);
    a.close();
    b.close();
  });
});

describe("startServer — Countdown and a shared start (M4 ticket 04, ADR 0040)", () => {
  const nextSnapshot = (socket: WebSocket): Promise<Extract<ServerMessage, { type: "snapshot" }>> =>
    new Promise((resolve) => {
      const onMessage = (raw: Buffer): void => {
        const message = JSON.parse(raw.toString()) as ServerMessage;
        if (message.type !== "snapshot") return;
        socket.off("message", onMessage);
        resolve(message);
      };
      socket.on("message", onMessage);
    });

  /** Snapshots until `predicate` holds, or a bounded number of them have gone by. */
  const snapshotUntil = async (
    socket: WebSocket,
    predicate: (s: Extract<ServerMessage, { type: "snapshot" }>) => boolean,
    max = 200,
  ): Promise<Extract<ServerMessage, { type: "snapshot" }>> => {
    for (let i = 0; i < max; i += 1) {
      const snapshot = await nextSnapshot(socket);
      if (predicate(snapshot)) return snapshot;
    }
    throw new Error("condition never held");
  };

  it("waits in the Lobby while only one Player is connected", async () => {
    server = await startServer({ port: 0 });
    const socket = connect(server.port);

    const snapshot = await nextSnapshot(socket);

    expect(snapshot.phase).toBe("LOBBY");
    expect(snapshot.countdownMsLeft).toBe(0);
    socket.close();
  });

  it("starts a Countdown once the host starts, once everyone connected is Ready (M4 ticket 07)", async () => {
    server = await startServer({ port: 0 });
    const a = connect(server.port);
    await nextMessage(a); // welcome
    const b = connect(server.port);
    await nextMessage(b); // welcome

    // Two connected Players alone does nothing — M4 ticket 04's own original
    // auto-trigger, replaced by an explicit host start (ticket 07).
    const stillLobby = await nextSnapshot(a);
    expect(stillLobby.phase).toBe("LOBBY");

    await startMatch(a, b); // a is host — the first joiner
    const counting = await snapshotUntil(a, (s) => s.phase === "COUNTDOWN");

    expect(counting.countdownMsLeft).toBeGreaterThan(0);
    expect(counting.countdownMsLeft).toBeLessThanOrEqual(COUNTDOWN_MS);
    a.close();
    b.close();
  });

  it("releases both Players into RUNNING in the same Tick", async () => {
    server = await startServer({ port: 0 });
    const a = connect(server.port);
    await nextMessage(a); // welcome
    const b = connect(server.port);
    await nextMessage(b); // welcome
    await startMatch(a, b);

    const [runA, runB] = await Promise.all([
      snapshotUntil(a, (s) => s.phase === "RUNNING"),
      snapshotUntil(b, (s) => s.phase === "RUNNING"),
    ]);

    // The same Tick for both, because there is one phase and one authority —
    // not two clients each deciding when their own Countdown ran out.
    expect(runA.state.tick).toBe(runB.state.tick);
    expect(runA.countdownMsLeft).toBe(0);
    a.close();
    b.close();
  });

  it("locks input until the Round is RUNNING — a Character cannot be walked off the start", async () => {
    server = await startServer({ port: 0, playersToStart: 2 });
    const a = connect(server.port);
    const welcome = (await nextMessage(a)) as Extract<ServerMessage, { type: "welcome" }>;
    const b = connect(server.port);
    await nextMessage(b); // welcome
    await startMatch(a, b);

    // Drive hard the entire time, from before the Countdown even begins.
    let tick = 1;
    const spam = setInterval(() => {
      sendInput(a, tick, NORTH);
      tick += 1;
    }, 5);
    const counting = await snapshotUntil(a, (s) => s.phase === "COUNTDOWN");
    const duringCountdown = await snapshotUntil(a, (s) => s.phase === "COUNTDOWN" && s.state.tick > counting.state.tick + 20);
    clearInterval(spam);

    const moved = duringCountdown.state.characters[welcome.playerId]!.position;
    expect(Math.abs(moved.z - welcome.spawn.z)).toBeLessThan(0.05);
    expect(Math.abs(moved.x - welcome.spawn.x)).toBeLessThan(0.05);
    a.close();
    b.close();
  });

  it("spawns both Characters before the Countdown, so nothing teleports at zero", async () => {
    server = await startServer({ port: 0 });
    const a = connect(server.port);
    const welcomeA = (await nextMessage(a)) as Extract<ServerMessage, { type: "welcome" }>;
    const b = connect(server.port);
    const welcomeB = (await nextMessage(b)) as Extract<ServerMessage, { type: "welcome" }>;
    await startMatch(a, b);

    const counting = await snapshotUntil(a, (s) => s.phase === "COUNTDOWN");
    const running = await snapshotUntil(a, (s) => s.phase === "RUNNING");

    // Both present, at their own join-order offsets, before the Countdown …
    expect(Object.keys(counting.state.characters).sort()).toEqual([welcomeA.playerId, welcomeB.playerId].sort());
    expect(welcomeA.spawn).not.toEqual(welcomeB.spawn);
    // … and standing in the same place when it ends: released, not placed.
    for (const id of [welcomeA.playerId, welcomeB.playerId]) {
      const before = counting.state.characters[id]!.position;
      const after = running.state.characters[id]!.position;
      expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeLessThan(0.05);
    }
    a.close();
    b.close();
  });

  it("holds the Round clock at its full Time Limit until the Round is actually RUNNING", async () => {
    const trackId = await publishTrack(M1_TRACK, undefined, 45_000);
    server = await startServer({ port: 0 });
    const a = connect(server.port, `?track=${trackId}`);
    await nextSnapshot(a);
    const b = connect(server.port);
    await nextMessage(b); // welcome
    await startMatch(a, b);

    const counting = await snapshotUntil(a, (s) => s.phase === "COUNTDOWN");

    // The Round has not begun, so none of its clock has been spent — ticket
    // 03's stand-in anchor is now the RUNNING transition's job (ADR 0040).
    expect(counting.timeLeftMs).toBe(45_000);
    a.close();
    b.close();
  });

  it("starts a solo Round when configured to, once its one Player Readies up and starts — a single-browser Playtest still runs (M4 ticket 07)", async () => {
    server = await startServer({ port: 0, playersToStart: 1 });
    const socket = connect(server.port);
    await nextMessage(socket); // welcome
    await startMatch(socket);

    const running = await snapshotUntil(socket, (s) => s.phase === "RUNNING");

    expect(running.phase).toBe("RUNNING");
    socket.close();
  });
});

describe("startServer — a Round ends (M4 ticket 05)", () => {
  const nextSnapshot = (socket: WebSocket): Promise<Extract<ServerMessage, { type: "snapshot" }>> =>
    new Promise((resolve) => {
      const onMessage = (raw: Buffer): void => {
        const message = JSON.parse(raw.toString()) as ServerMessage;
        if (message.type !== "snapshot") return;
        socket.off("message", onMessage);
        resolve(message);
      };
      socket.on("message", onMessage);
    });

  const snapshotUntil = async (
    socket: WebSocket,
    predicate: (s: Extract<ServerMessage, { type: "snapshot" }>) => boolean,
    max = 400,
  ): Promise<Extract<ServerMessage, { type: "snapshot" }>> => {
    for (let i = 0; i < max; i += 1) {
      const snapshot = await nextSnapshot(socket);
      if (predicate(snapshot)) return snapshot;
    }
    throw new Error("condition never held");
  };

  /** A Track whose Finish Zone is right on the spawn, so a Character Qualifies as soon as it is RUNNING. */
  const INSTANT_FINISH: Track = [{ moduleId: "finish", position: { x: 0, y: 0, z: 10 }, rotation: 0 }];

  it("ends the Round as soon as every connected Character has Qualified", async () => {
    const trackId = await publishTrack(INSTANT_FINISH);
    server = await startServer({ port: 0, playersToStart: 1, countdownMs: 0, roundEndMs: 0 });
    const socket = connect(server.port, `?track=${trackId}`);
    await nextMessage(socket); // welcome
    await startMatch(socket);

    const ended = await snapshotUntil(socket, (s) => s.phase === "ROUND_END" || s.phase === "RESULTS");

    // Early, on Qualification — not by waiting out the Time Limit. The clock
    // holds whatever was left on it rather than resetting.
    expect(ended.timeLeftMs).toBeGreaterThan(0);
    const later = await snapshotUntil(socket, (s) => s.state.tick > ended.state.tick + 20);
    expect(later.timeLeftMs).toBe(ended.timeLeftMs);
    socket.close();
  });

  it("ends the Round when the clock runs out with someone still running", async () => {
    const trackId = await publishTrack(M1_TRACK, undefined, MIN_TIME_LIMIT_MS);
    server = await startServer({ port: 0, playersToStart: 1, countdownMs: 0, roundEndMs: 0, timeLimitMsOverride: 300 });
    const socket = connect(server.port, `?track=${trackId}`);
    await nextMessage(socket); // welcome
    await startMatch(socket);

    const ended = await snapshotUntil(socket, (s) => s.phase === "ROUND_END" || s.phase === "RESULTS");

    expect(ended.timeLeftMs).toBe(0);
    // And it stays put rather than springing back to the full Limit or
    // carrying on counting into the Results.
    const later = await snapshotUntil(socket, (s) => s.state.tick > ended.state.tick + 20);
    expect(later.timeLeftMs).toBe(0);
    socket.close();
  });

  it("advances through round-end into the Results", async () => {
    const trackId = await publishTrack(INSTANT_FINISH);
    server = await startServer({ port: 0, playersToStart: 1, countdownMs: 0 });
    const socket = connect(server.port, `?track=${trackId}`);
    await nextMessage(socket); // welcome
    await startMatch(socket);

    await snapshotUntil(socket, (s) => s.phase === "ROUND_END");
    const results = await snapshotUntil(socket, (s) => s.phase === "RESULTS");

    expect(results.phase).toBe("RESULTS");
    socket.close();
  });

  it("locks input again once the Round is over", async () => {
    const trackId = await publishTrack(INSTANT_FINISH);
    server = await startServer({ port: 0, playersToStart: 1, countdownMs: 0, roundEndMs: 0 });
    const socket = connect(server.port, `?track=${trackId}`);
    const welcome = (await nextMessage(socket)) as Extract<ServerMessage, { type: "welcome" }>;
    await startMatch(socket);

    const results = await snapshotUntil(socket, (s) => s.phase === "RESULTS");
    const settled = results.state.characters[welcome.playerId]!.position;

    let tick = 5_000;
    const spam = setInterval(() => {
      sendInput(socket, tick, NORTH);
      tick += 1;
    }, 5);
    const later = await snapshotUntil(socket, (s) => s.state.tick > results.state.tick + 30);
    clearInterval(spam);

    const after = later.state.characters[welcome.playerId]!.position;
    expect(Math.hypot(after.x - settled.x, after.z - settled.z)).toBeLessThan(0.1);
    socket.close();
  });

  it("records a DNF for a Player who drops mid-Round", async () => {
    server = await startServer({ port: 0, playersToStart: 2, countdownMs: 0 });
    const a = connect(server.port);
    const welcomeA = (await nextMessage(a)) as Extract<ServerMessage, { type: "welcome" }>;
    const b = connect(server.port);
    await nextMessage(b);
    await startMatch(a, b);
    await snapshotUntil(b, (s) => s.phase === "RUNNING");

    a.close();

    const afterDrop = await snapshotUntil(b, (s) => s.dnf.length > 0);

    expect(afterDrop.dnf).toEqual([{ id: welcomeA.playerId, nickname: "Player" }]);
    // The Character is gone from the world too, not left standing.
    expect(afterDrop.state.characters[welcomeA.playerId]).toBeUndefined();
    b.close();
  });

  it("does not call it a DNF when someone leaves before the Round started", async () => {
    server = await startServer({ port: 0, playersToStart: 2 });
    const a = connect(server.port);
    await nextMessage(a);
    const b = connect(server.port);
    await nextMessage(b);
    await startMatch(a, b);
    const counting = await snapshotUntil(b, (s) => s.phase === "COUNTDOWN");

    a.close();

    const later = await snapshotUntil(b, (s) => s.state.tick > counting.state.tick + 10);
    expect(later.dnf).toEqual([]);
    b.close();
  });

  it("refuses a joiner while a Round is under way — there is no mid-Round rejoin", async () => {
    server = await startServer({ port: 0, playersToStart: 1, countdownMs: 0 });
    const playing = connect(server.port);
    await nextMessage(playing); // welcome
    await startMatch(playing);
    await snapshotUntil(playing, (s) => s.phase === "RUNNING");

    const latecomer = connect(server.port);
    const closed = await nextClose(latecomer);

    expect(closed.reason).toMatch(/Round/i);
    playing.close();
  });

  it("lets someone join again once the server is back in the Lobby", async () => {
    server = await startServer({ port: 0, playersToStart: 1, countdownMs: 0 });
    const first = connect(server.port);
    await nextMessage(first); // welcome
    await startMatch(first);
    await snapshotUntil(first, (s) => s.phase === "RUNNING");
    first.close();

    // Everyone gone → back to LOBBY, and the next arrival is welcome.
    await new Promise((r) => setTimeout(r, 150));
    const second = connect(server.port);
    const welcome = await nextMessage(second);

    expect(welcome.type).toBe("welcome");
    second.close();
  });

  it("clears the previous Round's DNFs when a new Round starts", async () => {
    server = await startServer({ port: 0, playersToStart: 2, countdownMs: 0 });
    const a = connect(server.port);
    await nextMessage(a);
    const b = connect(server.port);
    await nextMessage(b);
    await startMatch(a, b);
    await snapshotUntil(b, (s) => s.phase === "RUNNING");
    a.close();
    await snapshotUntil(b, (s) => s.dnf.length === 1);
    b.close();

    // Both gone → LOBBY. A fresh pair starts a fresh Round with a clean slate.
    await new Promise((r) => setTimeout(r, 150));
    const c = connect(server.port);
    await nextMessage(c);
    const d = connect(server.port);
    await nextMessage(d);
    await startMatch(c, d);

    const running = await snapshotUntil(c, (s) => s.phase === "RUNNING");
    expect(running.dnf).toEqual([]);
    c.close();
    d.close();
  });
});

describe("startServer — the Lobby (M4 ticket 07, ADR 0040)", () => {
  const nextSnapshot = (socket: WebSocket): Promise<Extract<ServerMessage, { type: "snapshot" }>> =>
    new Promise((resolve) => {
      const onMessage = (raw: Buffer): void => {
        const message = JSON.parse(raw.toString()) as ServerMessage;
        if (message.type !== "snapshot") return;
        socket.off("message", onMessage);
        resolve(message);
      };
      socket.on("message", onMessage);
    });

  const snapshotUntil = async (
    socket: WebSocket,
    predicate: (s: Extract<ServerMessage, { type: "snapshot" }>) => boolean,
  ): Promise<Extract<ServerMessage, { type: "snapshot" }>> => {
    for (;;) {
      const snapshot = await nextSnapshot(socket);
      if (predicate(snapshot)) return snapshot;
    }
  };

  it("truncates and trims a nickname, and leaves it alone when the trimmed result is empty", async () => {
    server = await startServer({ port: 0 });
    const a = connect(server.port);
    await nextMessage(a); // welcome

    a.send(JSON.stringify({ type: "setNickname", nickname: "  " } satisfies ClientMessage));
    const untouched = await snapshotUntil(a, (s) => s.lobby.players.length === 1);
    expect(untouched.lobby.players[0]!.nickname).toBe("Player"); // the default, unblanked

    a.send(JSON.stringify({ type: "setNickname", nickname: "  Speedy Gonzalez the Third  " } satisfies ClientMessage));
    const renamed = await snapshotUntil(a, (s) => s.lobby.players[0]!.nickname !== "Player");
    expect(renamed.lobby.players[0]!.nickname).toBe("Speedy Gonzalez the Thir"); // trimmed, then capped to NICKNAME_MAX_LENGTH (24)
    a.close();
  });

  it("broadcasts a Ready toggle to every connected Player, not just the one who sent it", async () => {
    server = await startServer({ port: 0 });
    const a = connect(server.port);
    await nextMessage(a);
    const b = connect(server.port);
    await nextMessage(b);

    b.send(JSON.stringify({ type: "setReady", ready: true } satisfies ClientMessage));
    const seenByA = await snapshotUntil(a, (s) => s.lobby.players.some((p) => p.ready));
    const bEntry = seenByA.lobby.players.find((p) => p.nickname === "Player" && p.ready);
    expect(bEntry).toBeDefined();
    a.close();
    b.close();
  });

  it("resolves the host as whoever has been connected longest, and reassigns the instant they leave", async () => {
    server = await startServer({ port: 0 });
    const a = connect(server.port);
    const welcomeA = (await nextMessage(a)) as Extract<ServerMessage, { type: "welcome" }>;
    const b = connect(server.port);
    const welcomeB = (await nextMessage(b)) as Extract<ServerMessage, { type: "welcome" }>;

    const initial = await snapshotUntil(b, (s) => s.lobby.players.length === 2);
    expect(initial.lobby.hostId).toBe(welcomeA.playerId);

    a.close();
    const reassigned = await snapshotUntil(b, (s) => s.lobby.hostId === welcomeB.playerId);
    expect(reassigned.lobby.players.map((p) => p.id)).toEqual([welcomeB.playerId]);
    b.close();
  });

  it("ignores a start from anyone but the host", async () => {
    server = await startServer({ port: 0 });
    const a = connect(server.port);
    await nextMessage(a); // welcome, host
    const b = connect(server.port);
    await nextMessage(b); // welcome, not host

    for (const socket of [a, b]) socket.send(JSON.stringify({ type: "setReady", ready: true } satisfies ClientMessage));
    await snapshotUntil(a, (s) => s.lobby.players.every((p) => p.ready));
    b.send(JSON.stringify({ type: "start" } satisfies ClientMessage));

    // Give the (wrongly) requested start a real chance to land before asserting it didn't.
    await new Promise((r) => setTimeout(r, 100));
    const stillLobby = await nextSnapshot(a);
    expect(stillLobby.phase).toBe("LOBBY");
    a.close();
    b.close();
  });

  it("ignores a start until everyone connected is Ready", async () => {
    server = await startServer({ port: 0 });
    const a = connect(server.port);
    await nextMessage(a); // welcome, host
    const b = connect(server.port);
    await nextMessage(b); // welcome, never readies up

    a.send(JSON.stringify({ type: "setReady", ready: true } satisfies ClientMessage));
    await snapshotUntil(a, (s) => s.lobby.players.some((p) => p.ready));
    a.send(JSON.stringify({ type: "start" } satisfies ClientMessage));

    await new Promise((r) => setTimeout(r, 100));
    const stillLobby = await nextSnapshot(a);
    expect(stillLobby.phase).toBe("LOBBY");
    a.close();
    b.close();
  });

  it("ignores a start below the configured Player threshold, even from an otherwise-valid host", async () => {
    server = await startServer({ port: 0, playersToStart: 2 });
    const a = connect(server.port);
    await nextMessage(a); // welcome — alone, host, Ready, but only one Player

    a.send(JSON.stringify({ type: "setReady", ready: true } satisfies ClientMessage));
    await snapshotUntil(a, (s) => s.lobby.players.some((p) => p.ready));
    a.send(JSON.stringify({ type: "start" } satisfies ClientMessage));

    await new Promise((r) => setTimeout(r, 100));
    const stillLobby = await nextSnapshot(a);
    expect(stillLobby.phase).toBe("LOBBY");
    a.close();
  });

  it("ignores a start once the Round is already under way — there is no re-triggering it", async () => {
    // A known, non-trivial Track — `/tracks/any` can otherwise hand back one
    // of this file's own INSTANT_FINISH fixtures and end the Round before
    // this test gets to assert it stayed RUNNING.
    const trackId = await publishTrack(M1_TRACK, undefined, 45_000);
    server = await startServer({ port: 0, playersToStart: 1, countdownMs: 0 });
    const socket = connect(server.port, `?track=${trackId}`);
    await nextMessage(socket); // welcome
    await startMatch(socket);
    await snapshotUntil(socket, (s) => s.phase === "RUNNING");

    socket.send(JSON.stringify({ type: "start" } satisfies ClientMessage));
    await new Promise((r) => setTimeout(r, 100));
    const stillRunning = await nextSnapshot(socket);
    expect(stillRunning.phase).toBe("RUNNING");
    socket.close();
  });

  it("ignores a Track pick from anyone but the host", async () => {
    server = await startServer({ port: 0 });
    const a = connect(server.port);
    const welcomeA = (await nextMessage(a)) as Extract<ServerMessage, { type: "welcome" }>;
    const b = connect(server.port);
    await nextMessage(b); // not host

    const altTrackId = await publishTrack();
    b.send(JSON.stringify({ type: "selectTrack", trackId: altTrackId } satisfies ClientMessage));

    await new Promise((r) => setTimeout(r, 200));
    const unchanged = await nextSnapshot(a);
    expect(unchanged.trackId).toBe(welcomeA.trackId);
    a.close();
    b.close();
  });

  it("lets the host pick a different Track live, re-seating everyone already connected rather than losing them", async () => {
    server = await startServer({ port: 0 });
    const a = connect(server.port);
    const welcomeA = (await nextMessage(a)) as Extract<ServerMessage, { type: "welcome" }>;
    const b = connect(server.port);
    const welcomeB = (await nextMessage(b)) as Extract<ServerMessage, { type: "welcome" }>;

    const altTrackId = await publishTrack();
    a.send(JSON.stringify({ type: "selectTrack", trackId: altTrackId } satisfies ClientMessage));

    const reloaded = await snapshotUntil(a, (s) => s.trackId === altTrackId);
    expect(reloaded.phase).toBe("LOBBY");
    // Both Players who were already in the Lobby are still here, not lost —
    // the point of doing this live instead of just reusing the connect-time
    // `?track=` reload, which only ever runs with nobody connected.
    expect(Object.keys(reloaded.state.characters).sort()).toEqual([welcomeA.playerId, welcomeB.playerId].sort());
    expect(reloaded.lobby.players.map((p) => p.id).sort()).toEqual([welcomeA.playerId, welcomeB.playerId].sort());
    a.close();
    b.close();
  });

  it("ignores a Track pick once the Round has left the Lobby", async () => {
    // Same reasoning as above: a known Track, not whatever `/tracks/any`
    // hands back, so the Round is still RUNNING when the pick is checked.
    const trackId = await publishTrack(M1_TRACK, undefined, 45_000);
    server = await startServer({ port: 0, playersToStart: 1, countdownMs: 0 });
    const socket = connect(server.port, `?track=${trackId}`);
    const welcome = (await nextMessage(socket)) as Extract<ServerMessage, { type: "welcome" }>;
    await startMatch(socket);
    await snapshotUntil(socket, (s) => s.phase === "RUNNING");

    const altTrackId = await publishTrack();
    socket.send(JSON.stringify({ type: "selectTrack", trackId: altTrackId } satisfies ClientMessage));

    await new Promise((r) => setTimeout(r, 200));
    const unchanged = await nextSnapshot(socket);
    expect(unchanged.trackId).toBe(welcome.trackId);
    expect(unchanged.phase).toBe("RUNNING");
    socket.close();
  });

  it("supersedes a still-in-flight selectTrack with whichever pick was requested last", async () => {
    // Both fetches are genuinely concurrent — sent back to back, in the same
    // synchronous burst, with neither awaited by the handler in between — so
    // this can resolve either order in reality. `selectTrackSeq` (ticket 07)
    // exists exactly so the outcome is deterministic regardless: only the
    // request that was still the latest one when its own fetch resolves ever
    // applies.
    server = await startServer({ port: 0 });
    const a = connect(server.port);
    await nextMessage(a); // welcome, host
    const [trackA, trackB] = await Promise.all([publishTrack(), publishTrack()]);

    a.send(JSON.stringify({ type: "selectTrack", trackId: trackA } satisfies ClientMessage));
    a.send(JSON.stringify({ type: "selectTrack", trackId: trackB } satisfies ClientMessage));

    const landed = await snapshotUntil(a, (s) => s.trackId === trackA || s.trackId === trackB);
    expect(landed.trackId).toBe(trackB);

    // Give trackA's own fetch every chance to resolve late and clobber it.
    await new Promise((r) => setTimeout(r, 200));
    const settled = await nextSnapshot(a);
    expect(settled.trackId).toBe(trackB);
    a.close();
  });

  it("drops a start queued right behind a still-in-flight selectTrack, rather than starting the wrong Track", async () => {
    // The interesting race ticket 07 calls out: the pre-check passes (LOBBY,
    // host) and the fetch begins, then — before it resolves — the same host's
    // `start` (queued right behind it, same burst) is validated and queued
    // against the *old* Lobby. A same-process fetch to track-service settles
    // well inside one 30 Hz tick, so in practice it always resolves before
    // the tick loop gets a chance to spend that queued start: without the
    // post-`await` reset also clearing it, the tick loop would spend it right
    // after, starting a Round on the just-swapped-to alt Track the host never
    // actually asked to start.
    server = await startServer({ port: 0, playersToStart: 1, countdownMs: 0 });
    const socket = connect(server.port);
    await nextMessage(socket); // welcome, host
    socket.send(JSON.stringify({ type: "setReady", ready: true } satisfies ClientMessage));
    await snapshotUntil(socket, (s) => s.lobby.players.every((p) => p.ready));

    const altTrackId = await publishTrack();
    socket.send(JSON.stringify({ type: "selectTrack", trackId: altTrackId } satisfies ClientMessage));
    socket.send(JSON.stringify({ type: "start" } satisfies ClientMessage));

    const reloaded = await snapshotUntil(socket, (s) => s.trackId === altTrackId);
    // The stale start never got to run — still in the Lobby on the alt Track,
    // not RUNNING on it (which would mean the reset let it through) and not
    // RUNNING on the original Track either (which would mean the reset lost
    // the race the other way).
    expect(reloaded.phase).toBe("LOBBY");

    // Confirm it isn't just late — nothing spontaneously starts it, and
    // Ready survives the reset, so the host only needs to ask again.
    await new Promise((r) => setTimeout(r, 200));
    const stillLobby = await nextSnapshot(socket);
    expect(stillLobby.phase).toBe("LOBBY");
    expect(stillLobby.lobby.players[0]!.ready).toBe(true);

    socket.send(JSON.stringify({ type: "start" } satisfies ClientMessage));
    const running = await snapshotUntil(socket, (s) => s.phase === "RUNNING");
    expect(running.trackId).toBe(altTrackId);
    socket.close();
  });
});

describe("startServer — Results, and going again (M4 ticket 08)", () => {
  const nextSnapshot = (socket: WebSocket): Promise<Extract<ServerMessage, { type: "snapshot" }>> =>
    new Promise((resolve) => {
      const onMessage = (raw: Buffer): void => {
        const message = JSON.parse(raw.toString()) as ServerMessage;
        if (message.type !== "snapshot") return;
        socket.off("message", onMessage);
        resolve(message);
      };
      socket.on("message", onMessage);
    });

  const snapshotUntil = async (
    socket: WebSocket,
    predicate: (s: Extract<ServerMessage, { type: "snapshot" }>) => boolean,
    max = 400,
  ): Promise<Extract<ServerMessage, { type: "snapshot" }>> => {
    for (let i = 0; i < max; i += 1) {
      const snapshot = await nextSnapshot(socket);
      if (predicate(snapshot)) return snapshot;
    }
    throw new Error("condition never held");
  };

  /** A Track whose Finish Zone is right on the spawn, so a Character Qualifies as soon as it is RUNNING. */
  const INSTANT_FINISH: Track = [{ moduleId: "finish", position: { x: 0, y: 0, z: 10 }, rotation: 0 }];

  const returnToLobby = (socket: WebSocket): void =>
    socket.send(JSON.stringify({ type: "returnToLobby" } satisfies ClientMessage));

  it("ignores a return-to-Lobby request from anyone but the host", async () => {
    const trackId = await publishTrack(INSTANT_FINISH);
    server = await startServer({ port: 0, playersToStart: 2, countdownMs: 0, roundEndMs: 0 });
    const a = connect(server.port, `?track=${trackId}`); // host
    await nextMessage(a);
    const b = connect(server.port);
    await nextMessage(b);
    await startMatch(a, b);
    await snapshotUntil(a, (s) => s.phase === "RESULTS");

    returnToLobby(b);

    await new Promise((r) => setTimeout(r, 100));
    const stillResults = await nextSnapshot(a);
    expect(stillResults.phase).toBe("RESULTS");
    a.close();
    b.close();
  });

  it("ignores a return-to-Lobby request before Results — there is nothing to go back from yet", async () => {
    server = await startServer({ port: 0, playersToStart: 1 });
    const socket = connect(server.port);
    await nextMessage(socket);
    await startMatch(socket);
    await snapshotUntil(socket, (s) => s.phase === "COUNTDOWN");

    returnToLobby(socket);

    await new Promise((r) => setTimeout(r, 100));
    const stillCounting = await nextSnapshot(socket);
    expect(stillCounting.phase).not.toBe("LOBBY");
    socket.close();
  });

  it("returns everyone to the Lobby once the host asks, with the previous Round's DNFs cleared", async () => {
    const trackId = await publishTrack(INSTANT_FINISH);
    server = await startServer({ port: 0, playersToStart: 1, countdownMs: 0, roundEndMs: 0 });
    const socket = connect(server.port, `?track=${trackId}`);
    const welcome = (await nextMessage(socket)) as Extract<ServerMessage, { type: "welcome" }>;
    await startMatch(socket);
    await snapshotUntil(socket, (s) => s.phase === "RESULTS");

    returnToLobby(socket);

    const backInLobby = await snapshotUntil(socket, (s) => s.phase === "LOBBY");
    expect(backInLobby.dnf).toEqual([]);
    // Re-seated, not left wherever the Round ended — the same Character is
    // still here, ready for a fresh Countdown.
    expect(backInLobby.state.characters[welcome.playerId]).toBeDefined();
    // A genuinely fresh Lobby, not a resumed one — everyone left the last
    // Round Ready (that's what let it start), so a Lobby that carried that
    // over would let the host start the next Round with nobody having
    // confirmed anything for it (code review).
    expect(backInLobby.lobby.players.every((p) => !p.ready)).toBe(true);
    socket.close();
  });

  it("does not let a stale Ready from the previous Round auto-start the next one", async () => {
    const trackId = await publishTrack(INSTANT_FINISH);
    server = await startServer({ port: 0, playersToStart: 2, countdownMs: 0, roundEndMs: 0 });
    const a = connect(server.port, `?track=${trackId}`);
    await nextMessage(a);
    const b = connect(server.port);
    await nextMessage(b);
    await startMatch(a, b);
    await snapshotUntil(a, (s) => s.phase === "RESULTS");

    returnToLobby(a);
    await snapshotUntil(a, (s) => s.phase === "LOBBY");

    // The host asks to start again without anyone re-confirming Ready.
    a.send(JSON.stringify({ type: "start" } satisfies ClientMessage));

    await new Promise((r) => setTimeout(r, 100));
    const stillLobby = await nextSnapshot(a);
    expect(stillLobby.phase).toBe("LOBBY");
    a.close();
    b.close();
  });

  it("lets the host start a second Round on the same Track once back in the Lobby, running exactly like the first", async () => {
    const trackId = await publishTrack(INSTANT_FINISH);
    server = await startServer({ port: 0, playersToStart: 1, countdownMs: 0, roundEndMs: 0 });
    const socket = connect(server.port, `?track=${trackId}`);
    await nextMessage(socket);
    await startMatch(socket);
    await snapshotUntil(socket, (s) => s.phase === "RESULTS");

    returnToLobby(socket);
    await snapshotUntil(socket, (s) => s.phase === "LOBBY");

    await startMatch(socket);
    const secondResults = await snapshotUntil(socket, (s) => s.phase === "RESULTS");

    expect(secondResults.phase).toBe("RESULTS");
    socket.close();
  });
});

