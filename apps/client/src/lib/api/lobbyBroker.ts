/**
 * The client half of the lobby broker (ADR 0054) — how a Player gets a Lobby
 * to connect to at all, now that "the Match server" is no longer a single
 * process on a fixed port.
 *
 * Every call here answers the same question: *which port do I open a socket
 * on?* The broker owns the Lobby lifecycle (creating one, finding an open
 * one, resolving a join code); this module only asks, and turns the broker's
 * own `{ error }` payloads into `Error`s carrying that exact text — a full
 * Lobby and a mistyped code both have a readable reason the broker already
 * wrote, and a second opinion invented here would only ever be worse.
 *
 * Every entry is party-aware (ADR 0112): it answers a `LobbyEntryGrant`, with
 * the Reservation the caller connects with, and the Party host's entry takes
 * the whole Party with it (the API pushes each member a `follow`). A member
 * entering alone leaves their Party, which the grant says, and this module
 * flashes — whichever Screen asked.
 */

import type { LobbyBots, LobbyEntryGrant, LobbyPrivacy, LobbyRef } from "@dont-fall/shared";
import { flash } from "../flash.js";
import { apiFetch } from "./base.js";

/**
 * A Lobby the broker has pointed this client at, and the seat it keeps for
 * it. `code` is present only for a private Lobby — the one just created, or
 * the one joined by its code.
 */
export interface BrokeredLobby extends LobbyEntryGrant {
  code?: string;
}

interface LobbyResponse {
  id?: unknown;
  port?: unknown;
  code?: unknown;
  reservation?: unknown;
  leftPartyOf?: unknown;
  error?: unknown;
}

/**
 * One request/response shape for every entry — they differ only in method,
 * path and body. A non-2xx carries the broker's own reason; anything else
 * (broker down, non-JSON body) becomes one generic, still-actionable error
 * rather than a `TypeError` surfacing from `fetch` into a Screen.
 */
const askBroker = async (path: string, init?: RequestInit): Promise<BrokeredLobby> => {
  let res: Response;
  try {
    res = await apiFetch(path, init);
  } catch {
    throw new Error("Could not reach the lobby service. Is it running?");
  }

  let body: LobbyResponse;
  try {
    body = (await res.json()) as LobbyResponse;
  } catch {
    throw new Error(`The lobby service answered with something unreadable (HTTP ${res.status}).`);
  }

  if (!res.ok) {
    throw new Error(typeof body.error === "string" ? body.error : `The lobby service refused that (HTTP ${res.status}).`);
  }
  if (typeof body.id !== "string" || typeof body.port !== "number") {
    throw new Error("The lobby service answered without a Lobby to connect to.");
  }
  // Entering alone took this caller out of a Party (ADR 0112) — the grant is
  // the only moment the client learns it, so it is said here, once, for every
  // way in.
  if (typeof body.leftPartyOf === "string") flash(`You left ${body.leftPartyOf}'s party.`, "info");
  return {
    id: body.id,
    port: body.port,
    ...(typeof body.code === "string" ? { code: body.code } : {}),
    ...(typeof body.reservation === "string" ? { reservation: body.reservation } : {}),
    ...(typeof body.leftPartyOf === "string" ? { leftPartyOf: body.leftPartyOf } : {}),
  };
};

const postBroker = (path: string, body?: unknown): Promise<BrokeredLobby> =>
  askBroker(path, {
    method: "POST",
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });

/**
 * Starts a brand-new Lobby. A private one comes back with the join code to
 * share; a public one is found by quick-match instead. A private one is set up
 * here (ADR 0110): the Match length it starts at, who can find it, and its Bots
 * (M17 ticket 10).
 */
export const createLobby = (
  isPrivate: boolean,
  setup: { matchLength?: number; privacy?: LobbyPrivacy; bots?: LobbyBots } = {},
): Promise<BrokeredLobby> =>
  postBroker("/lobbies", { isPrivate, ...setup });

/**
 * `POST /lobbies/join` — enters a Lobby named by its join code or the
 * broker's id, reserving the caller's seat (ADR 0112: a POST because it
 * reserves). Rejects with the broker's reason when it is unknown, full, has
 * no room for your Party, or already started.
 */
const joinLobby = (target: { code: string } | { lobbyId: string }): Promise<BrokeredLobby> =>
  postBroker("/lobbies/join", target);

/**
 * Enters the private Lobby behind a 6-character join code.
 *
 * The code comes back on the result even though the broker's own answer
 * doesn't repeat it: whoever joined by code is in a private Lobby and has
 * exactly as much right to share it as the host who created it.
 */
export const lobbyByCode = async (code: string): Promise<BrokeredLobby> => {
  const normalized = code.trim().toUpperCase();
  const lobby = await joinLobby({ code: normalized });
  return { ...lobby, code: lobby.code ?? normalized };
};

/** Joins whatever public Lobby is open, or starts one when none is. Either way the answer is a port to connect to. */
export const quickMatch = (): Promise<BrokeredLobby> => postBroker("/lobbies/quick-match");

/**
 * Enters a public Lobby by the broker's id — the JOIN behind a friend's
 * public lobby (M9 ticket 12). Private lobbies are entered by code only,
 * never by id: the broker refuses those here.
 */
export const lobbyById = (id: string): Promise<BrokeredLobby> => joinLobby({ lobbyId: id });

/**
 * Enters a friend's Lobby by its ref: private refs travel by join code,
 * public ones by id. Rejects with the broker's reason when the Lobby filled
 * or started without us.
 */
export const resolveLobbyRef = (ref: LobbyRef): Promise<BrokeredLobby> =>
  ref.kind === "private" ? lobbyByCode(ref.code) : lobbyById(ref.lobbyId);

/**
 * The `/lobby` URL for a brokered Lobby — `?port=` to connect to, `?code=`
 * only when the Lobby actually has a join code to show, and `?reservation=`
 * when the broker kept a seat (ADR 0112), which the Lobby's socket hands its
 * Match server. Every join in the app (quick match, create, by code, friend
 * JOIN, following the Party host) lands through here.
 */
export const lobbyPath = (lobby: Pick<BrokeredLobby, "id" | "port" | "code" | "reservation">): string => {
  const params = new URLSearchParams({ port: String(lobby.port) });
  if (lobby.code !== undefined) params.set("code", lobby.code);
  // The broker's own id — what an invite to a public Lobby names (ADR 0110).
  params.set("id", lobby.id);
  if (lobby.reservation !== undefined) params.set("reservation", lobby.reservation);
  return `/lobby?${params.toString()}`;
};
