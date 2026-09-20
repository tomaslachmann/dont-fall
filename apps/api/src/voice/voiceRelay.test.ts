import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import {
  encodeVoiceFrame,
  readVoiceFrame,
  VOICE_SOCKET_PATH,
  VOICE_SOCKET_UNAUTHORIZED,
  type VoiceClientMessage,
  type VoiceServerMessage,
} from "@dont-fall/shared";
import { VoiceService } from "./voice.service.js";

/**
 * The relay for real: a worker thread of its own, a token resolved back on
 * the main thread, and two `ws` clients hearing each other. Everything the
 * relay's rules do is tested in `voiceRooms.test.ts`; this is the wiring
 * around them — the thread, its port, and the `MessagePort` between.
 */

const TOKENS: Record<string, string> = { "token-a": "account-a", "token-b": "account-b" };

let voice: VoiceService;
let port = 0;
const open: WebSocket[] = [];

beforeEach(async () => {
  voice = new VoiceService({
    authenticate: (token) => TOKENS[token],
    mutesOf: () => [],
    partyOf: () => null,
    port: 0,
  });
  port = await voice.start();
});

afterEach(async () => {
  for (const socket of open.splice(0)) socket.close();
  await voice.close();
});

/** Opens a voice socket, says `auth`, and collects everything that comes back. */
const dial = (token: string, scope: "OFF" | "PARTY" | "ALL" = "ALL") => {
  const socket = new WebSocket(`ws://127.0.0.1:${port}${VOICE_SOCKET_PATH}`);
  open.push(socket);
  const json: VoiceServerMessage[] = [];
  const frames: Uint8Array[] = [];
  let closedWith: number | null = null;
  socket.on("message", (data: Buffer, isBinary: boolean) => {
    if (isBinary) frames.push(new Uint8Array(data));
    else json.push(JSON.parse(data.toString("utf8")) as VoiceServerMessage);
  });
  socket.on("close", (code) => {
    closedWith = code;
  });
  socket.on("error", () => {});
  socket.on("open", () => socket.send(JSON.stringify({ type: "auth", token, scope } satisfies VoiceClientMessage)));
  return {
    socket,
    json,
    frames,
    closed: () => closedWith,
    talk: (sequence: number) => socket.send(encodeVoiceFrame(sequence, new Uint8Array([4, 5, 6]))),
  };
};

/** Waits until `check` holds, or gives up — every wait here is a socket round trip on localhost. */
const until = async (check: () => boolean, what: string): Promise<void> => {
  for (let i = 0; i < 200; i += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${what}`);
};

describe("the voice relay worker", () => {
  it("relays between two Accounts the Lobby's roster seats together", async () => {
    voice.setRoster(51000, ["account-a", "account-b"]);
    const a = dial("token-a");
    const b = dial("token-b");
    await until(() => a.json.some((m) => m.type === "ready") && b.json.some((m) => m.type === "ready"), "both ready");
    await until(() => b.json.some((m) => m.type === "peers" && m.peers.some((peer) => peer.linked)), "b's peers");

    a.talk(42);
    await until(() => b.frames.length > 0, "b to hear a");
    const heard = readVoiceFrame(b.frames[0]!);
    expect(heard?.sequence).toBe(42);
    expect([...(heard?.payload ?? [])]).toEqual([4, 5, 6]);
    expect(a.frames).toHaveLength(0);
  });

  it("refuses a token the API would not take", async () => {
    voice.setRoster(51000, ["account-a"]);
    const stranger = dial("nonsense");
    await until(() => stranger.closed() !== null, "the refusal");
    expect(stranger.closed()).toBe(VOICE_SOCKET_UNAUTHORIZED);
  });

  it("refuses an Account seated in no Lobby", async () => {
    const adrift = dial("token-a");
    await until(() => adrift.closed() !== null, "the refusal");
    expect(adrift.closed()).toBe(VOICE_SOCKET_UNAUTHORIZED);
  });

  it("replays a roster said before the worker was listening", async () => {
    const early = new VoiceService({ authenticate: (token) => TOKENS[token], mutesOf: () => [], partyOf: () => null, port: 0 });
    early.setRoster(51000, ["account-a"]);
    const earlyPort = await early.start();
    const socket = new WebSocket(`ws://127.0.0.1:${earlyPort}${VOICE_SOCKET_PATH}`);
    open.push(socket);
    const json: VoiceServerMessage[] = [];
    socket.on("message", (data: Buffer) => void json.push(JSON.parse(data.toString("utf8")) as VoiceServerMessage));
    socket.on("error", () => {});
    socket.on("open", () => socket.send(JSON.stringify({ type: "auth", token: "token-a", scope: "ALL" })));
    await until(() => json.some((m) => m.type === "ready"), "ready on the early roster");
    await early.close();
  });
});
