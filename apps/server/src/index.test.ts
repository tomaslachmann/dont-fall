import { createServer } from "node:http";
import { M1_TRACK, RapierSimulation, type ClientMessage, type ServerMessage, type SimInputs, type Track } from "@dont-fall/shared";
import { startTrackService, type TrackService } from "@dont-fall/track-service";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { startServer, type MatchServer } from "./index.js";

// ADR 0028: the Match server now has a hard runtime dependency on track-service.
// One shared instance for this whole file, pointed to by TRACK_SERVICE_URL, so
// every existing `startServer({ port: 0 })` call site below keeps working
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
const publishTrack = async (track: Track = M1_TRACK, id?: string): Promise<string> => {
  const res = await fetch(`http://localhost:${trackService.port}/tracks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(id ? { id, track } : { track }),
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

describe("startServer", () => {
  it("welcomes each client with a public playerId, a secret sessionToken, the spawn, and config", async () => {
    server = await startServer({ port: 0 });
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
    server = await startServer({ port: 0 });
    const socket = connect(server.port);
    await nextMessage(socket); // welcome
    const snapshot = await nextMessage(socket);
    if (snapshot.type !== "snapshot") throw new Error("unreachable");
    expect(snapshot.serverTimeMs).toBeGreaterThan(0);
    expect(snapshot.commandQueueDepth).toBe(0); // nothing sent yet
    socket.close();
  });

  it("replies to a ping with a pong echoing the client time plus the server time", async () => {
    server = await startServer({ port: 0 });
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
    server = await startServer({ port: 0 });
    const socket = connect(server.port);
    const welcome = await nextMessage(socket);
    if (welcome.type !== "welcome") throw new Error("unreachable");
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
    server = await startServer({ port: 0 });
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
    server = await startServer({ port: 0 });
    const socket = connect(server.port);
    const welcome = await nextMessage(socket);
    const id = (welcome as { playerId: string }).playerId;

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
      server = await startServer({ port: 0 });
      const socket = connect(server.port);
      const welcome = await nextMessage(socket);
      const id = (welcome as { playerId: string }).playerId;

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
    server = await startServer({ port: 0 });
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
    server = await startServer({ port: 0 });
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
    server = await startServer({ port: 0 });
    const survivor = connect(server.port);
    const survivorId = (await nextMessage(survivor) as { playerId: string }).playerId;
    const leaver = connect(server.port);
    const leaverId = (await nextMessage(leaver) as { playerId: string }).playerId;

    await drainUntil(survivor, (m) => leaverId in m.state.characters); // both present

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
    server = await startServer({ port: 0 });
    const a = connect(server.port);
    const aId = (await nextMessage(a) as { playerId: string }).playerId;
    a.close();
    await new Promise((resolve) => a.once("close", resolve));

    const b = connect(server.port);
    const bWelcome = await nextMessage(b);
    if (bWelcome.type !== "welcome") throw new Error("unreachable");
    expect(bWelcome.playerId).not.toBe(aId);

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
      startServer({ port: 0, trackServiceUrl: unreachableUrl, trackFetchMaxWaitMs: 200, trackFetchRetryDelayMs: 50 }),
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
    server = await startServer({ port: 0 });
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
    server = await startServer({ port: 0 });
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
    server = await startServer({ port: 0 });
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

    server = await startServer({ port: 0 });
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
    server = await startServer({ port: 0 });
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
    server = await startServer({ port: 0, trackFetchMaxWaitMs: 200, trackFetchRetryDelayMs: 20 });
    const socket = connect(server.port, "?track=this-track-id-does-not-exist");
    const { code, reason } = await nextClose(socket);
    expect(code).toBe(4002);
    expect(reason).toMatch(/this-track-id-does-not-exist/);
  });
});
