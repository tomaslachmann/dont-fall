/**
 * The Account socket (ADR 0112) — the one connection a signed-in client keeps
 * to the API, outside any Lobby. Over it the API tells this client what
 * arrives unasked (its Party, Party invites, Lobby invites, "follow your Party
 * host"), and this client says one thing back: where it is.
 *
 * One module-level owner, the `gamePresence.ts` pattern: whatever Screen is
 * mounted reads the same state, and nothing arrives on a channel a Screen
 * that does not show it could drain — the lost-Lobby-invite bug the per-Screen
 * heartbeat had (ADR 0112's sweep). `<AuthGate>` opens it once signed in
 * (`useAccountSocket`) and closes it on sign-out; everything else only reads.
 *
 * It reconnects after a drop, with a capped backoff, and re-says where it is
 * each time. It does not reconnect after `ACCOUNT_SOCKET_REPLACED` (a newer
 * tab took the Account's socket, as ADR 0090 does for a Lobby seat — two tabs
 * taking it back from each other would never settle) nor after
 * `ACCOUNT_SOCKET_UNAUTHORIZED` (a dead token stays dead).
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import {
  ACCOUNT_SOCKET_PATH,
  ACCOUNT_SOCKET_REPLACED,
  ACCOUNT_SOCKET_UNAUTHORIZED,
  type AccountClientMessage,
  type AccountServerMessage,
  type LobbyInviteView,
  type PartyInviteView,
  type PartyMemberView,
  type PartyPendingView,
  type PartyPlace,
  type PartyView,
} from "@dont-fall/shared";
import { apiBaseUrl, getStoredToken } from "../api/base.js";
import { listen, type ListenerTarget } from "../socket/listeners.js";

/** The slice of a `WebSocket` this module uses — what a test's fake stands in for. */
export interface AccountSocketLike extends ListenerTarget {
  readonly readyState: number;
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
}

export interface AccountSocketOptions {
  /** Opens the socket. Defaults to the browser's `WebSocket`; tests pass a fake. */
  createSocket?: (url: string) => AccountSocketLike;
  /** Where to open it. Defaults to {@link accountSocketUrl}. */
  url?: string;
  /**
   * The session token the first message carries — never the URL (ADR 0112),
   * as a Lobby socket's `auth` does. Read at every (re)connect.
   */
  getToken?: () => string | null;
}

/**
 * `closed` before it opens and after sign-out; `connecting` while it dials,
 * and while it waits to redial after a drop; `open` once the API said `ready`.
 * `replaced` and `unauthorized` are final: it will not dial again.
 */
export type AccountSocketStatus = "closed" | "connecting" | "open" | "replaced" | "unauthorized";

export interface AccountSocketState {
  status: AccountSocketStatus;
  /** Whose socket this is, off the API's `ready` — `null` until then. */
  accountId: string | null;
  /** The Party as the API last pushed it — `null` until it has. */
  party: PartyView | null;
  /** Party invites for this Account not yet answered or gone — as the API last listed them after a `ready`. */
  partyInvites: PartyInviteView[];
  /** Lobby invites pushed this session and not yet dismissed or used. */
  lobbyInvites: LobbyInviteView[];
}

/**
 * What arrives that is an act rather than a state — the shell's alert stack
 * handles each (`<GlobalAlerts>`): `follow` and `left` move the Player,
 * `removed` shows the Party mock's toast, `replaced` says this tab went quiet.
 *
 * `removed` carries the remover as this client last saw them, so the toast
 * can wear their bean — the message itself only names them.
 */
export type AccountSocketEvent =
  | Extract<AccountServerMessage, { type: "follow" }>
  | Extract<AccountServerMessage, { type: "left" }>
  | (Extract<AccountServerMessage, { type: "removed" }> & { by: PartyMemberView | null })
  | { type: "replaced" };

/** `WebSocket.OPEN`, spelled out so a test's fake needs no browser global. */
const SOCKET_OPEN = 1;

/** The first redial after a drop waits this long; each further failure doubles it… */
const RECONNECT_FIRST_MS = 1_000;
/**
 * …up to this. Well inside `PARTY_OFFLINE_GRACE_MS` (90 s): a network blip
 * or an API restart must never cost anyone their Party for want of a redial.
 */
const RECONNECT_MAX_MS = 15_000;

const CLOSED: AccountSocketState = { status: "closed", accountId: null, party: null, partyInvites: [], lobbyInvites: [] };

let state: AccountSocketState = CLOSED;
/** The Party before the last `party` push — where a `removed` finds its remover when the new Party came first. */
let previousParty: PartyView | null = null;
const stateListeners = new Set<() => void>();
const eventListeners = new Set<(event: AccountSocketEvent) => void>();

/** The socket, once the API said `ready` — the only one `place` is ever sent on. */
let live: AccountSocketLike | null = null;
/** Where this client is, as last reported — kept across sockets, so a redial re-says it. */
let wantedPlace: Extract<AccountClientMessage, { type: "place" }> = { type: "place", place: "menu" };
/** What `live` was last told, so an unchanged report is not sent twice. */
let sentPlace: string | null = null;
/** Stops the running socket — at most one per page. */
let stopCurrent: (() => void) | null = null;

const setState = (next: AccountSocketState): void => {
  state = next;
  for (const listener of [...stateListeners]) listener();
};

const emit = (event: AccountSocketEvent): void => {
  for (const listener of [...eventListeners]) listener(event);
};

const flushPlace = (): void => {
  if (live === null || live.readyState !== SOCKET_OPEN) return;
  const json = JSON.stringify(wantedPlace);
  if (json === sentPlace) return;
  live.send(json);
  sentPlace = json;
};

/** The member a `removed` names, in the Party held now or the one before it. */
const memberNamed = (displayName: string): PartyMemberView | null =>
  [state.party, previousParty]
    .flatMap((party) => party?.members ?? [])
    .find((member) => member.displayName === displayName) ?? null;

/**
 * The Account socket's address: the API's own base (ADR 0058) at
 * `ACCOUNT_SOCKET_PATH` — `ws://host:8081/account` locally, and online the
 * same proxy base the Lobby sockets use (`wss://host/api/account`, ADR 0108).
 * The base may be a bare path, so it is read against the page.
 */
export const accountSocketUrl = (base: string = apiBaseUrl(), page: string = location.href): string => {
  const url = new URL(`${base}${ACCOUNT_SOCKET_PATH}`, page);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
};

/**
 * Opens the Account socket and keeps it open — redialing after a drop — until
 * the returned stop, which also forgets everything it held (sign-out). Opening
 * a second one stops the first: a page has one Account socket.
 */
export const startAccountSocket = (options: AccountSocketOptions = {}): (() => void) => {
  stopCurrent?.();
  const createSocket = options.createSocket ?? ((url: string) => new WebSocket(url));
  const url = options.url ?? accountSocketUrl();
  const getToken = options.getToken ?? getStoredToken;

  let socket: AccountSocketLike | null = null;
  let stops: (() => void)[] = [];
  let redial: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;
  let ended = false;

  const release = (): void => {
    for (const stop of stops) stop();
    stops = [];
    socket = null;
    live = null;
  };

  const receive = (raw: unknown): void => {
    let message: AccountServerMessage;
    try {
      message = JSON.parse(String(raw)) as AccountServerMessage;
    } catch {
      return; // not ours to guess at
    }
    switch (message.type) {
      case "ready":
        failures = 0;
        live = socket;
        sentPlace = null; // a fresh socket knows nothing yet — say it again
        // The API sends every live Party invite right after `ready`, but no
        // `partyInviteGone` for one that expired or was cancelled while this
        // socket was down — so what follows replaces the list, never merges
        // into it. Lobby invites stay: only undelivered ones are sent again.
        setState({ ...state, status: "open", accountId: message.accountId, partyInvites: [] });
        flushPlace();
        return;
      case "party":
        previousParty = state.party;
        setState({ ...state, party: message.party });
        return;
      case "partyInvite":
        if (state.partyInvites.some((invite) => invite.id === message.invite.id)) return;
        setState({ ...state, partyInvites: [...state.partyInvites, message.invite] });
        return;
      case "partyInviteGone":
        dismissPartyInvite(message.inviteId);
        return;
      case "lobbyInvite":
        if (state.lobbyInvites.some((invite) => invite.id === message.invite.id)) return;
        setState({ ...state, lobbyInvites: [...state.lobbyInvites, message.invite] });
        return;
      case "follow":
      case "left":
        emit(message);
        return;
      case "removed":
        emit({ ...message, by: memberNamed(message.byDisplayName) });
        return;
    }
  };

  const dropped = (code: number): void => {
    release();
    if (ended) return;
    if (code === ACCOUNT_SOCKET_REPLACED) {
      setState({ ...state, status: "replaced" });
      emit({ type: "replaced" });
      return;
    }
    if (code === ACCOUNT_SOCKET_UNAUTHORIZED) {
      setState({ ...state, status: "unauthorized" });
      return;
    }
    // Everything held stays up while it redials: the API pushes the Party
    // again on connect, and a blip should not flicker the menu's strip.
    setState({ ...state, status: "connecting" });
    const delay = Math.min(RECONNECT_FIRST_MS * 2 ** failures, RECONNECT_MAX_MS);
    failures += 1;
    redial = setTimeout(connect, delay);
  };

  const connect = (): void => {
    redial = null;
    const token = getToken();
    if (token === null) {
      setState({ ...state, status: "closed" }); // signed out underneath us — nothing to say who we are
      return;
    }
    setState({ ...state, status: "connecting" });
    let next: AccountSocketLike;
    try {
      next = createSocket(url);
    } catch {
      dropped(0); // an address the browser refused outright: back off like any drop
      return;
    }
    socket = next;
    stops = [
      listen(next, "open", () => next.send(JSON.stringify({ type: "auth", token } satisfies AccountClientMessage))),
      listen(next, "message", (event) => receive((event as MessageEvent<unknown>).data)),
      listen(next, "close", (event) => dropped((event as CloseEvent).code)),
    ];
  };

  const stop = (): void => {
    if (ended) return;
    ended = true;
    if (redial !== null) clearTimeout(redial);
    const open = socket;
    release(); // listeners off first, so this close is not taken for a drop
    open?.close();
    sentPlace = null;
    previousParty = null;
    if (stopCurrent === stop) stopCurrent = null;
    setState(CLOSED);
  };

  stopCurrent = stop;
  connect();
  return stop;
};

/**
 * Keeps the Account socket open while `accountId` is set — `<AuthGate>` passes
 * the signed-in Account's id, and `null` before sign-in and after sign-out.
 */
export const useAccountSocket = (accountId: string | null): void => {
  useEffect(() => (accountId === null ? undefined : startAccountSocket()), [accountId]);
};

/**
 * Says where this client is (ADR 0112): `menu`, `lobby` (with the Lobby's
 * port) or `match`. An unchanged report is not sent again, and a redial
 * re-sends the latest. One caller: `usePlaceReporting` (`place.ts`).
 */
export const sendPlace = (place: PartyPlace, lobbyPort?: number): void => {
  wantedPlace = lobbyPort === undefined ? { type: "place", place } : { type: "place", place, lobbyPort };
  flushPlace();
};

export const subscribeAccountSocket = (listener: () => void): (() => void) => {
  stateListeners.add(listener);
  return () => {
    stateListeners.delete(listener);
  };
};

/** The current state — a stable reference until the next change, so `useSyncExternalStore` never re-renders for nothing. */
export const getAccountSocketSnapshot = (): AccountSocketState => state;

/** Calls `listener` for every `follow`, `left`, `removed` and `replaced`. Returns the unsubscribe. */
export const onAccountSocketEvent = (listener: (event: AccountSocketEvent) => void): (() => void) => {
  eventListeners.add(listener);
  return () => {
    eventListeners.delete(listener);
  };
};

/** Drops a Party invite from the inbox — answered, declined, or gone on the API's word. */
export const dismissPartyInvite = (id: string): void => {
  if (!state.partyInvites.some((invite) => invite.id === id)) return;
  setState({ ...state, partyInvites: state.partyInvites.filter((invite) => invite.id !== id) });
};

/** Drops a Lobby invite from the inbox — dismissed, or used to JOIN. */
export const dismissLobbyInvite = (id: string): void => {
  if (!state.lobbyInvites.some((invite) => invite.id === id)) return;
  setState({ ...state, lobbyInvites: state.lobbyInvites.filter((invite) => invite.id !== id) });
};

/** The Party as the Screens read it. */
export interface PartyState {
  /** The Party as the API last pushed it — `null` before it has (the socket still dialing). */
  party: PartyView | null;
  /** This Account, off the socket's `ready` — `null` before it. */
  you: string | null;
  /**
   * Whether you move the Party (ADR 0112). True alone, and before the Party
   * has arrived: everyone signed in hosts their own party of one, and a slow
   * socket must not lock anyone out of PLAY — the API decides either way.
   */
  isHost: boolean;
  /** The Party host, or `null` before the Party has arrived. */
  host: PartyMemberView | null;
  /** Seated members, host first then by joining (the API's order), you included. Empty before the Party has arrived. */
  members: PartyMemberView[];
  /** Every seated member but you. */
  others: PartyMemberView[];
  /** Invites the host sent that are still out — each takes a slot. */
  pending: PartyPendingView[];
  /** How many beans the Party seats, you included — 1 before it has arrived. */
  size: number;
  /**
   * The first other member online and not in the menus — whom the host's PLAY
   * reads WAITING FOR (ADR 0112) — or `null` when nobody holds it back.
   *
   * A member whose Account socket has closed is *not* waited for: the API
   * keeps them through `PARTY_OFFLINE_GRACE_MS` with the `place` they last
   * reported, so a bean who closed their tab in a Lobby would otherwise hold
   * PLAY for a minute and a half while the strip already reads OFFLINE. The
   * API holds the same rule; this is the button agreeing with it.
   */
  waitingFor: PartyMemberView | null;
}

/** The Party as the Screens read it, from the socket's state. Pure — what `useParty` memoises. */
export const partyStateOf = ({ party, accountId }: Pick<AccountSocketState, "party" | "accountId">): PartyState => {
  const members = party?.members ?? [];
  const others = members.filter((member) => member.accountId !== accountId);
  return {
    party,
    you: accountId,
    isHost: party === null || party.hostAccountId === accountId,
    host: members.find((member) => member.accountId === party?.hostAccountId) ?? null,
    members,
    others,
    pending: party?.pending ?? [],
    size: Math.max(1, members.length),
    waitingFor: others.find((member) => member.online && member.place !== "menu") ?? null,
  };
};

const useAccountSocketState = (): AccountSocketState =>
  useSyncExternalStore(subscribeAccountSocket, getAccountSocketSnapshot, getAccountSocketSnapshot);

/** Your Party, live off the Account socket (ADR 0112). */
export const useParty = (): PartyState => {
  const { party, accountId } = useAccountSocketState();
  return useMemo(() => partyStateOf({ party, accountId }), [party, accountId]);
};

export interface SocialInbox {
  partyInvites: PartyInviteView[];
  lobbyInvites: LobbyInviteView[];
  dismissPartyInvite: (id: string) => void;
  dismissLobbyInvite: (id: string) => void;
}

/** What arrived for this Account and waits for an answer — the alert stack's toasts. */
export const useSocialInbox = (): SocialInbox => {
  const { partyInvites, lobbyInvites } = useAccountSocketState();
  return { partyInvites, lobbyInvites, dismissPartyInvite, dismissLobbyInvite };
};
