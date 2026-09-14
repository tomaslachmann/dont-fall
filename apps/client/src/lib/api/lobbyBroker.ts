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
 */

import type { LobbyRef } from "@dont-fall/shared";
import { apiFetch } from "./base.js";

/** A Lobby the broker has pointed this client at. `code` is present only for a freshly-created private Lobby. */
export interface BrokeredLobby {
  id: string;
  port: number;
  code?: string;
}

interface LobbyResponse {
  id?: unknown;
  port?: unknown;
  code?: unknown;
  error?: unknown;
}

/**
 * One request/response shape for all three endpoints — they differ only in
 * method and path. A non-2xx carries the broker's own reason; anything else
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
  return {
    id: body.id,
    port: body.port,
    ...(typeof body.code === "string" ? { code: body.code } : {}),
  };
};

/** Starts a brand-new Lobby. A private one comes back with the join code to share; a public one is found by quick-match instead. */
export const createLobby = (isPrivate: boolean): Promise<BrokeredLobby> =>
  askBroker("/lobbies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isPrivate }),
  });

/**
 * Resolves a 6-character join code to the private Lobby behind it. Rejects
 * with the broker's reason if it's unknown, full, or already started.
 *
 * The code comes back on the result even though the broker's own answer
 * doesn't repeat it: whoever joined by code is in a private Lobby and has
 * exactly as much right to share it as the host who created it.
 */
export const lobbyByCode = async (code: string): Promise<BrokeredLobby> => {
  const normalized = code.trim().toUpperCase();
  const lobby = await askBroker(`/lobbies/code/${encodeURIComponent(normalized)}`);
  return { ...lobby, code: lobby.code ?? normalized };
};

/** Joins whatever public Lobby is open, or starts one when none is. Either way the answer is a port to connect to. */
export const quickMatch = (): Promise<BrokeredLobby> => askBroker("/lobbies/quick-match", { method: "POST" });

/**
 * Resolves a public Lobby id to the Lobby behind it — the JOIN behind a
 * friend's public lobby (M9 ticket 12). Private lobbies resolve by code
 * only, never by id: the broker 404s those here.
 */
export const lobbyById = (id: string): Promise<BrokeredLobby> =>
  askBroker(`/lobbies/${encodeURIComponent(id)}`);

/**
 * Resolves a friend's Lobby ref to a port to connect to: private refs travel
 * by join code, public ones by id. Rejects with the broker's reason when the
 * Lobby filled or started without us.
 */
export const resolveLobbyRef = (ref: LobbyRef): Promise<BrokeredLobby> =>
  ref.kind === "private" ? lobbyByCode(ref.code) : lobbyById(ref.lobbyId);

/**
 * The `/lobby` URL for a brokered Lobby — `?port=` to connect to, `?code=`
 * only when the Lobby actually has a join code to show. Every join in the
 * app (quick match, create, by code, friend JOIN) lands through here.
 */
export const lobbyPath = (lobby: BrokeredLobby): string => {
  const params = new URLSearchParams({ port: String(lobby.port) });
  if (lobby.code !== undefined) params.set("code", lobby.code);
  return `/lobby?${params.toString()}`;
};
