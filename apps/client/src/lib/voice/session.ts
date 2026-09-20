/**
 * The voice session (ADR 0111) — the one thing that owns a socket, a
 * microphone and a room full of decoders, and the one thing that knows when
 * any of them should exist.
 *
 * It lives **above the routes**, mounted by `<AuthGate>`, because voice lasts
 * from joining a Lobby, through every Round and every Standings, until the
 * Player leaves the MatchOver podium — and the navigation from `/lobby` to
 * `/match/:id` in the middle of that would end anything owned by a Screen.
 *
 * What it does *not* do is decide who hears whom. The relay does, on the
 * shared link rule; this only plays what arrives and sends what the Player
 * asks it to.
 */
import { useMemo, useSyncExternalStore } from "react";
import { sharedAudioContext } from "../../audio/sharedContext.js";
import { readAudioVolumes, subscribeAudioVolumes, voiceGain } from "../audioSettings.js";
import { browserStorage } from "../browserStorage.js";
import { readVoiceSettings, subscribeVoiceSettings, type VoiceSettings } from "../voiceSettings.js";
import { createVoicePlayback, type VoicePlacement, type VoicePlayback } from "./playback.js";
import { placementInScene, type VoiceScene } from "./placement.js";
import type { VoiceCapture } from "./capture.js";
import {
  getVoiceSocketSnapshot,
  sendVoiceScope,
  startVoiceSocket,
  subscribeVoiceSocket,
  type VoiceSocketState,
} from "./voiceSocket.js";

/** Opens the microphone. A function so the encoder and the worklet are only loaded once someone actually talks. */
export type OpenCapture = typeof import("./capture.js")["openVoiceCapture"];

export interface VoiceSessionOptions {
  /** Test seam: the microphone. Production loads `capture.ts` on demand. */
  openCapture?: OpenCapture;
  /** Test seam: the playback chain. Production builds one on the page's shared context. */
  createPlayback?: typeof createVoicePlayback;
  /** Test seam: starting the socket. */
  startSocket?: typeof startVoiceSocket;
}

interface Running {
  stopSocket: () => void;
  stopVolumes: () => void;
  stopSettings: () => void;
  playback: VoicePlayback | null;
  /** The microphone, once someone has actually pressed talk. `null` until then, for the whole visit if never. */
  capture: VoiceCapture | null;
  /** The open in flight, so two fast presses ask once. */
  opening: Promise<VoiceCapture> | null;
  options: VoiceSessionOptions;
}

let running: Running | null = null;
/** This device's settings, read once at start and kept current — what the socket authenticates with. */
let settings: VoiceSettings = { scope: "OFF", talkMode: "PUSH TO TALK" };
/** Whether the Player is asking to be heard right now: talk held, or the open-mic gate open. */
let talking = false;

const storage = (): Pick<Storage, "getItem" | "setItem"> | null => browserStorage();

/**
 * Starts the session: a socket, a playback chain, and nothing else until the
 * Player talks. Returns the stop, which closes all three — the microphone
 * included, so the browser's indicator goes out when they leave.
 */
export const startVoiceSession = (options: VoiceSessionOptions = {}): (() => void) => {
  stopVoiceSession();
  settings = readVoiceSettings(storage());

  const context = sharedAudioContext();
  const createPlayback = options.createPlayback ?? createVoicePlayback;
  const playback =
    context === null ? null : createPlayback({ context, gain: voiceGain(readAudioVolumes(storage())) });

  const startSocket = options.startSocket ?? startVoiceSocket;
  const stopSocket = startSocket({
    getScope: () => settings.scope,
    frame: (accountId, _sequence, payload) => playback?.play(accountId, payload),
    silent: (accountId) => playback?.drop(accountId),
  });

  const stopVolumes = subscribeAudioVolumes((volumes) => playback?.setGain(voiceGain(volumes)), storage());
  const stopSettings = subscribeVoiceSettings((next) => {
    const wasScope = settings.scope;
    settings = next;
    // The relay is told rather than reconnected to: a scope is a fact about
    // this socket, not a reason to open another one. What the change means
    // for *talking* is the talk listener's, which subscribes to the same
    // store — one owner per question.
    if (next.scope !== wasScope) sendVoiceScope(next.scope);
  }, storage());

  running = { stopSocket, stopVolumes, stopSettings, playback, capture: null, opening: null, options };
  return stopVoiceSession;
};

/** Ends it: the socket, every decoder, and the microphone. Idempotent. */
export const stopVoiceSession = (): void => {
  const session = running;
  running = null;
  if (session === null) return;
  talking = false;
  session.stopSettings();
  session.stopVolumes();
  session.stopSocket();
  session.playback?.close();
  void session.capture?.close();
};

/** Whether a session is running — what the talk listener checks before asking for a microphone. */
export const voiceSessionRunning = (): boolean => running !== null;

/** This device's settings, as the session holds them. Read by the talk listener, which must not re-read storage per key press. */
export const voiceSessionSettings = (): VoiceSettings => settings;

/**
 * Starts or stops sending. The microphone is not opened here — it is opened
 * by whoever asked to talk (`talk.ts`), which is also the only place that can
 * honestly report a refusal to the Player.
 */
export const setTalking = (next: boolean): void => {
  const wanted = next && settings.scope !== "OFF";
  if (talking === wanted) return;
  talking = wanted;
  running?.capture?.setCapturing(wanted);
};

/** Whether the Player is being sent right now. */
export const isTalking = (): boolean => talking;

/**
 * The microphone, opened on first use and kept for the rest of the session.
 * Rejects with whatever `getUserMedia` rejected with; two fast presses share
 * one ask rather than racing two permission prompts.
 */
export const acquireMicrophone = async (): Promise<VoiceCapture> => {
  const session = running;
  if (session === null) throw new Error("voice session is not running");
  if (session.capture !== null) return session.capture;
  if (session.opening !== null) return session.opening;

  const open = session.options.openCapture ?? (async (config) => (await import("./capture.js")).openVoiceCapture(config));
  const opening = open({
    onFrame: (payload, level) => onCapturedFrame(payload, level),
  })
    .then((capture) => {
      // Stopped while the browser was still asking: let it straight back go,
      // rather than leaving an indicator lit over an empty session.
      if (running !== session) {
        void capture.close();
        throw new Error("voice session ended while the microphone was opening");
      }
      session.capture = capture;
      session.opening = null;
      capture.setCapturing(talking);
      return capture;
    })
    .catch((err: unknown) => {
      session.opening = null;
      throw err;
    });
  session.opening = opening;
  return opening;
};

/**
 * One encoded frame off the microphone. Set by `talk.ts`, because what
 * happens to a frame depends on how the Player is talking: push-to-talk
 * sends every one, open mic sends only what its gate lets through.
 */
let frameSink: (payload: Uint8Array, level: number) => void = () => {};

export const setVoiceFrameSink = (sink: (payload: Uint8Array, level: number) => void): void => {
  frameSink = sink;
};

const onCapturedFrame = (payload: Uint8Array, level: number): void => frameSink(payload, level);

/**
 * Where each speaker is heard from (ADR 0111) — the game hands this down once
 * a frame while a Round draws, through its `GameConfig` sink (ADR 0008) and
 * never through React. `null` is a Screen, or a Round that stopped drawing:
 * everyone goes flat.
 *
 * The game raises where the camera and the Characters are; the arithmetic is
 * here, so nothing in the renderer has to know what a voice is.
 */
export const placeVoices = (scene: VoiceScene | null): void => {
  const playback = running?.playback;
  if (!playback) return;
  if (scene === null) {
    playback.flatten();
    return;
  }
  playback.applyPlacements((accountId) => placementInScene(scene, accountId));
};

/**
 * Whose voice is being heard right now, as Account ids — the same edges
 * `useVoiceRoom` gives React, for the things that cannot go through React.
 * The nameplates are drawn per frame (ADR 0060), so the game pulls this
 * rather than being pushed it.
 */
export const speakingAccounts = (): ReadonlySet<string> => new Set(getVoiceSocketSnapshot().speaking);

/** Everyone is flat again — a Round ended, or the Stage went away under them. */
const useVoiceSocketState = (): VoiceSocketState =>
  useSyncExternalStore(subscribeVoiceSocket, getVoiceSocketSnapshot, getVoiceSocketSnapshot);

export interface VoiceRoom {
  /** Whether this client's voice socket is up — the cues mean nothing otherwise. */
  connected: boolean;
  /** Whom this client can hear, and who can hear them: the relay's own answer, Mutes already applied. */
  linked: readonly string[];
  /** Who is talking right now, your own Account included while you are. */
  speaking: readonly string[];
  /** Whether a given Account is talking — what an Avatar's ring and a nameplate read. */
  isSpeaking: (accountId: string) => boolean;
}

/** The room as the Screens read it (ADR 0111). Only edges reach React: a frame never does. */
export const useVoiceRoom = (): VoiceRoom => {
  const { status, peers, speaking } = useVoiceSocketState();
  return useMemo(() => {
    const linked = peers.filter((peer) => peer.linked).map((peer) => peer.accountId);
    const talkingNow = new Set(speaking);
    return {
      connected: status === "open",
      linked,
      speaking,
      isSpeaking: (accountId: string) => talkingNow.has(accountId),
    };
  }, [status, peers, speaking]);
};

export type { VoicePlacement, VoiceScene };
