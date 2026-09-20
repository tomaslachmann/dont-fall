// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BINDINGS, VOICE_GATE_HANG_MS, VOICE_GATE_THRESHOLD } from "@dont-fall/shared";
import { writeVoiceSettings, type VoiceSettings } from "../voiceSettings.js";
import { startVoiceSession, stopVoiceSession } from "./session.js";
import { startTalkListener } from "./talk.js";
import { getVoiceSocketSnapshot, type VoiceSocketLike } from "./voiceSocket.js";
import type { VoiceCapture } from "./capture.js";
import type { VoiceLimit } from "./support.js";

/** A microphone that never touches hardware, and remembers whether it was told to gather. */
class FakeCapture implements VoiceCapture {
  capturing = false;
  closed = false;
  /** Set by the session: where an encoded frame goes. */
  emit: (payload: Uint8Array, level: number) => void = () => {};

  setCapturing = (capturing: boolean): void => void (this.capturing = capturing);
  close = async (): Promise<void> => void (this.closed = true);
}

/** A voice socket that signs in the moment it is opened, so a test can talk on it. */
const fakeSocket = (): VoiceSocketLike => {
  const handlers = new Map<string, Set<EventListener>>();
  const socket: VoiceSocketLike = {
    readyState: 1,
    binaryType: "blob",
    addEventListener: (type, listener) => {
      const set = handlers.get(type) ?? new Set();
      set.add(listener);
      handlers.set(type, set);
    },
    removeEventListener: (type, listener) => void handlers.get(type)?.delete(listener),
    send: (data) => void sent.push(data),
    close: () => {},
  };
  queueMicrotask(() => {
    for (const listener of handlers.get("open") ?? []) listener(new Event("open"));
    for (const listener of handlers.get("message") ?? []) {
      listener({ data: JSON.stringify({ type: "ready", accountId: "me", voiceId: 1 }) } as unknown as Event);
    }
  });
  return socket;
};

let sent: (string | ArrayBufferView)[];
let capture: FakeCapture;
let opened: number;
let openFails: Error | null;
let reported: VoiceLimit[];
let limit: VoiceLimit | null;
let clock: number;
let stopSession: (() => void) | null;
let stopTalk: (() => void) | null;

const settings = (next: Partial<VoiceSettings>): void =>
  writeVoiceSettings(localStorage, { scope: "ALL", talkMode: "PUSH TO TALK", ...next });

/** Starts a session and its talk listener, with everything faked out. */
const run = async (): Promise<void> => {
  stopSession = startVoiceSession({
    createPlayback: () => ({
      play: () => {},
      applyPlacements: () => {},
      flatten: () => {},
      drop: () => {},
      setGain: () => {},
      close: () => {},
    }),
    openCapture: async (config) => {
      opened += 1;
      if (openFails !== null) throw openFails;
      capture.emit = config.onFrame;
      return capture;
    },
  });
  stopTalk = startTalkListener({
    getBindings: () => DEFAULT_BINDINGS,
    limit: () => limit,
    report: (reason) => void reported.push(reason),
    now: () => clock,
  });
  // The socket signs in on a microtask, as a real one would on a turn of its own.
  await Promise.resolve();
  await Promise.resolve();
};

const press = (code = "KeyV", init: KeyboardEventInit = {}) =>
  window.dispatchEvent(new KeyboardEvent("keydown", { code, ...init }));
const release = (code = "KeyV") => window.dispatchEvent(new KeyboardEvent("keyup", { code }));
/** Waits for the microphone open to settle — it is a promise, even when it resolves at once. */
const settle = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  localStorage.clear();
  // The voice socket carries the Account's session token in its `auth`, so
  // without one it never dials at all and nothing below would be sent.
  localStorage.setItem("df_auth_token", "tok");
  sent = [];
  capture = new FakeCapture();
  opened = 0;
  openFails = null;
  reported = [];
  limit = null;
  clock = 0;
  stopSession = null;
  stopTalk = null;
  settings({});
  vi.stubGlobal("WebSocket", function FakeWebSocket() {
    return fakeSocket();
  });
});

afterEach(() => {
  stopTalk?.();
  stopSession?.();
  stopVoiceSession();
  vi.unstubAllGlobals();
});

describe("push to talk", () => {
  it("asks for the microphone on the first press, never before", async () => {
    await run();
    expect(opened).toBe(0);

    press();
    await settle();

    expect(opened).toBe(1);
    expect(capture.capturing).toBe(true);
  });

  it("keeps the microphone for the rest of the session — no first syllable is clipped", async () => {
    await run();
    press();
    await settle();
    release();

    expect(capture.capturing).toBe(false);
    expect(capture.closed).toBe(false);

    press();
    await settle();

    expect(opened).toBe(1);
    expect(capture.capturing).toBe(true);
  });

  it("holds while either of two bound controls is down", async () => {
    await run();
    press("KeyV");
    await settle();
    press("KeyV"); // the same one twice is still one control
    release("KeyV");

    expect(capture.capturing).toBe(false);
  });

  it("ignores an unbound key, and auto-repeat", async () => {
    await run();

    press("KeyB");
    press("KeyV", { repeat: true });
    await settle();

    expect(opened).toBe(0);
    expect(capture.capturing).toBe(false);
  });

  it("ignores a key typed into a text field — naming a Lobby must not broadcast it", async () => {
    await run();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    press();
    await settle();

    expect(opened).toBe(0);
    input.remove();
  });

  it("counts a mouse button only while the game holds the pointer", async () => {
    await run();
    stopTalk?.();
    let locked: Element | null = null;
    stopTalk = startTalkListener({
      getBindings: () => ({ ...DEFAULT_BINDINGS, talk: ["Mouse2"] }),
      limit: () => null,
      report: () => {},
      now: () => clock,
      doc: {
        get pointerLockElement() {
          return locked;
        },
        get activeElement() {
          return document.body;
        },
      } as unknown as Document,
    });

    window.dispatchEvent(new MouseEvent("mousedown", { button: 2 }));
    await settle();
    expect(opened).toBe(0);

    locked = document.body;
    window.dispatchEvent(new MouseEvent("mousedown", { button: 2 }));
    await settle();
    expect(capture.capturing).toBe(true);
  });

  it("lets go when the window does", async () => {
    await run();
    press();
    await settle();

    window.dispatchEvent(new Event("blur"));

    expect(capture.capturing).toBe(false);
    expect(getVoiceSocketSnapshot().speaking).toEqual([]);
  });

  it("sends every frame while held, and marks you speaking", async () => {
    await run();
    press();
    await settle();

    expect(getVoiceSocketSnapshot().speaking).toEqual(["me"]);
    capture.emit(new Uint8Array([7, 7]), 0);
    capture.emit(new Uint8Array([8, 8]), 0);

    expect(sent.filter((data) => data instanceof Uint8Array)).toHaveLength(2);
  });

  it("says nothing at all on OFF — it is not listen-only", async () => {
    settings({ scope: "OFF" });
    await run();

    press();
    await settle();

    expect(opened).toBe(0);
    expect(getVoiceSocketSnapshot().speaking).toEqual([]);
  });
});

describe("open mic", () => {
  it("opens the microphone as soon as it is chosen, and gathers the whole time", async () => {
    settings({ talkMode: "OPEN MIC" });
    await run();
    await settle();

    expect(opened).toBe(1);
    expect(capture.capturing).toBe(true);
  });

  it("sends only what the gate lets through, and holds through the gap between words", async () => {
    settings({ talkMode: "OPEN MIC" });
    await run();
    await settle();
    const frames = () => sent.filter((data) => data instanceof Uint8Array).length;

    capture.emit(new Uint8Array([1]), VOICE_GATE_THRESHOLD / 2);
    expect(frames()).toBe(0);

    capture.emit(new Uint8Array([2]), VOICE_GATE_THRESHOLD * 2);
    expect(frames()).toBe(1);
    expect(getVoiceSocketSnapshot().speaking).toEqual(["me"]);

    clock += VOICE_GATE_HANG_MS - 1;
    capture.emit(new Uint8Array([3]), 0);
    expect(frames()).toBe(2);

    clock += 2;
    capture.emit(new Uint8Array([4]), 0);
    expect(frames()).toBe(2);
    expect(getVoiceSocketSnapshot().speaking).toEqual([]);
  });

  it("stops gathering the moment the Player switches back to push to talk", async () => {
    settings({ talkMode: "OPEN MIC" });
    await run();
    await settle();
    expect(capture.capturing).toBe(true);

    settings({ talkMode: "PUSH TO TALK" });

    expect(capture.capturing).toBe(false);
    expect(getVoiceSocketSnapshot().speaking).toEqual([]);
  });
});

describe("when it cannot talk", () => {
  it("says why, once, and does not ask again", async () => {
    limit = "insecure";
    await run();

    press();
    await settle();
    release();
    press();
    await settle();

    expect(reported).toEqual(["insecure"]);
    expect(opened).toBe(0);
  });

  it("reports a refusal as the refusal it was, not as a broken browser", async () => {
    openFails = Object.assign(new Error("denied"), { name: "NotAllowedError" });
    await run();

    press();
    await settle();

    expect(reported).toEqual(["refused"]);
  });

  it("tells a missing microphone from a refused one", async () => {
    openFails = Object.assign(new Error("none"), { name: "NotFoundError" });
    await run();

    press();
    await settle();

    expect(reported).toEqual(["noMicrophone"]);
  });
});

describe("stopping", () => {
  it("lets the microphone go, so the browser's indicator goes out", async () => {
    await run();
    press();
    await settle();

    stopTalk?.();
    stopTalk = null;
    stopSession?.();
    stopSession = null;

    expect(capture.closed).toBe(true);
    expect(getVoiceSocketSnapshot().speaking).toEqual([]);
  });

  it("stops listening — a press after the session ended reaches nothing", async () => {
    await run();
    stopTalk?.();
    stopTalk = null;

    press();
    await settle();

    expect(opened).toBe(0);
  });
});
