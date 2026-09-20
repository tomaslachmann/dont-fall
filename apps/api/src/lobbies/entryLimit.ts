import { ServiceError } from "../http/errors.js";

/**
 * How many times one caller may ask to enter a Lobby, and over what window.
 *
 * Entering is a deliberate click, so five in ten seconds is out of a real
 * player's reach while leaving room for every honest repeat: a reload, a
 * crash, a refusal the player answers by clicking again. This is not a
 * throughput limit but a loop stop — a signed-in entry reserves a seat per
 * Party member (ADR 0112), a Lobby with a live Reservation cannot start, and
 * a client that re-asks every few seconds and never arrives would hold a
 * host's Start for most of every `SEAT_RESERVATION_TTL_MS`.
 */
const ENTRIES_PER_WINDOW = 5;
const ENTRY_WINDOW_MS = 10_000;

/**
 * How long a caller's spent window is remembered. It must not grow with every
 * Account that ever entered a Lobby, so older ones are swept on the next call
 * that comes in — there is no timer to own, and nothing to close.
 */
const ENTRY_MEMORY_MS = 60_000;

interface Spent {
  startedAt: number;
  asks: number;
}

/**
 * The rate limit on the broker's entry routes (`POST /lobbies`,
 * `/lobbies/join`, `/lobbies/quick-match`): per Account, and per connection
 * for a caller with no session, which has no other identity — and reserves
 * nothing either way, since only a signed-in entry takes seats.
 *
 * Framework-free like the mechanisms around it: the controller hands it who
 * is asking and where from, and it throws the 429 that caller reads.
 */
export class LobbyEntryLimit {
  private readonly byAccount = new Map<string, Spent>();
  /** Keyed by the connection itself, so what it remembers goes when the socket does — nothing to sweep. */
  private readonly byConnection = new WeakMap<object, Spent>();
  private sweptAt = 0;

  /** The clock is the caller's in tests; production has none to pass. */
  constructor(private readonly now: () => number = Date.now) {}

  /** Counts one ask from this caller, and throws 429 once it has spent its window. */
  take(accountId: string | null, connection: object): void {
    const at = this.now();
    this.sweep(at);
    const spent = accountId === null ? this.byConnection.get(connection) : this.byAccount.get(accountId);
    if (spent === undefined || at - spent.startedAt >= ENTRY_WINDOW_MS) {
      const fresh: Spent = { startedAt: at, asks: 1 };
      if (accountId === null) this.byConnection.set(connection, fresh);
      else this.byAccount.set(accountId, fresh);
      return;
    }
    // A refused ask counts too: one that did not would hand a looping client
    // a fresh window every time it was turned away.
    spent.asks += 1;
    if (spent.asks > ENTRIES_PER_WINDOW) {
      throw new ServiceError(429, "too many Lobby entries at once — wait a moment and try again");
    }
  }

  /** How many Accounts it is still holding a window for — what the sweep's own test reads. */
  remembering(): number {
    return this.byAccount.size;
  }

  private sweep(at: number): void {
    if (at - this.sweptAt < ENTRY_MEMORY_MS) return;
    this.sweptAt = at;
    for (const [accountId, spent] of this.byAccount) {
      if (at - spent.startedAt >= ENTRY_MEMORY_MS) this.byAccount.delete(accountId);
    }
  }
}
