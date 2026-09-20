import { M1_TRACK, SEAT_RESERVATION_TTL_MS, initPhysics } from "@dont-fall/shared";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { handleLobbyMessage } from "./lobby.js";
import { MatchRuntime, type MatchConfig, type SeatReservation } from "./matchRuntime.js";
import type { FetchedTrack } from "../track/trackSource.js";

beforeAll(async () => {
  await initPhysics();
});

const fetched: FetchedTrack = { id: "test-track", revision: 1, track: M1_TRACK, timeLimitMs: 60_000, survivorTarget: 1 };

const config: MatchConfig = {
  matchId: "reservation-match",
  trackServiceUrl: "http://unused",
  trackFetchRetryOptions: {},
  countdownMs: 0,
  roundEndMs: 0,
  standingsReadyTimeoutMs: 0,
  playersToStart: 1,
  maxPlayers: 4,
  reservationTtlMs: SEAT_RESERVATION_TTL_MS,
  // One Round: a `start` here draws nothing from the (absent) API.
  matchLengthOverride: 1,
};

let rt: MatchRuntime | undefined;

afterEach(() => {
  rt?.simulation.dispose();
  rt = undefined;
});

/** A runtime with `ids` connected and Ready, the first of them the host. */
const lobbyWith = (...ids: string[]): MatchRuntime => {
  const runtime = new MatchRuntime(config, fetched);
  ids.forEach((id, joinOrder) => {
    runtime.sockets.set(id, {} as never);
    runtime.lobbyPlayers.set(id, { id, nickname: id, ready: true, joinOrder, accountId: null, color: null, skin: null, hat: null });
  });
  // As a real registration leaves it: the next place in line is past everyone
  // already seated, so a Reservation's block starts above them.
  runtime.joinCount = ids.length;
  rt = runtime;
  return runtime;
};

const granted = (outcome: SeatReservation): Record<string, string> => {
  if (!("granted" in outcome)) throw new Error(`refused: ${outcome.refused}`);
  return outcome.granted;
};

describe("MatchRuntime.reserveSeats (ADR 0112)", () => {
  it("grants a seat to every Account when the connections and the seats already kept leave room", () => {
    const runtime = lobbyWith("host");
    granted(runtime.reserveSeats(["a"]));

    const tokens = granted(runtime.reserveSeats(["b", "c"]));

    expect(Object.keys(tokens).sort()).toEqual(["b", "c"]);
    expect(runtime.reservations.liveCount()).toBe(3);
  });

  it("grants none when there is no room for all of them — a Party is never split", () => {
    const runtime = lobbyWith("host", "stranger");
    granted(runtime.reserveSeats(["a"]));

    const outcome = runtime.reserveSeats(["b", "c"]);

    expect(outcome).toEqual({ refused: expect.stringMatching(/no room for 2/) });
    expect(runtime.reservations.liveCount()).toBe(1);
  });

  it("refuses once the Lobby's Match has left LOBBY", () => {
    const runtime = lobbyWith("host");
    runtime.match = { phase: "LOADING", phaseStartTick: 0 };

    expect(runtime.reserveSeats(["a"])).toEqual({ refused: expect.any(String) });
    expect(runtime.reservations.liveCount()).toBe(0);
  });

  it("refuses once a start is queued, though the phase still reads LOBBY until the next Tick", () => {
    const runtime = lobbyWith("host");
    handleLobbyMessage(runtime, "host", { type: "start" });
    expect(runtime.startRequested).toBe(true);
    expect(runtime.match.phase).toBe("LOBBY");

    expect(runtime.reserveSeats(["a"])).toEqual({ refused: expect.any(String) });
    expect(runtime.reservations.liveCount()).toBe(0);
  });

  it("marks the snapshot dirty on a grant, so an idle Lobby pushes the new reason", () => {
    const runtime = lobbyWith("host");
    runtime.snapshotDirty = false;

    granted(runtime.reserveSeats(["a"]));

    expect(runtime.snapshotDirty).toBe(true);
  });
});

describe("a Lobby with beans still arriving cannot start (ADR 0112)", () => {
  it("names how many are arriving, the same reason the host's Start shows", () => {
    const runtime = lobbyWith("host");
    expect(runtime.startBlockedReason()).toBeUndefined();

    granted(runtime.reserveSeats(["a"]));
    expect(runtime.startBlockedReason()).toBe("Waiting for 1 bean to arrive.");

    granted(runtime.reserveSeats(["b"]));
    expect(runtime.startBlockedReason()).toBe("Waiting for 2 beans to arrive.");
  });

  it("refuses the host's start while one is live, and takes it once the bean has arrived", () => {
    const runtime = lobbyWith("host");
    const { a } = granted(runtime.reserveSeats(["a"]));

    handleLobbyMessage(runtime, "host", { type: "start" });
    expect(runtime.startRequested).toBe(false);

    // The bean's connection uses its Reservation up (`ensureCapacity`).
    expect(runtime.reservations.use(a!)).not.toBeNull();
    handleLobbyMessage(runtime, "host", { type: "start" });
    expect(runtime.startRequested).toBe(true);
  });

  it("keeps the Track's own reason first — that one is the host's to fix", () => {
    const runtime = lobbyWith("host");
    runtime.setRoundType("race");
    runtime.trackHasFinishZone = false;
    granted(runtime.reserveSeats(["a"]));

    expect(runtime.startBlockedReason()).toMatch(/no Finish Zone/);
  });
});

// Review finding, 2026-09-19: the Lobby's host is the lowest `joinOrder`, and
// arrival order used to decide it — so a Party host could land in a Lobby its
// own member was already hosting. A grant claims the places instead.
describe("a reserved seat keeps its place in line (ADR 0112)", () => {
  it("claims a block of the Lobby's own counter, in the order the broker sends the Accounts", () => {
    const runtime = lobbyWith("host");

    const tokens = granted(runtime.reserveSeats(["amy", "bo"]));

    // One Player is already seated, so the block starts at 1 — and the caller
    // (the Party host, sent first) holds the lower of the two.
    expect(runtime.reservations.use(tokens.amy!)).toBe(1);
    expect(runtime.reservations.use(tokens.bo!)).toBe(2);
    // Nobody connecting after the grant can take either place.
    expect(runtime.joinCount).toBe(3);
  });

  it("hands an Account already holding a seat the same one back, and claims no second place", () => {
    const runtime = lobbyWith("host");
    const first = granted(runtime.reserveSeats(["amy"]));

    const second = granted(runtime.reserveSeats(["amy", "bo"]));

    expect(second.amy).toBe(first.amy);
    expect(runtime.reservations.liveCount()).toBe(2);
    expect(runtime.joinCount).toBe(3);
  });

  it("leaves the place of a Reservation nobody spends unused", () => {
    const runtime = lobbyWith("host");
    granted(runtime.reserveSeats(["amy", "bo"]));

    const later = granted(runtime.reserveSeats(["cy"]));

    expect(runtime.reservations.use(later.cy!)).toBe(3);
  });
});
