import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  encodeVoiceFrame,
  stampVoiceFrame,
  VOICE_REFUSED_NO_ACCOUNT,
  VOICE_REFUSED_NO_ROOM,
  VOICE_SOCKET_REPLACED,
  VOICE_SOCKET_UNAUTHORIZED,
  VOICE_SPEAKING_HOLD_MS,
  type VoicePeer,
  type VoiceScope,
  type VoiceServerMessage,
} from "@dont-fall/shared";
import {
  getVoiceSocketSnapshot,
  sendVoiceFrame,
  sendVoiceScope,
  setSelfSpeaking,
  startVoiceSocket,
  voiceSocketUrl,
  type VoiceSocketLike,
} from "./voiceSocket.js";

/** A voice socket a test drives by hand — every listener the module registered, and everything it sent. */
class FakeSocket implements VoiceSocketLike {
  readyState = 1;
  binaryType = "blob";
  readonly sent: (string | ArrayBufferView)[] = [];
  closedWith: { code?: number; reason?: string } | null = null;
  private readonly handlers = new Map<string, Set<EventListener>>();

  addEventListener = (type: string, listener: EventListener): void => {
    const set = this.handlers.get(type) ?? new Set();
    set.add(listener);
    this.handlers.set(type, set);
  };
  removeEventListener = (type: string, listener: EventListener): void => void this.handlers.get(type)?.delete(listener);
  send = (data: string | ArrayBufferView): void => void this.sent.push(data);
  close = (code?: number, reason?: string): void => {
    this.closedWith = { ...(code === undefined ? {} : { code }), ...(reason === undefined ? {} : { reason }) };
  };

  fire(type: string, event: unknown): void {
    for (const listener of [...(this.handlers.get(type) ?? [])]) listener(event as Event);
  }
  open(): void {
    this.fire("open", {});
  }
  say(message: VoiceServerMessage): void {
    this.fire("message", { data: JSON.stringify(message) });
  }
  /** One relayed Opus frame, as the relay stamps it. */
  frame(voiceId: number, sequence: number, payload = new Uint8Array([9, 9, 9])): void {
    const stamped = stampVoiceFrame(voiceId, sequence, payload);
    // A real socket hands over an ArrayBuffer, never a view onto a bigger one.
    this.fire("message", { data: stamped.buffer.slice(stamped.byteOffset, stamped.byteOffset + stamped.byteLength) });
  }
  drop(code = 1006, reason = ""): void {
    this.fire("close", { code, reason });
  }
  /** Whatever it last sent, parsed — the JSON channel only. */
  lastJson(): Record<string, unknown> | null {
    for (let i = this.sent.length - 1; i >= 0; i -= 1) {
      const sent = this.sent[i]!;
      if (typeof sent === "string") return JSON.parse(sent) as Record<string, unknown>;
    }
    return null;
  }
  /** Every binary frame it sent, as bytes. */
  frames(): Uint8Array[] {
    return this.sent.filter((sent): sent is Uint8Array => sent instanceof Uint8Array);
  }
}

const peer = (voiceId: number, accountId: string, linked = true): VoicePeer => ({ voiceId, accountId, linked });

let sockets: FakeSocket[];
let stop: (() => void) | null;
let scope: VoiceScope;
let frames: { accountId: string; sequence: number }[];
let silenced: string[];

const start = (options: { token?: string | null } = {}) => {
  frames = [];
  silenced = [];
  return startVoiceSocket({
    url: "ws://voice.test/voice",
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    getToken: () => (options.token === undefined ? "tok" : options.token),
    getScope: () => scope,
    frame: (accountId, sequence) => void frames.push({ accountId, sequence }),
    silent: (accountId) => void silenced.push(accountId),
  });
};

/** Starts, opens and signs in — the ordinary path every test but the refusals begins from. */
const joined = (accountId = "me"): FakeSocket => {
  stop = start();
  const socket = sockets.at(-1)!;
  socket.open();
  socket.say({ type: "ready", accountId, voiceId: 1 });
  return socket;
};

beforeEach(() => {
  vi.useFakeTimers();
  sockets = [];
  stop = null;
  scope = "ALL";
});

afterEach(() => {
  stop?.();
  vi.useRealTimers();
});

describe("voiceSocketUrl", () => {
  it("is the API's own base at the relay's path, as ws / wss", () => {
    expect(voiceSocketUrl("http://localhost:8081", "http://localhost:5173/")).toBe("ws://localhost:8081/voice");
    // Online the base is a bare path against the page's own origin (ADR 0108).
    expect(voiceSocketUrl("/api", "https://play.example.com/lobby")).toBe("wss://play.example.com/api/voice");
  });
});

describe("startVoiceSocket", () => {
  it("authenticates with the token and this device's scope, never in the URL", () => {
    scope = "PARTY";
    stop = start();
    const socket = sockets.at(-1)!;
    socket.open();

    expect(socket.lastJson()).toEqual({ type: "auth", token: "tok", scope: "PARTY" });
    expect(voiceSocketUrl("http://api.test", "http://page.test/")).not.toContain("tok");
  });

  it("takes frames as bytes rather than a Blob nobody can read in time", () => {
    stop = start();

    expect(sockets.at(-1)!.binaryType).toBe("arraybuffer");
  });

  it("does not dial at all without a token", () => {
    stop = start({ token: null });

    expect(sockets).toHaveLength(0);
    expect(getVoiceSocketSnapshot().status).toBe("closed");
  });

  it("is open, and knows its own Account, once the relay says ready", () => {
    joined("acc-me");

    expect(getVoiceSocketSnapshot()).toMatchObject({ status: "open", accountId: "acc-me" });
  });
});

describe("the room", () => {
  it("holds the peers the relay last sent, linked flag and all", () => {
    const socket = joined();

    socket.say({ type: "peers", peers: [peer(2, "acc-b"), peer(3, "acc-c", false)] });

    expect(getVoiceSocketSnapshot().peers).toEqual([peer(2, "acc-b"), peer(3, "acc-c", false)]);
  });

  it("names an arriving frame by its speaker's Account, off that roster", () => {
    const socket = joined();
    socket.say({ type: "peers", peers: [peer(2, "acc-b")] });

    socket.frame(2, 41);

    expect(frames).toEqual([{ accountId: "acc-b", sequence: 41 }]);
  });

  it("drops a frame from a voiceId the roster does not name yet, rather than guessing", () => {
    const socket = joined();

    socket.frame(7, 1);

    expect(frames).toEqual([]);
    expect(getVoiceSocketSnapshot().speaking).toEqual([]);
  });
});

describe("speaking", () => {
  it("starts on the first frame and holds past the last, so a cue does not flicker between words", () => {
    const socket = joined();
    socket.say({ type: "peers", peers: [peer(2, "acc-b")] });

    socket.frame(2, 1);
    expect(getVoiceSocketSnapshot().speaking).toEqual(["acc-b"]);

    vi.advanceTimersByTime(VOICE_SPEAKING_HOLD_MS - 1);
    expect(getVoiceSocketSnapshot().speaking).toEqual(["acc-b"]);

    vi.advanceTimersByTime(2);
    expect(getVoiceSocketSnapshot().speaking).toEqual([]);
    expect(silenced).toEqual(["acc-b"]);
  });

  it("holds two speakers on one timer, each ending at its own last frame", () => {
    const socket = joined();
    socket.say({ type: "peers", peers: [peer(2, "acc-b"), peer(3, "acc-c")] });

    socket.frame(2, 1);
    vi.advanceTimersByTime(VOICE_SPEAKING_HOLD_MS / 2);
    socket.frame(3, 1);
    expect(getVoiceSocketSnapshot().speaking).toEqual(["acc-b", "acc-c"]);

    vi.advanceTimersByTime(VOICE_SPEAKING_HOLD_MS / 2 + 1);
    expect(getVoiceSocketSnapshot().speaking).toEqual(["acc-c"]);

    vi.advanceTimersByTime(VOICE_SPEAKING_HOLD_MS);
    expect(getVoiceSocketSnapshot().speaking).toEqual([]);
  });

  it("carries your own cue beside the heard ones, and neither overwrites the other", () => {
    const socket = joined("acc-me");
    socket.say({ type: "peers", peers: [peer(2, "acc-b")] });

    setSelfSpeaking(true);
    expect(getVoiceSocketSnapshot().speaking).toEqual(["acc-me"]);

    socket.frame(2, 1);
    expect(getVoiceSocketSnapshot().speaking).toEqual(["acc-b", "acc-me"]);

    // The other speaker's hold running out must not take your own cue with it.
    vi.advanceTimersByTime(VOICE_SPEAKING_HOLD_MS + 1);
    expect(getVoiceSocketSnapshot().speaking).toEqual(["acc-me"]);

    setSelfSpeaking(false);
    expect(getVoiceSocketSnapshot().speaking).toEqual([]);
  });

  it("stops a speaker at once when the room says they are gone or no longer heard", () => {
    const socket = joined();
    socket.say({ type: "peers", peers: [peer(2, "acc-b"), peer(3, "acc-c")] });
    socket.frame(2, 1);
    socket.frame(3, 1);

    // b left; c went OFF, so the relay says they are no longer linked.
    socket.say({ type: "peers", peers: [peer(3, "acc-c", false)] });

    expect(getVoiceSocketSnapshot().speaking).toEqual([]);
    expect(silenced.sort()).toEqual(["acc-b", "acc-c"]);
  });

  it("lets every speaker go when the socket drops", () => {
    const socket = joined();
    socket.say({ type: "peers", peers: [peer(2, "acc-b")] });
    socket.frame(2, 1);

    socket.drop();

    expect(getVoiceSocketSnapshot().speaking).toEqual([]);
    expect(silenced).toEqual(["acc-b"]);
  });
});

describe("sending", () => {
  it("stamps each frame with the next sequence, and wraps at 16 bits", () => {
    const socket = joined();

    sendVoiceFrame(new Uint8Array([1, 2]));
    sendVoiceFrame(new Uint8Array([3, 4]));

    expect(socket.frames()).toEqual([encodeVoiceFrame(0, new Uint8Array([1, 2])), encodeVoiceFrame(1, new Uint8Array([3, 4]))]);
  });

  it("is quiet with no open socket — a Player talking into a drop loses audio, not their session", () => {
    const socket = joined();
    socket.drop();

    expect(() => sendVoiceFrame(new Uint8Array([1]))).not.toThrow();
    expect(socket.frames()).toEqual([]);
  });

  it("tells the relay a new scope without reconnecting", () => {
    const socket = joined();

    sendVoiceScope("OFF");

    expect(socket.lastJson()).toEqual({ type: "scope", scope: "OFF" });
    expect(sockets).toHaveLength(1);
  });
});

describe("when it goes away", () => {
  it("redials an ordinary drop, with a backoff", () => {
    joined();
    sockets.at(-1)!.drop();

    expect(getVoiceSocketSnapshot().status).toBe("connecting");
    expect(sockets).toHaveLength(1);

    vi.advanceTimersByTime(500);
    expect(sockets).toHaveLength(2);

    sockets.at(-1)!.drop();
    vi.advanceTimersByTime(500);
    expect(sockets).toHaveLength(2); // the second wait is longer than the first
    vi.advanceTimersByTime(500);
    expect(sockets).toHaveLength(3);
  });

  it("redials a room that is not there yet — the roster races this socket, and losing a Match to it would be absurd", () => {
    joined();

    sockets.at(-1)!.drop(VOICE_SOCKET_UNAUTHORIZED, VOICE_REFUSED_NO_ROOM);
    vi.advanceTimersByTime(500);

    expect(sockets).toHaveLength(2);
  });

  it("gives up on a token the API would not take", () => {
    joined();

    sockets.at(-1)!.drop(VOICE_SOCKET_UNAUTHORIZED, VOICE_REFUSED_NO_ACCOUNT);
    vi.advanceTimersByTime(60_000);

    expect(sockets).toHaveLength(1);
    expect(getVoiceSocketSnapshot().status).toBe("unauthorized");
  });

  it("does not fight the relay for a seat it took away on purpose", () => {
    joined();

    sockets.at(-1)!.drop(VOICE_SOCKET_REPLACED, "voice opened on another tab");
    vi.advanceTimersByTime(60_000);

    expect(sockets).toHaveLength(1);
    expect(getVoiceSocketSnapshot().status).toBe("closed");
  });

  it("closes the live socket on stop, and does not take that for a drop", () => {
    const socket = joined();

    stop?.();
    stop = null;
    vi.advanceTimersByTime(60_000);

    expect(socket.closedWith).not.toBeNull();
    expect(sockets).toHaveLength(1);
    expect(getVoiceSocketSnapshot()).toEqual({ status: "closed", accountId: null, peers: [], speaking: [] });
  });

  it("stops the socket before it when a second one opens — a page has one", () => {
    const first = joined();

    stop = start();

    expect(first.closedWith).not.toBeNull();
    expect(sockets).toHaveLength(2);
  });
});
