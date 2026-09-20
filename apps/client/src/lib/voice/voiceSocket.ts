/**
 * The voice socket (ADR 0111) — this client's own connection to the relay,
 * separate from the Lobby socket so a burst of voice never queues ahead of a
 * Snapshot (ADR 0109).
 *
 * One module-level owner, the `accountSocket.ts` pattern: the session opens
 * it, and any Screen reads who is in the room and who is talking without
 * owning the connection. It carries two kinds of traffic and keeps them
 * apart: JSON text for who is here and who hears whom, binary for the audio
 * itself. Nothing here decodes or plays anything — {@link VoiceSocketHandlers}
 * hands each arriving frame on, which is what makes this file testable with
 * no Web Audio at all.
 *
 * The relay decides who hears whom, never this. What arrives has already been
 * allowed through the link rule and the listener's own Mutes; what is sent
 * reaches whoever the relay says, and the client is not consulted.
 */
import {
  encodeVoiceFrame,
  readVoiceFrame,
  VOICE_REFUSED_NO_ACCOUNT,
  VOICE_SOCKET_PATH,
  VOICE_SOCKET_REPLACED,
  VOICE_SOCKET_UNAUTHORIZED,
  VOICE_SPEAKING_HOLD_MS,
  type VoiceClientMessage,
  type VoicePeer,
  type VoiceScope,
  type VoiceServerMessage,
} from "@dont-fall/shared";
import { apiBaseUrl, getStoredToken } from "../api/base.js";
import { listen, type ListenerTarget } from "../socket/listeners.js";

/** The slice of a `WebSocket` this module uses — what a test's fake stands in for. */
export interface VoiceSocketLike extends ListenerTarget {
  readonly readyState: number;
  binaryType: string;
  send: (data: string | ArrayBufferView) => void;
  close: (code?: number, reason?: string) => void;
}

/** What the session does with what arrives — audio, and the roster it is drawn against. */
export interface VoiceSocketHandlers {
  /**
   * One relayed Opus frame, already named by its speaker's Account. Called
   * for every frame that arrives; the session decodes and plays it.
   */
  frame?: (accountId: string, sequence: number, payload: Uint8Array) => void;
  /** A speaker stopped being heard — whatever of theirs is still scheduled can be let go. */
  silent?: (accountId: string) => void;
  /** The room, the status or who is talking changed. */
  changed?: () => void;
}

export interface VoiceSocketOptions extends VoiceSocketHandlers {
  /** Opens the socket. Defaults to the browser's `WebSocket`; tests pass a fake. */
  createSocket?: (url: string) => VoiceSocketLike;
  /** Where to open it. Defaults to {@link voiceSocketUrl}. */
  url?: string;
  /** The session token the first message carries — never the URL, as the Account socket does. */
  getToken?: () => string | null;
  /** The scope to authenticate with, read at every (re)connect so a redial never carries a stale one. */
  getScope: () => VoiceScope;
  /** This page's clock — the speaking hold's, and a test's. */
  now?: () => number;
}

/**
 * `closed` before it opens and after the session ends; `connecting` while it
 * dials, and while it waits to redial; `open` once the relay said `ready`.
 * `unauthorized` is final — a token the API refused will be refused again.
 */
export type VoiceSocketStatus = "closed" | "connecting" | "open" | "unauthorized";

export interface VoiceSocketState {
  status: VoiceSocketStatus;
  /** Whose socket this is, off the relay's `ready` — `null` until then. */
  accountId: string | null;
  /** Everyone else in the room, and whether this client would hear them. */
  peers: VoicePeer[];
  /**
   * Whose voice is being heard right now, Account ids, plus your own while you
   * are talking. Speaking is frames moving (ADR 0111) — no level analysis
   * anywhere, because push-to-talk and the open-mic gate already decided.
   */
  speaking: readonly string[];
}

/** `WebSocket.OPEN`, spelled out so a test's fake needs no browser global. */
const SOCKET_OPEN = 1;

/** The first redial after a drop waits this long; each further failure doubles it… */
const RECONNECT_FIRST_MS = 500;
/** …up to this. Voice redials more eagerly than the Account socket: a Round is minutes, not hours. */
const RECONNECT_MAX_MS = 8_000;

const CLOSED: VoiceSocketState = { status: "closed", accountId: null, peers: [], speaking: [] };

let state: VoiceSocketState = CLOSED;
const stateListeners = new Set<() => void>();

/** The socket, once the relay said `ready` — the only one a frame is ever sent on. */
let live: VoiceSocketLike | null = null;
/** The sequence stamped on the next frame sent, wrapping at 16 bits like the header. */
let sequence = 0;
/** Stops the running socket — at most one per page. */
let stopCurrent: (() => void) | null = null;

// --- Who is speaking --------------------------------------------------------
// Two sources that must not overwrite each other: other people's frames
// arriving, and this Player's own talk button. So they are kept apart and
// composed, rather than both writing one list.

/** When each other speaker's last frame arrived. */
const heardAt = new Map<string, number>();
/** Whether this Player is talking right now — their own cue, which no frame decides. */
let selfSpeaking = false;

const setState = (next: VoiceSocketState): void => {
  state = next;
  for (const listener of [...stateListeners]) listener();
};

/** The two sources, as one list — your own last, so a row's own bean is not reordered by who else talks. */
const publishSpeaking = (): boolean => {
  const heard = [...heardAt.keys()];
  const own = selfSpeaking && state.accountId !== null && !heard.includes(state.accountId) ? [state.accountId] : [];
  const speaking = [...heard, ...own];
  if (speaking.length === state.speaking.length && speaking.every((id, i) => id === state.speaking[i])) return false;
  setState({ ...state, speaking });
  return true;
};

/**
 * The relay's address: the API's own base at {@link VOICE_SOCKET_PATH} —
 * `ws://host:8081/voice` locally, where the API's upgrade handler carries it
 * to the worker's port, and `wss://host/api/voice` online, where nginx hands
 * it to the worker directly (ADR 0108/0111). The base may be a bare path, so
 * it is read against the page.
 */
export const voiceSocketUrl = (base: string = apiBaseUrl(), page: string = location.href): string => {
  const url = new URL(`${base}${VOICE_SOCKET_PATH}`, page);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
};

/**
 * Opens the voice socket and keeps it open — redialing after a drop — until
 * the returned stop. Opening a second one stops the first: a page has one
 * voice socket, as it has one Account socket.
 */
export const startVoiceSocket = (options: VoiceSocketOptions): (() => void) => {
  stopCurrent?.();
  const createSocket = options.createSocket ?? ((url: string) => new WebSocket(url) as unknown as VoiceSocketLike);
  const url = options.url ?? voiceSocketUrl();
  const getToken = options.getToken ?? getStoredToken;
  const now = options.now ?? Date.now;

  let socket: VoiceSocketLike | null = null;
  let stops: (() => void)[] = [];
  let redial: ReturnType<typeof setTimeout> | null = null;
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;
  let ended = false;

  const announce = (): void => options.changed?.();

  /** Whom `voiceId` belongs to, off the roster the relay last sent. */
  const speakerOf = (voiceId: number): string | null =>
    state.peers.find((peer) => peer.voiceId === voiceId)?.accountId ?? null;

  /** Everyone this client should stop drawing and playing as a speaker. */
  const fellSilent = (accountIds: readonly string[]): void => {
    if (accountIds.length === 0) return;
    for (const accountId of accountIds) options.silent?.(accountId);
  };

  /**
   * Drops everyone whose hold has run out, and books the next sweep for the
   * soonest survivor's — one timer for the whole room rather than one per
   * speaker.
   */
  const sweepSpeaking = (): void => {
    holdTimer = null;
    const at = now();
    let soonest = Infinity;
    const gone: string[] = [];
    for (const [accountId, frameAt] of heardAt) {
      const left = VOICE_SPEAKING_HOLD_MS - (at - frameAt);
      if (left <= 0) {
        heardAt.delete(accountId);
        gone.push(accountId);
      } else soonest = Math.min(soonest, left);
    }
    if (publishSpeaking()) announce();
    fellSilent(gone);
    if (soonest !== Infinity && !ended) holdTimer = setTimeout(sweepSpeaking, soonest);
  };

  /** This Account made a sound — their cue starts now and holds past their last frame. */
  const heard = (accountId: string): void => {
    heardAt.set(accountId, now());
    if (publishSpeaking()) announce();
    if (holdTimer === null) holdTimer = setTimeout(sweepSpeaking, VOICE_SPEAKING_HOLD_MS);
  };

  const release = (): void => {
    for (const stop of stops) stop();
    stops = [];
    socket = null;
    live = null;
    if (holdTimer !== null) clearTimeout(holdTimer);
    holdTimer = null;
    const wasHeard = [...heardAt.keys()];
    heardAt.clear();
    fellSilent(wasHeard);
  };

  const receive = (raw: unknown): void => {
    // Binary is audio and nothing else; it is the common case, so it is first.
    if (raw instanceof ArrayBuffer) {
      const frame = readVoiceFrame(new Uint8Array(raw));
      if (frame === null) return;
      const accountId = speakerOf(frame.voiceId);
      // A frame from someone not on the roster this client holds: the roster
      // is one message behind. Dropping it loses 20 ms and keeps the cue honest.
      if (accountId === null) return;
      heard(accountId);
      options.frame?.(accountId, frame.sequence, frame.payload);
      return;
    }
    let message: VoiceServerMessage;
    try {
      message = JSON.parse(String(raw)) as VoiceServerMessage;
    } catch {
      return; // not ours to guess at
    }
    switch (message.type) {
      case "ready":
        failures = 0;
        live = socket;
        setState({ ...state, status: "open", accountId: message.accountId });
        publishSpeaking();
        announce();
        return;
      case "peers": {
        setState({ ...state, peers: message.peers });
        // Anyone who left, or whom this client may no longer hear, stops
        // speaking at once rather than at the end of their hold.
        const gone: string[] = [];
        for (const accountId of [...heardAt.keys()]) {
          if (message.peers.some((peer) => peer.accountId === accountId && peer.linked)) continue;
          heardAt.delete(accountId);
          gone.push(accountId);
        }
        publishSpeaking();
        fellSilent(gone);
        announce();
        return;
      }
    }
  };

  const dropped = (code: number, reason: string): void => {
    release();
    if (ended) return;
    // A token the API would not take stays untakeable; a room that is not
    // there yet is a race with the Lobby's own roster, so that one redials.
    if (code === VOICE_SOCKET_UNAUTHORIZED && reason === VOICE_REFUSED_NO_ACCOUNT) {
      setState({ ...CLOSED, status: "unauthorized" });
      announce();
      return;
    }
    // The relay took this seat away on purpose — another tab, another Lobby,
    // or the room dissolved. Redialing would fight it; the session opens a
    // fresh socket when the Player is somewhere with voice again.
    if (code === VOICE_SOCKET_REPLACED) {
      setState(CLOSED);
      announce();
      return;
    }
    setState({ ...CLOSED, status: "connecting" });
    announce();
    const delay = Math.min(RECONNECT_FIRST_MS * 2 ** failures, RECONNECT_MAX_MS);
    failures += 1;
    redial = setTimeout(connect, delay);
  };

  function connect(): void {
    redial = null;
    const token = getToken();
    if (token === null) {
      setState(CLOSED); // signed out underneath us — nothing to say who we are
      announce();
      return;
    }
    setState({ ...CLOSED, status: "connecting" });
    let next: VoiceSocketLike;
    try {
      next = createSocket(url);
    } catch {
      dropped(0, ""); // an address the browser refused outright: back off like any drop
      return;
    }
    socket = next;
    // Frames must arrive as bytes, not as a Blob nobody can read synchronously.
    next.binaryType = "arraybuffer";
    stops = [
      listen(next, "open", () =>
        next.send(JSON.stringify({ type: "auth", token, scope: options.getScope() } satisfies VoiceClientMessage)),
      ),
      listen(next, "message", (event) => receive((event as MessageEvent<unknown>).data)),
      listen(next, "close", (event) => dropped((event as CloseEvent).code, (event as CloseEvent).reason)),
      // Without one, a socket error is an unhandled event on some targets.
      listen(next, "error", () => {}),
    ];
  }

  const stop = (): void => {
    if (ended) return;
    ended = true;
    if (redial !== null) clearTimeout(redial);
    const open = socket;
    release(); // listeners off first, so this close is not taken for a drop
    open?.close();
    sequence = 0;
    selfSpeaking = false;
    if (stopCurrent === stop) stopCurrent = null;
    setState(CLOSED);
    announce();
  };

  stopCurrent = stop;
  connect();
  return stop;
};

/**
 * Sends one encoded Opus frame. Quiet when there is no open socket: a Player
 * who talks into a dropped connection loses their audio, not their session.
 */
export const sendVoiceFrame = (payload: Uint8Array): void => {
  if (live === null || live.readyState !== SOCKET_OPEN) return;
  live.send(encodeVoiceFrame(sequence, payload));
  sequence = (sequence + 1) & 0xffff;
};

/**
 * Your own cue, while you hold talk or the gate is open — separate from a
 * frame, so it starts before the first one is encoded and ends the moment you
 * let go rather than a hold later.
 */
export const setSelfSpeaking = (speaking: boolean): void => {
  if (selfSpeaking === speaking) return;
  selfSpeaking = speaking;
  publishSpeaking();
};

/** Tells the relay this device's new scope, without reconnecting. Quiet when the socket is not open. */
export const sendVoiceScope = (scope: VoiceScope): void => {
  if (live === null || live.readyState !== SOCKET_OPEN) return;
  live.send(JSON.stringify({ type: "scope", scope } satisfies VoiceClientMessage));
};

export const subscribeVoiceSocket = (listener: () => void): (() => void) => {
  stateListeners.add(listener);
  return () => {
    stateListeners.delete(listener);
  };
};

/** The current state — a stable reference until the next change, so `useSyncExternalStore` never re-renders for nothing. */
export const getVoiceSocketSnapshot = (): VoiceSocketState => state;
