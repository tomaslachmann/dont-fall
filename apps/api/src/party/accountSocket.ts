import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import {
  ACCOUNT_BEAT_MS,
  ACCOUNT_SOCKET_PATH,
  ACCOUNT_SOCKET_REPLACED,
  ACCOUNT_SOCKET_UNAUTHORIZED,
  PARTY_PLACES,
  type AccountServerMessage,
  type PartyPlace,
} from "@dont-fall/shared";

/** How long a fresh socket may take to send its `auth` before it is closed as unauthorized. */
const AUTH_TIMEOUT_MS = 10_000;

/** The largest frame a client may send — it only ever says `auth` or `place`, so anything bigger is not ours. */
const MAX_CLIENT_FRAME_BYTES = 4 * 1024;

/**
 * How many `place` frames one socket is answered in a window, and how long
 * that window is. A player cannot change where they are several times a
 * second; a client that says so is looping, and every frame answered costs
 * the whole Party a push on the one main thread every Match server also runs
 * on. Beyond the budget the frames are dropped, never the socket — a client
 * bug must not sign anyone out.
 */
const MAX_PLACE_FRAMES_PER_WINDOW = 5;
const PLACE_FRAME_WINDOW_MS = 1_000;

export interface AccountSocketDeps {
  /** The Account a session token signs in as — `undefined` for an unknown or expired one. */
  authenticate: (token: string) => string | undefined;
  /** A socket for this Account is live and `ready` went out — push what a fresh tab needs first. */
  opened: (accountId: string) => void;
  /** This Account's socket closed, and no newer one replaced it. */
  closed: (accountId: string) => void;
  /** Where the client says it is. */
  place: (accountId: string, place: PartyPlace, lobbyPort: number | undefined) => void;
  /** Records the Account's presence beat — on connect, then every `beatMs` while it stays open. */
  beat: (accountId: string) => void;
  /** Test-only; production beats every `ACCOUNT_BEAT_MS`. */
  beatMs?: number;
}

/** Whether an upgrade's URL is the Account socket's — the API's one `upgrade` handler routes on it. */
export const isAccountSocketPath = (url: string | undefined): boolean => {
  try {
    return new URL(url ?? "", "http://api").pathname === ACCOUNT_SOCKET_PATH;
  } catch {
    return false;
  }
};

/**
 * The Account socket (ADR 0112) — the one connection a signed-in client
 * keeps to the API, outside any Lobby: the API's only push channel, and
 * the only writer of presence beats.
 *
 * Signs in by a first `auth` message carrying the session token, as a Lobby
 * socket does, never in the URL. One per Account: a newer one takes over and
 * the older is closed with `ACCOUNT_SOCKET_REPLACED`, as ADR 0090 does for a
 * Lobby seat. The session is proved again on every beat, and a sign-out
 * closes the socket at once, so one never outlives the session that opened
 * it. What arrives on it is untrusted — a malformed frame is dropped, never
 * thrown (ADR 0011's posture).
 */
export class AccountSockets {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_CLIENT_FRAME_BYTES });
  private readonly byAccount = new Map<string, WebSocket>();
  /** Each signed-in socket's session token, re-checked on every beat — a socket must not outlive the session that opened it. */
  private readonly tokens = new WeakMap<WebSocket, string>();
  /** Signed-in sockets that have not answered the last ping — gone by the next beat, they are closed. */
  private readonly unanswered = new WeakSet<WebSocket>();
  private readonly beatTimer: NodeJS.Timeout;
  private closing = false;

  constructor(private readonly deps: AccountSocketDeps) {
    // One cadence for every socket: the beat, and a ping. The ping keeps a
    // quiet socket alive through the proxy in front of the API (ADR 0108's
    // nginx drops a connection that has said nothing for an hour), and one
    // left unanswered finds a connection that died without closing — else
    // its Account would read online, and never drop out of its Party.
    this.beatTimer = setInterval(() => this.beatAll(), deps.beatMs ?? ACCOUNT_BEAT_MS);
    this.wss.on("connection", (socket: WebSocket) => this.accept(socket));
  }

  /** Takes an upgrade `isAccountSocketPath` said is ours. */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    if (this.closing) {
      socket.destroy();
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit("connection", ws, req));
  }

  /** Tells one Account something — `false` when it has no socket open to hear it. */
  send(accountId: string, message: AccountServerMessage): boolean {
    const socket = this.byAccount.get(accountId);
    return socket !== undefined && trySend(socket, message);
  }

  /**
   * This Account signed out: its socket goes now, rather than living on until
   * the next beat's session re-check notices (ADR 0112). Everything the
   * socket carries — presence beats, its seat in a Party, Lobby and Party
   * invites, a `follow` with a Reservation — is for a signed-in Account only.
   */
  signOut(accountId: string): void {
    this.byAccount.get(accountId)?.close(ACCOUNT_SOCKET_UNAUTHORIZED, "signed out");
  }

  /** Closes every socket without telling anyone it went offline — the API is going down, and every Party with it. */
  close(): void {
    this.closing = true;
    clearInterval(this.beatTimer);
    for (const socket of this.wss.clients) socket.terminate();
    this.byAccount.clear();
    this.wss.close();
  }

  private accept(socket: WebSocket): void {
    let accountId: string | null = null;
    let placeWindowStartedAt = 0;
    let placeFramesInWindow = 0;
    const authTimer = setTimeout(() => socket.close(ACCOUNT_SOCKET_UNAUTHORIZED, "sign in first"), AUTH_TIMEOUT_MS);
    // A broken client must never take the API down; its `close` still follows.
    socket.on("error", () => {});
    socket.on("pong", () => this.unanswered.delete(socket));
    socket.on("message", (data: RawData, isBinary: boolean) => {
      try {
        const message = isBinary ? null : parse(data);
        if (accountId === null) {
          const token = message?.type === "auth" && typeof message.token === "string" ? message.token : undefined;
          const resolved = token === undefined ? undefined : this.deps.authenticate(token);
          if (token === undefined || resolved === undefined) {
            socket.close(ACCOUNT_SOCKET_UNAUTHORIZED, "not signed in");
            return;
          }
          clearTimeout(authTimer);
          accountId = resolved;
          this.take(resolved, socket, token);
          return;
        }
        if (message?.type === "place" && isPartyPlace(message.place)) {
          // Only the Account's current socket says where it is: a frame
          // already in flight on one a newer tab took over would otherwise
          // overwrite the new tab's own place (ADR 0112).
          if (this.byAccount.get(accountId) !== socket) return;
          const at = Date.now();
          if (at - placeWindowStartedAt >= PLACE_FRAME_WINDOW_MS) {
            placeWindowStartedAt = at;
            placeFramesInWindow = 0;
          }
          if (++placeFramesInWindow > MAX_PLACE_FRAMES_PER_WINDOW) return;
          this.deps.place(accountId, message.place, isPort(message.lobbyPort) ? message.lobbyPort : undefined);
        }
      } catch (err) {
        console.error("account socket message failed:", err);
      }
    });
    socket.on("close", () => {
      clearTimeout(authTimer);
      if (accountId === null || this.byAccount.get(accountId) !== socket) return;
      this.byAccount.delete(accountId);
      if (!this.closing) this.deps.closed(accountId);
    });
  }

  /** This socket is the Account's now; an older one is closed with a reason its tab shows, and does not count as going offline. */
  private take(accountId: string, socket: WebSocket, token: string): void {
    const older = this.byAccount.get(accountId);
    this.byAccount.set(accountId, socket);
    this.tokens.set(socket, token);
    if (older) older.close(ACCOUNT_SOCKET_REPLACED, "signed in on another tab");
    trySend(socket, { type: "ready", accountId });
    this.deps.beat(accountId);
    this.deps.opened(accountId);
  }

  private beatAll(): void {
    for (const [accountId, socket] of this.byAccount) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      if (this.unanswered.has(socket)) {
        // Its `close` follows, and takes the Account offline.
        socket.terminate();
        continue;
      }
      try {
        // The session is proved again here, where this sweep already touches
        // the database for the beat. `auth` checks it once, so without this a
        // socket outlives its own sign-out: still beating a signed-out
        // Account online, still holding its seat in a Party, still taking
        // pushes meant for whoever holds that session — a Lobby invite
        // carrying a private join code, a `follow` carrying a Reservation.
        const token = this.tokens.get(socket);
        if (token === undefined || this.deps.authenticate(token) !== accountId) {
          socket.close(ACCOUNT_SOCKET_UNAUTHORIZED, "signed out");
          continue;
        }
        this.deps.beat(accountId);
        this.unanswered.add(socket);
        socket.ping();
      } catch (err) {
        console.error("account socket beat failed:", err);
      }
    }
  }
}

const trySend = (socket: WebSocket, message: AccountServerMessage): boolean => {
  if (socket.readyState !== WebSocket.OPEN) return false;
  try {
    socket.send(JSON.stringify(message));
    return true;
  } catch {
    return false;
  }
};

/** One client frame as a loose record — `null` for anything that is not a JSON object. */
const parse = (data: RawData): Record<string, unknown> | null => {
  try {
    const text = Buffer.isBuffer(data)
      ? data.toString("utf8")
      : Array.isArray(data)
        ? Buffer.concat(data).toString("utf8")
        : Buffer.from(data).toString("utf8");
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

const isPartyPlace = (value: unknown): value is PartyPlace => PARTY_PLACES.includes(value as PartyPlace);

const isPort = (value: unknown): value is number => Number.isInteger(value) && (value as number) > 0 && (value as number) <= 65535;
