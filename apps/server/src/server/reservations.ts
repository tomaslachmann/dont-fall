import { performance } from "node:perf_hooks";
import { randomBearerToken } from "@dont-fall/shared";

/**
 * The seats this Lobby is keeping for Accounts the broker has sent here (ADR
 * 0112): a Reservation per Account, named by a one-use token its client
 * connects with (`?reservation=<token>`).
 *
 * Only the bookkeeping. Whether there is room to grant one, and what a live
 * one blocks, are the Lobby's rules (`MatchRuntime.reserveSeats` and
 * `startBlockedReason`) — this answers how many are live, whose token is
 * whose and what place in line each one kept, on a clock a test can drive.
 *
 * Expiry is read, not scheduled: a Reservation past its time stops counting
 * the instant it expires, whether or not the tick loop has swept it yet, so a
 * `start` or a connection landing between two Ticks never sees a seat held
 * by somebody who is not coming.
 */
interface Reservation {
  accountId: string;
  /** On {@link Reservations}' own clock. */
  expiresAt: number;
  /**
   * The place in line this seat was kept at — the `joinOrder` whichever
   * connection spends this token takes, instead of the next one free when it
   * happens to arrive (review finding, 2026-09-19). See {@link grant}.
   */
  joinOrder: number;
}

/**
 * What a {@link Reservations.grant} did: the token each Account's client
 * connects with, and how many places in line the grant claimed from the base
 * it was handed — the caller advances its own counter by exactly that.
 */
export interface SeatGrant {
  tokens: Record<string, string>;
  joinOrdersTaken: number;
}

export class Reservations {
  private readonly byToken = new Map<string, Reservation>();

  /**
   * `now` is the server's monotonic clock by default — the timeline the tick
   * scheduler runs on (ADR 0109) — so a wall-clock jump can neither expire a
   * Reservation early nor keep one alive.
   */
  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** Seats held for Accounts that have not arrived yet, each one taken as far as capacity is concerned. */
  liveCount(): number {
    const now = this.now();
    let live = 0;
    for (const reservation of this.byToken.values()) if (reservation.expiresAt > now) live += 1;
    return live;
  }

  /**
   * How many seats granting `accountIds` would add. An Account already
   * holding a live Reservation here trades it in rather than taking a second
   * seat — see {@link grant}.
   */
  seatsNeededFor(accountIds: readonly string[]): number {
    const now = this.now();
    const holding = new Set<string>();
    for (const reservation of this.byToken.values()) {
      if (reservation.expiresAt > now) holding.add(reservation.accountId);
    }
    return accountIds.filter((accountId) => !holding.has(accountId)).length;
  }

  /**
   * A Reservation for each of `accountIds`, returned as its token by Account.
   * Checks nothing: the caller has already decided there is room.
   *
   * **A seat keeps a place in line, not just a place in the count** (review
   * finding, 2026-09-19). Each newly reserved seat takes one join order from
   * `baseJoinOrder`, in the order the Accounts arrive here — and they arrive
   * caller-first (`LobbiesService.plan` builds `[callerId, ...bringing]`), so
   * the Party host who pressed the button holds the lowest of its Party's
   * block and stays the Lobby's host (`resolveHostId`) however the members'
   * sockets race each other in. Before this, the API pushed `follow` to every
   * member before answering the caller, so a member's socket could reach this
   * server first and take the Lobby — Track pick, Round type and Start with
   * it (ADR 0112).
   *
   * One Reservation per Account (ADR 0090's one seat per Account, a step
   * earlier): an Account already holding a live one is handed that same one
   * straight back — same token, same deadline, same place in line. **A
   * re-grant must never extend the hold** (review finding, 2026-09-19): a
   * signed-in client that never connects could otherwise re-ask every few
   * seconds and keep this Lobby's start blocked for as long as it liked,
   * since a live Reservation is a bean the Lobby waits for
   * (`startBlockedReason`). An Account whose Reservation has already lapsed
   * is a fresh arrival: a fresh deadline, and a fresh place in line.
   */
  grant(accountIds: readonly string[], baseJoinOrder: number): SeatGrant {
    const now = this.now();
    const wanted = new Set(accountIds);
    const held = new Map<string, string>();
    for (const [token, reservation] of this.byToken) {
      if (!wanted.has(reservation.accountId)) continue;
      // A lapsed one is not traded in, it is forgotten — one live Reservation
      // per Account, and nothing of a dead one carried into the new one.
      if (reservation.expiresAt > now) held.set(reservation.accountId, token);
      else this.byToken.delete(token);
    }
    const expiresAt = now + this.ttlMs;
    const tokens: Record<string, string> = {};
    let joinOrder = baseJoinOrder;
    for (const accountId of accountIds) {
      const alreadyHeld = held.get(accountId);
      if (alreadyHeld !== undefined) {
        tokens[accountId] = alreadyHeld;
        continue;
      }
      const token = randomBearerToken();
      this.byToken.set(token, { accountId, expiresAt, joinOrder });
      tokens[accountId] = token;
      joinOrder += 1;
    }
    return { tokens, joinOrdersTaken: joinOrder - baseJoinOrder };
  }

  /**
   * Uses up the live Reservation `token` names, answering the place in line it
   * was kept at — the `joinOrder` that connection takes. An unknown, expired
   * or already used token is `null`, and that connection is an ordinary one
   * taking the next join order free when it arrives.
   */
  use(token: string): number | null {
    const reservation = this.byToken.get(token);
    if (reservation === undefined) return null;
    this.byToken.delete(token);
    return reservation.expiresAt > this.now() ? reservation.joinOrder : null;
  }

  /** Forgets every expired Reservation. True when any went — the Lobby's start may just have been freed. */
  dropExpired(): boolean {
    const now = this.now();
    let dropped = false;
    for (const [token, reservation] of this.byToken) {
      if (reservation.expiresAt > now) continue;
      this.byToken.delete(token);
      dropped = true;
    }
    return dropped;
  }
}
