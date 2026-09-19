/**
 * The game-settings payload (`GET /game-settings`) — the handful of live
 * values the Screens used to hardcode or mock (lobby size, beans online),
 * read from the services that own them. Deliberately a flat object that
 * grows a field at a time: this is the registry that gradually expands,
 * and every addition stays one typed field, not a second endpoint.
 *
 * This module stores nothing of its own — `maxPlayers` is config, and
 * `onlinePlayers` is friends presence's count of fresh heartbeats (ADR 0110),
 * handed in as a dependency — so it has no DAO layer of its own.
 */
export interface GameSettings {
  /** Per-Lobby seat cap — the same value every Match server boots with. */
  maxPlayers: number;
  /** Every signed-in Account with a fresh presence heartbeat (ADR 0110) — in a Lobby or not. */
  onlinePlayers: number;
}

export interface SettingsDeps {
  maxPlayers: number;
  /** Live count of signed-in Accounts by presence heartbeat (ADR 0110), owned by friends presence. */
  countOnlinePlayers: () => Promise<number>;
}

export const getGameSettings = async (deps: SettingsDeps): Promise<GameSettings> => ({
  maxPlayers: deps.maxPlayers,
  onlinePlayers: await deps.countOnlinePlayers(),
});
