/**
 * Where this client is, for its Account socket (ADR 0112): `lobby` on the
 * Lobby Screen while its phase is LOBBY, `match` from LOADING until the Player
 * leaves Rewards (a podium is not the menus), `menu` everywhere else. What the
 * host's WAITING FOR and the host-left rule read.
 *
 * One owner sends it — `usePlaceReporting`, mounted once by `<AuthGate>` —
 * off two things only it combines: the route, and the Lobby the `/lobby`
 * route is on, which that route publishes here (`useLobbyPresence`) because
 * only it holds the Lobby's socket and phase.
 */
import { useEffect, useSyncExternalStore } from "react";
import { useLocation } from "react-router";
import type { MatchPhase, PartyPlace } from "@dont-fall/shared";
import { getGameActiveSnapshot, subscribeGameActive } from "../gamePresence.js";
import { sendPlace } from "./accountSocket.js";

/** The Lobby the `/lobby` route is on: its port, and its phase — `null` while its socket still connects. */
export interface LobbyPresence {
  port: number;
  phase: MatchPhase | null;
}

let lobbyPresence: LobbyPresence | null = null;
const listeners = new Set<() => void>();

const setLobbyPresence = (next: LobbyPresence | null): void => {
  if (next?.port === lobbyPresence?.port && next?.phase === lobbyPresence?.phase) return;
  lobbyPresence = next;
  for (const listener of [...listeners]) listener();
};

const subscribeLobbyPresence = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getLobbyPresence = (): LobbyPresence | null => lobbyPresence;

/**
 * The `/lobby` route says which Lobby it is on, and in what phase. Updated in
 * place as the phase moves and cleared only on leaving the route — never
 * cleared and re-set in between, which would report a passing `menu` and read
 * to the API as the Party host walking out of its Lobby.
 */
export const useLobbyPresence = (port: number, phase: MatchPhase | null): void => {
  useEffect(() => setLobbyPresence({ port, phase }), [port, phase]);
  useEffect(() => () => setLobbyPresence(null), []);
};

/**
 * The results pages a finished Match navigates through (ADR 0059): the
 * podium, its full table, and Rewards. Only the game navigates into them, so
 * being on one means a Match just ended here.
 */
const AFTERMATH = /^\/(match\/[^/]+|scoreboard|rewards)\/?$/;

/**
 * Where a client is, from its route, the Lobby it is in, and whether a game
 * owns the screen (a Playtest's game has no Lobby). Pure, so the rule is
 * tested without a router or a socket.
 */
export const placeFor = (
  pathname: string,
  lobby: LobbyPresence | null,
  gameActive: boolean,
): { place: PartyPlace; lobbyPort?: number } => {
  if (lobby !== null) {
    return { place: lobby.phase === null || lobby.phase === "LOBBY" ? "lobby" : "match", lobbyPort: lobby.port };
  }
  if (gameActive || AFTERMATH.test(pathname)) return { place: "match" };
  return { place: "menu" };
};

/**
 * Whether Voice chat belongs where this client is (ADR 0111): from joining a
 * Lobby, through every Round and every Standings, until the Player leaves the
 * MatchOver podium.
 *
 * Deliberately not `place !== "menu"`, which a Playtest and free-roam
 * practice also satisfy — a game running with no Lobby behind it has nobody
 * to talk to, and the ADR gives neither of them voice. So the question is
 * whether there is a Lobby, or whether one just ended here.
 */
export const voiceBelongsHere = (pathname: string, lobby: LobbyPresence | null): boolean =>
  lobby !== null || AFTERMATH.test(pathname);

/** Tells the Account socket where this client is, whenever that changes. Mounted once, by `<AuthGate>`. */
export const usePlaceReporting = (): void => {
  const { pathname } = useLocation();
  const lobby = useSyncExternalStore(subscribeLobbyPresence, getLobbyPresence, getLobbyPresence);
  const gameActive = useSyncExternalStore(subscribeGameActive, getGameActiveSnapshot, getGameActiveSnapshot);
  const { place, lobbyPort } = placeFor(pathname, lobby, gameActive);
  useEffect(() => sendPlace(place, lobbyPort), [place, lobbyPort]);
};

/** Whether Voice chat belongs here, live — what `<AuthGate>` keeps the voice session running from. */
export const useVoiceBelongsHere = (): boolean => {
  const { pathname } = useLocation();
  const lobby = useSyncExternalStore(subscribeLobbyPresence, getLobbyPresence, getLobbyPresence);
  return voiceBelongsHere(pathname, lobby);
};
