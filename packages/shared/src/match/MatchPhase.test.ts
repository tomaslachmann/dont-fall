import { describe, expect, it } from "vitest";
import { COUNTDOWN_TICKS, PLAYERS_TO_START, TICK_RATE_HZ } from "../tuning.js";
import { advanceMatchPhase, countdownMsLeft, phaseLocksInput, type MatchState } from "./MatchPhase.js";

const at = (phase: MatchState["phase"], phaseStartTick = 0): MatchState => ({ phase, phaseStartTick });
const step = (state: MatchState, tick: number, connectedPlayers: number, playersToStart = PLAYERS_TO_START) =>
  advanceMatchPhase(state, { tick, connectedPlayers, playersToStart });

describe("phaseLocksInput", () => {
  it("locks every phase but RUNNING — a Round is the only time a Character is yours to drive", () => {
    expect(phaseLocksInput("LOBBY")).toBe(true);
    expect(phaseLocksInput("COUNTDOWN")).toBe(true);
    expect(phaseLocksInput("RUNNING")).toBe(false);
    expect(phaseLocksInput("ROUND_END")).toBe(true);
    expect(phaseLocksInput("RESULTS")).toBe(true);
  });
});

describe("advanceMatchPhase", () => {
  it("waits in LOBBY until enough Players are connected", () => {
    expect(step(at("LOBBY"), 100, 0).phase).toBe("LOBBY");
    expect(step(at("LOBBY"), 100, PLAYERS_TO_START - 1).phase).toBe("LOBBY");
  });

  it("starts the Countdown the Tick the last needed Player arrives", () => {
    const next = step(at("LOBBY"), 100, PLAYERS_TO_START);

    expect(next.phase).toBe("COUNTDOWN");
    // Anchored to the Tick it began, so the countdown a client renders is
    // derived from the server's own Tick and not from any wall clock.
    expect(next.phaseStartTick).toBe(100);
  });

  it("holds the Countdown for its full three seconds of Ticks", () => {
    const counting = at("COUNTDOWN", 100);

    expect(step(counting, 100, 2).phase).toBe("COUNTDOWN");
    expect(step(counting, 100 + COUNTDOWN_TICKS - 1, 2).phase).toBe("COUNTDOWN");
  });

  it("releases everyone into RUNNING on one exact Tick", () => {
    const next = step(at("COUNTDOWN", 100), 100 + COUNTDOWN_TICKS, 2);

    expect(next.phase).toBe("RUNNING");
    expect(next.phaseStartTick).toBe(100 + COUNTDOWN_TICKS);
  });

  it("keeps RUNNING once it has started — ending a Round is M4 ticket 05's job", () => {
    const running = at("RUNNING", 200);

    expect(step(running, 10_000, 2)).toEqual(running);
  });

  it("does not re-open the Lobby just because a Player dropped mid-Countdown", () => {
    // Whoever is left still gets their Round; the disconnect is ticket 05's
    // DNF to record, not a reason to yank the start back.
    expect(step(at("COUNTDOWN", 100), 105, 1).phase).toBe("COUNTDOWN");
    expect(step(at("RUNNING", 100), 105, 1).phase).toBe("RUNNING");
  });

  it("returns to LOBBY once the last Player has gone", () => {
    // A Round with nobody in it is over, and the server has to be ready to
    // start a fresh one for whoever connects next.
    expect(step(at("COUNTDOWN", 100), 105, 0).phase).toBe("LOBBY");
    expect(step(at("RUNNING", 100), 105, 0).phase).toBe("LOBBY");
  });

  it("re-anchors on the way back to LOBBY, so the next Countdown is a full one", () => {
    expect(step(at("RUNNING", 100), 105, 0).phaseStartTick).toBe(105);
  });

  it("honours a configured Player threshold — one Player can start a solo Round", () => {
    expect(step(at("LOBBY"), 100, 1, 1).phase).toBe("COUNTDOWN");
  });

  it("honours a configured Countdown length, so a test needn't sit through three real seconds", () => {
    const zeroCountdown = { tick: 101, connectedPlayers: 2, playersToStart: 2, countdownMs: 0 };

    expect(advanceMatchPhase(at("COUNTDOWN", 100), zeroCountdown).phase).toBe("RUNNING");
    // …and the default is still the real three seconds when nothing is passed.
    expect(advanceMatchPhase(at("COUNTDOWN", 100), { tick: 101, connectedPlayers: 2, playersToStart: 2 }).phase).toBe(
      "COUNTDOWN",
    );
  });

  it("is a pure function of its inputs — the same state and Tick always give the same answer", () => {
    const state = at("LOBBY");
    expect(step(state, 100, 2)).toEqual(step(state, 100, 2));
    expect(state).toEqual(at("LOBBY")); // and never mutates what it was given
  });
});

describe("countdownMsLeft", () => {
  it("is the full Countdown on the Tick it begins", () => {
    expect(countdownMsLeft(at("COUNTDOWN", 100), 100)).toBe(3_000);
  });

  it("counts down with the server's own Ticks", () => {
    expect(countdownMsLeft(at("COUNTDOWN", 100), 100 + TICK_RATE_HZ)).toBe(2_000);
  });

  it("reaches zero exactly as the Countdown ends", () => {
    expect(countdownMsLeft(at("COUNTDOWN", 100), 100 + COUNTDOWN_TICKS)).toBe(0);
  });

  it("is zero in every other phase — there is nothing counting down", () => {
    expect(countdownMsLeft(at("LOBBY"), 100)).toBe(0);
    expect(countdownMsLeft(at("RUNNING", 100), 200)).toBe(0);
  });
});
