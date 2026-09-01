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
  socket.send(JSON.stringify({ type: "input", tick, input } satisfies ClientMessage));

describe("startServer", () => {
  it("assigns each connecting client an anonymous session ID", async () => {
    server = await startServer({ port: 0 });
    const socket = connect(server.port);
    const welcome = await nextMessage(socket);

    expect(welcome.type).toBe("welcome");
    if (welcome.type !== "welcome") throw new Error("unreachable");
    expect(typeof welcome.id).toBe("string");
    // The client seeds its local prediction from this, so it must be where the
    // server actually placed the Character (before it settles under gravity).
    const snapshot = await nextMessage(socket);
    if (snapshot.type !== "snapshot") throw new Error("unreachable");
    const p = snapshot.state.characters[welcome.id]!.position;
    expect(p.x).toBeCloseTo(welcome.spawn.x, 5);
    expect(p.z).toBeCloseTo(welcome.spawn.z, 5);
    socket.close();
  });

  it("broadcasts a snapshot every tick containing the connected client's Character", async () => {
    server = await startServer({ port: 0 });
    const socket = connect(server.port);
    const welcome = await nextMessage(socket);
    const id = (welcome as { id: string }).id;

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
    const id = (welcome as { id: string }).id;

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
    const aId = (await nextMessage(a) as { id: string }).id;
    const b = connect(server.port);
    const bId = (await nextMessage(b) as { id: string }).id;

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
    const firstId = (firstWelcome as { id: string }).id;
    await nextMessage(first); // first snapshot while both are about to connect

    const second = connect(server.port);
    const secondWelcome = await nextMessage(second);
    const secondId = (secondWelcome as { id: string }).id;

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
