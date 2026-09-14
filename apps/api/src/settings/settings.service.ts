/**
 * The game-settings payload (`GET /game-settings`) — the handful of live
 * values the Screens used to hardcode or mock (lobby size, beans online),
 * read from the services that own them. Deliberately a flat object that
 * grows a field at a time: this is the registry that gradually expands,
 * and every addition stays one typed field, not a second endpoint.
 *
 * Nothing here is persisted — `maxPlayers` is config, `onlinePlayers` is
 * the lobbies service's own in-memory count — so there is no DAO layer.
 * That absence is the point, not a gap: a DAO would invent storage this
 * endpoint promised never to have.
 */
export interface GameSettings {
  /** Per-Lobby seat cap — the same value every Match server boots with. */
  maxPlayers: number;
  /** Every Player seated in any live Lobby, public or private. */
  onlinePlayers: number;
}

export interface SettingsDeps {
  maxPlayers: number;
  /** Live count, owned by whoever tracks presence (the lobbies service today). */
  countOnlinePlayers: () => Promise<number>;
}

export const getGameSettings = async (deps: SettingsDeps): Promise<GameSettings> => ({
  maxPlayers: deps.maxPlayers,
  onlinePlayers: await deps.countOnlinePlayers(),
});
