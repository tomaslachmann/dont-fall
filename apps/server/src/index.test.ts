import type { ServerMessage, SimInputs } from "@dont-fall/shared";
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

describe("startServer", () => {
  it("assigns each connecting client an anonymous session ID", async () => {
    server = await startServer({ port: 0 });
    const socket = connect(server.port);
    const welcome = await nextMessage(socket);

    expect(welcome.type).toBe("welcome");
    expect(typeof (welcome as { id: string }).id).toBe("string");
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
    for (let i = 0; i < 30; i += 1) {
      socket.send(JSON.stringify({ type: "input", input: NORTH }));
      const message = await nextMessage(socket);
      if (message.type === "snapshot") lastZ = message.state.characters[id]!.position.z;
    }

    expect(lastZ).toBeLessThan(startZ - 1); // NORTH walks toward -z
    socket.close();
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
