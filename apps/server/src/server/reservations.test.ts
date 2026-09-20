import { describe, expect, it } from "vitest";
import { Reservations } from "./reservations.js";

const TTL_MS = 15_000;

/** A clock the test moves by hand. */
const fakeClock = (): { now: () => number; advance: (ms: number) => void } => {
  let nowMs = 1_000;
  return { now: () => nowMs, advance: (ms) => (nowMs += ms) };
};

describe("Reservations (ADR 0112)", () => {
  it("grants one distinct token per Account, each a seat until it is used", () => {
    const reservations = new Reservations(TTL_MS, fakeClock().now);

    const { tokens } = reservations.grant(["a", "b"], 0);

    expect(Object.keys(tokens).sort()).toEqual(["a", "b"]);
    expect(tokens.a).not.toBe(tokens.b);
    expect(tokens.a).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(reservations.liveCount()).toBe(2);
  });

  it("is used up by its token exactly once, and an unknown token uses nothing", () => {
    const reservations = new Reservations(TTL_MS, fakeClock().now);
    const { tokens } = reservations.grant(["a"], 4);

    expect(reservations.use("not-a-token")).toBeNull();
    expect(reservations.liveCount()).toBe(1);

    expect(reservations.use(tokens.a!)).toBe(4);
    expect(reservations.liveCount()).toBe(0);
    expect(reservations.use(tokens.a!)).toBeNull();
  });

  it("stops holding its seat the moment it expires, before anything sweeps it", () => {
    const clock = fakeClock();
    const reservations = new Reservations(TTL_MS, clock.now);
    const { tokens } = reservations.grant(["a"], 0);

    clock.advance(TTL_MS - 1);
    expect(reservations.liveCount()).toBe(1);

    clock.advance(1);
    expect(reservations.liveCount()).toBe(0);
    expect(reservations.use(tokens.a!)).toBeNull();
  });

  it("sweeps expired Reservations and says whether any went", () => {
    const clock = fakeClock();
    const reservations = new Reservations(TTL_MS, clock.now);
    reservations.grant(["a"], 0);
    clock.advance(TTL_MS / 2);
    const { tokens } = reservations.grant(["b"], 1);

    expect(reservations.dropExpired()).toBe(false);
    clock.advance(TTL_MS / 2);
    expect(reservations.dropExpired()).toBe(true);
    expect(reservations.dropExpired()).toBe(false);

    // The later one keeps its own lifetime.
    expect(reservations.liveCount()).toBe(1);
    expect(reservations.use(tokens.b!)).toBe(1);
  });

  it("counts an expired Reservation's Account as needing a seat again", () => {
    const clock = fakeClock();
    const reservations = new Reservations(TTL_MS, clock.now);
    reservations.grant(["a"], 0);

    clock.advance(TTL_MS);

    expect(reservations.seatsNeededFor(["a"])).toBe(1);
  });
});

// The place in line a seat keeps (review finding, 2026-09-19). The broker
// pushes `follow` to every member before it answers the caller, so the
// members' sockets race each other in — and the Lobby's host is the lowest
// `joinOrder` (`resolveHostId`), which used to be whoever won that race.
describe("Reservations keep a place in line, not just a seat (ADR 0112)", () => {
  it("claims a contiguous block from the base, in the order the Accounts arrive", () => {
    const reservations = new Reservations(TTL_MS, fakeClock().now);

    // The broker's own order: the caller first, then everyone it brings
    // (`LobbiesService.plan` → `[callerId, ...bringing]`).
    const { tokens, joinOrdersTaken } = reservations.grant(["amy", "bo", "cy"], 7);

    expect(joinOrdersTaken).toBe(3);
    expect(reservations.use(tokens.amy!)).toBe(7);
    expect(reservations.use(tokens.bo!)).toBe(8);
    expect(reservations.use(tokens.cy!)).toBe(9);
  });

  it("leaves a gap for a Reservation nobody spends, and keeps every other place", () => {
    const reservations = new Reservations(TTL_MS, fakeClock().now);
    const party = reservations.grant(["amy", "bo"], 0);

    // Only Amy arrives; Bo's `1` is simply never taken by anybody.
    expect(reservations.use(party.tokens.amy!)).toBe(0);
    const later = reservations.grant(["cy"], 2);
    expect(later.joinOrdersTaken).toBe(1);
    expect(reservations.use(later.tokens.cy!)).toBe(2);
  });
});

describe("a re-grant never extends an Account's hold (ADR 0112)", () => {
  it("hands back the one it already holds — same token, same place, no second seat", () => {
    const clock = fakeClock();
    const reservations = new Reservations(TTL_MS, clock.now);
    const first = reservations.grant(["a"], 3);
    clock.advance(TTL_MS / 2);

    expect(reservations.seatsNeededFor(["a", "b"])).toBe(1);
    const second = reservations.grant(["a", "b"], 4);

    expect(second.tokens.a).toBe(first.tokens.a);
    expect(second.joinOrdersTaken).toBe(1);
    expect(reservations.liveCount()).toBe(2);
    expect(reservations.use(second.tokens.a!)).toBe(3);
    expect(reservations.use(second.tokens.b!)).toBe(4);
  });

  it("lets the first deadline pass however often the broker re-asks for the same Account", () => {
    const clock = fakeClock();
    const reservations = new Reservations(TTL_MS, clock.now);
    const first = reservations.grant(["a"], 0);

    // A signed-in client that never connects, re-asking through the broker
    // nine times inside one lifetime. Before this, each one moved the deadline
    // on and the Lobby's start stayed blocked for as long as the loop ran.
    for (let i = 1; i < 10; i += 1) {
      clock.advance(TTL_MS / 10);
      const again = reservations.grant(["a"], 100 * i);
      expect(again.tokens.a).toBe(first.tokens.a);
      expect(again.joinOrdersTaken).toBe(0);
      expect(reservations.liveCount()).toBe(1);
    }

    clock.advance(TTL_MS / 10);
    expect(reservations.liveCount()).toBe(0);
  });

  it("treats an Account whose Reservation has lapsed as a fresh arrival", () => {
    const clock = fakeClock();
    const reservations = new Reservations(TTL_MS, clock.now);
    const first = reservations.grant(["a"], 0);

    clock.advance(TTL_MS);
    const second = reservations.grant(["a"], 5);

    expect(second.tokens.a).not.toBe(first.tokens.a);
    expect(second.joinOrdersTaken).toBe(1);
    expect(reservations.liveCount()).toBe(1);
    expect(reservations.use(first.tokens.a!)).toBeNull();
    expect(reservations.use(second.tokens.a!)).toBe(5);
  });
});
