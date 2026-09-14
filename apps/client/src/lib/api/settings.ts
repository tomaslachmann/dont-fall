import { apiGet } from "./base.js";

/**
 * The client's half of `GET /game-settings` — the live values the Screens
 * used to hardcode or mock (lobby size, beans online). Fetched, never
 * guessed: the server owns both numbers, this module only reads them.
 */
export interface GameSettings {
  /** Per-Lobby seat cap — the same value every Match server boots with. */
  maxPlayers: number;
  /** Every Player seated in any live Lobby, public or private. */
  onlinePlayers: number;
}

export const getGameSettings = (): Promise<GameSettings> => apiGet<GameSettings>("/game-settings");

/** `3244` → `"3 244"` — the design's own thousands grouping, plain spaces, no locale surprises. */
export const formatBeansOnline = (n: number): string =>
  String(Math.max(0, Math.floor(n))).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
