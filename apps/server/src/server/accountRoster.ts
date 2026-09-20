import type { LobbyPlayer } from "@dont-fall/shared";

/**
 * Who is seated here by Account, told to whoever started this server
 * whenever it changes (ADR 0111). The API's voice relay is the one listener:
 * a voice room is the Lobby's own roster, so a Player who left is out of it
 * at once, whatever their client believes.
 *
 * Anonymous seats are not in it — a connection with no Account has nothing to
 * authenticate a voice socket with — and a repeated roster is not reported
 * twice, so the three places that can change one may all just say so.
 */
export class AccountRoster {
  private last: string | null = null;

  constructor(private readonly notify: ((accountIds: readonly string[]) => void) | undefined) {}

  /** Re-reads the roster and reports it if it moved. Cheap enough to call from any seat change. */
  changed(players: Iterable<LobbyPlayer>): void {
    if (this.notify === undefined) return;
    const accountIds = [...players].flatMap((player) => (player.accountId === null ? [] : [player.accountId])).sort();
    const key = accountIds.join(",");
    if (key === this.last) return;
    this.last = key;
    this.notify(accountIds);
  }
}
