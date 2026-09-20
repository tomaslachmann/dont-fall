import { createServer } from "node:http";
import { parentPort, workerData } from "node:worker_threads";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import {
  isVoiceScope,
  VOICE_AUTH_TIMEOUT_MS,
  VOICE_MAX_FRAME_BYTES,
  VOICE_PING_MS,
  VOICE_REFUSED_NO_ACCOUNT,
  VOICE_REFUSED_NO_ROOM,
  VOICE_SERVER_HEADER_BYTES,
  VOICE_SOCKET_PATH,
  VOICE_SOCKET_UNAUTHORIZED,
  type VoiceScope,
  type VoiceServerMessage,
} from "@dont-fall/shared";
import { VoiceRooms, type VoiceConnection, type VoiceSink } from "./voiceRooms.js";
import type { VoiceHostMessage, VoiceWorkerMessage } from "./voiceMessages.js";

/**
 * The voice relay, in a worker thread of the API (ADR 0111). It owns a port
 * of its own, so in the online stack nginx hands it every voice socket
 * directly and not one voice byte is copied on the event loop that runs
 * every Lobby's Ticks (ADR 0054/0109).
 *
 * It knows nothing about Matches. The main thread tells it who is in which
 * room, whose Party is whose and who has Muted whom; {@link VoiceRooms} does
 * the rest. A token is resolved by asking the main thread, once per socket —
 * the database lives there.
 */

/** Room keepalives are minutes long; this is how often they are checked. */
const SWEEP_MS = 30_000;

/** A whole frame: the relay's header plus the largest payload it forwards, with slack for `ws`'s own accounting. */
const MAX_FRAME_BYTES = VOICE_SERVER_HEADER_BYTES + VOICE_MAX_FRAME_BYTES + 64;

const port = parentPort;
if (port === null) throw new Error("voice relay must run as a worker thread");
const requestedPort = Number((workerData as { port?: number } | undefined)?.port ?? 0);

const rooms = new VoiceRooms();
/** Sockets waiting for the main thread to say who they are. */
const pendingAuth = new Map<number, (result: { accountId: string | null; partyId: string | null; muted: string[] }) => void>();
let nextRequestId = 1;

const tell = (message: VoiceWorkerMessage): void => port.postMessage(message);

port.on("message", (message: VoiceHostMessage) => {
  try {
    switch (message.type) {
      case "roster":
        rooms.setRoster(message.roomId, message.accountIds);
        return;
      case "roomEnded":
        rooms.endRoom(message.roomId);
        return;
      case "party":
        rooms.setParty(message.accountId, message.partyId);
        return;
      case "mutes":
        rooms.setMutes(message.accountId, message.muted);
        return;
      case "authResult": {
        const waiting = pendingAuth.get(message.requestId);
        pendingAuth.delete(message.requestId);
        waiting?.({ accountId: message.accountId, partyId: message.partyId, muted: message.muted });
        return;
      }
    }
  } catch (err) {
    // A bad message from the main thread must not take the relay down and
    // every open voice socket with it.
    console.error("voice relay: host message failed:", err);
  }
});

// The HTTP server exists only to take the upgrade: nginx proxies
// `/api/voice` here directly, and where there is no nginx the API's own
// upgrade handler replays the handshake to this port.
const httpServer = createServer((_req, res) => {
  res.writeHead(404);
  res.end();
});
const wss = new WebSocketServer({ server: httpServer, path: VOICE_SOCKET_PATH, maxPayload: MAX_FRAME_BYTES });
wss.on("error", (err) => console.error("voice relay: websocket error:", err));
wss.on("connection", (socket: WebSocket) => accept(socket));

httpServer.listen(requestedPort, () => {
  const address = httpServer.address();
  tell({ type: "listening", port: typeof address === "object" && address ? address.port : requestedPort });
});

const pinger = setInterval(() => {
  for (const socket of wss.clients) {
    if (socket.readyState !== socket.OPEN) continue;
    try {
      socket.ping();
    } catch {
      // A socket that cannot be pinged is about to close on its own.
    }
  }
}, VOICE_PING_MS);
const sweeper = setInterval(() => rooms.sweep(), SWEEP_MS);
// Both hold the worker's loop open otherwise, so `worker.terminate()` is the
// only way out; unref'd, an idle relay lets the thread end cleanly.
pinger.unref();
sweeper.unref();

function accept(socket: WebSocket): void {
  let connection: VoiceConnection | null = null;
  let authorizing = false;
  const sink: VoiceSink = {
    sendJson: (message: VoiceServerMessage) => trySend(socket, JSON.stringify(message)),
    sendFrame: (frame: Uint8Array) => trySend(socket, frame),
    close: (code, reason) => socket.close(code, reason),
  };
  const authTimer = setTimeout(() => socket.close(VOICE_SOCKET_UNAUTHORIZED, VOICE_REFUSED_NO_ACCOUNT), VOICE_AUTH_TIMEOUT_MS);

  socket.on("error", () => {});
  socket.on("message", (data: RawData, isBinary: boolean) => {
    try {
      if (isBinary) {
        if (connection !== null) rooms.relay(connection, toBytes(data));
        return;
      }
      const message = parseJson(data);
      if (connection === null) {
        if (authorizing || message?.type !== "auth" || typeof message.token !== "string") return;
        authorizing = true;
        const scope: VoiceScope = isVoiceScope(message.scope) ? message.scope : "OFF";
        const requestId = nextRequestId++;
        pendingAuth.set(requestId, (result) => {
          authorizing = false;
          clearTimeout(authTimer);
          if (socket.readyState !== socket.OPEN) return;
          if (result.accountId === null) {
            socket.close(VOICE_SOCKET_UNAUTHORIZED, VOICE_REFUSED_NO_ACCOUNT);
            return;
          }
          // Both before the join, so the very first `peers` is already right
          // about who is linked and who is Muted.
          rooms.setParty(result.accountId, result.partyId);
          rooms.setMutes(result.accountId, result.muted);
          connection = rooms.join(result.accountId, scope, sink);
          if (connection === null) socket.close(VOICE_SOCKET_UNAUTHORIZED, VOICE_REFUSED_NO_ROOM);
        });
        tell({ type: "auth", requestId, token: message.token });
        return;
      }
      if (message?.type === "scope" && isVoiceScope(message.scope)) rooms.setScope(connection, message.scope);
    } catch (err) {
      console.error("voice relay: socket message failed:", err);
    }
  });
  socket.on("close", () => {
    clearTimeout(authTimer);
    if (connection !== null) rooms.leave(connection, sink);
  });
}

const trySend = (socket: WebSocket, data: string | Uint8Array): void => {
  if (socket.readyState !== socket.OPEN) return;
  try {
    socket.send(data);
  } catch {
    // A socket that cannot be written to is already going; its `close` follows.
  }
};

const toBytes = (data: RawData): Uint8Array =>
  Buffer.isBuffer(data) ? new Uint8Array(data) : Array.isArray(data) ? new Uint8Array(Buffer.concat(data)) : new Uint8Array(data);

/** One text frame as a loose record — `null` for anything that is not a JSON object. */
const parseJson = (data: RawData): Record<string, unknown> | null => {
  try {
    const value: unknown = JSON.parse(Buffer.from(toBytes(data)).toString("utf8"));
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};
