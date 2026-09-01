import type { ClientMessage, ServerMessage, SimInputs } from "@dont-fall/shared";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { startServer, type MatchServer } from "./index.js";

let server: MatchServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

const connect = (port: number): WebSocket => new WebSocket(`ws://localhost:${port}`);

const nextMessage = (socket: WebSocket): Promise<ServerMessage> =>
  new Promise((resolve) => socket.once("message", (raw) => resolve(JSON.parse(raw.toString()) as ServerMessage)));

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

    // One packet carrying ticks 1..10, then re-send 6..10 (the redundant tail) —
    // the server must apply each tick once and walk the Character north.
    sendInputs(socket, Array.from({ length: 10 }, (_, i) => ({ tick: i + 1, input: NORTH })));
    sendInputs(socket, Array.from({ length: 5 }, (_, i) => ({ tick: i + 6, input: NORTH })));

    let acked = 0;
    let z = startZ;
    for (let i = 0; i < 30 && acked < 10; i += 1) {
      const m = await nextMessage(socket);
      if (m.type === "snapshot") {
        acked = m.state.characters[welcome.playerId]!.lastInputTick;
        z = m.state.characters[welcome.playerId]!.position.z;
      }
    }
    expect(acked).toBe(10); // every batched tick applied, no dupes stuck in the queue
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

    let lastZ = startZ;
    let lastSnapshot: ServerMessage | undefined;
    for (let i = 0; i < 30; i += 1) {
      sendInput(socket, i + 1, NORTH);
      const message = await nextMessage(socket);
      if (message.type === "snapshot") {
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

    // The survivor's own input still works — the Match kept running.
    for (let i = 0; i < 20; i += 1) sendInput(survivor, i + 1, NORTH);
    const moved = await drainUntil(survivor, (m) => m.state.characters[survivorId]!.lastInputTick > 0);
    expect(moved).toBe(true);
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

    const startZ = bWelcome.spawn.z;
    for (let i = 0; i < 30; i += 1) sendInput(b, i + 1, NORTH);
    const walked = await drainUntil(b, (m) => m.state.characters[bWelcome.playerId]!.position.z < startZ - 1);
    expect(walked).toBe(true);
    b.close();
  });
});
