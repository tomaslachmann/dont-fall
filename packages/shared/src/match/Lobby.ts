/**
 * A connected Player as the Lobby sees them (M4 ticket 07, ADR 0040): a
 * nickname, whether they've marked themselves Ready, and the join order that
 * decides who the host is. The server is the only thing that ever writes
 * this; a client only ever renders what rides the snapshot.
 */
export interface LobbyPlayer {
  id: string;
  nickname: string;
  ready: boolean;
  /** Monotonic connection order — the same counter that already picks each joiner's spawn slot. */
  joinOrder: number;
}

/**
 * Whether every currently connected Player has marked themselves Ready — the
 * start gate the server enforces (M4 ticket 07), not whichever client
 * happens to click.
 *
 * An empty Lobby is deliberately `false`, the same reasoning as
 * `allQualified`: nobody being Ready is not everybody being Ready, and an
 * empty server has no Round to start.
 */
export const allReady = (players: LobbyPlayer[]): boolean => players.length > 0 && players.every((p) => p.ready);

/**
 * The host: the first joiner still connected (CONTEXT.md "Lobby", ADR 0040).
 * Recomputed from who is here now rather than stored and handed off — the
 * moment the original host leaves, whoever has been here longest of the
 * rest becomes host on the very next read, with no separate reassignment
 * step to get wrong.
 *
 * `undefined` with nobody connected — there is no host of an empty Lobby.
 */
export const resolveHostId = (players: LobbyPlayer[]): string | undefined => {
  let earliest: LobbyPlayer | undefined;
  for (const player of players) {
    if (earliest === undefined || player.joinOrder < earliest.joinOrder) earliest = player;
  }
  return earliest?.id;
};
