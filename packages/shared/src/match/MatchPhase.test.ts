import { describe, expect, it } from "vitest";
import { COUNTDOWN_TICKS, ROUND_END_TICKS, TICK_RATE_HZ } from "../tuning.js";
import {
  advanceMatchPhase,
  countdownMsLeft,
  phaseLocksInput,
  type MatchPhaseInputs,
  type MatchState,
} from "./MatchPhase.js";

const at = (phase: MatchState["phase"], phaseStartTick = 0): MatchState => ({ phase, phaseStartTick });
const step = (state: MatchState, tick: number, connectedPlayers: number, startRequested = false) =>
  advanceMatchPhase(state, { tick, connectedPlayers, startRequested });

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
  it("waits in LOBBY, however many Players connect, until the host's start is handed in", () => {
    // M4 ticket 07 replaced "enough Players connected" with an explicit
    // start — connecting alone no longer moves the Match anywhere.
    expect(step(at("LOBBY"), 100, 0).phase).toBe("LOBBY");
    expect(step(at("LOBBY"), 100, 1).phase).toBe("LOBBY");
    expect(step(at("LOBBY"), 100, 2).phase).toBe("LOBBY");
  });

  it("starts the Countdown the Tick the host's start is handed in", () => {
    const next = step(at("LOBBY"), 100, 2, true);

    expect(next.phase).toBe("COUNTDOWN");
    // Anchored to the Tick it began, so the countdown a client renders is
    // derived from the server's own Tick and not from any wall clock.
    expect(next.phaseStartTick).toBe(100);
  });

  it("does not start on its own just because everyone happens to be Ready — the host still has to press start", () => {
    // This function only ever asks "has startRequested fired" — validating
    // "enough Players, everyone Ready" is the caller's job, done once at the
    // point a `start` message actually arrives (M4 ticket 07).
    expect(step(at("LOBBY"), 100, 2, false).phase).toBe("LOBBY");
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

  it("keeps RUNNING while the Round is still being raced", () => {
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

  it("does not require a minimum headcount of its own — one Player can start a solo Round once they say so", () => {
    // The threshold ("enough Players") is validated by the caller before it
    // ever sets startRequested (M4 ticket 07) — this function only asks
    // whether that already-validated signal fired.
    expect(step(at("LOBBY"), 100, 1, true).phase).toBe("COUNTDOWN");
  });

  it("honours a configured Countdown length, so a test needn't sit through three real seconds", () => {
    const zeroCountdown = { tick: 101, connectedPlayers: 2, countdownMs: 0 };

    expect(advanceMatchPhase(at("COUNTDOWN", 100), zeroCountdown).phase).toBe("RUNNING");
    // …and the default is still the real three seconds when nothing is passed.
    expect(advanceMatchPhase(at("COUNTDOWN", 100), { tick: 101, connectedPlayers: 2 }).phase).toBe("COUNTDOWN");
  });

  it("is a pure function of its inputs — the same state and Tick always give the same answer", () => {
    const state = at("LOBBY");
    expect(step(state, 100, 2)).toEqual(step(state, 100, 2));
    expect(state).toEqual(at("LOBBY")); // and never mutates what it was given
  });
});

describe("advanceMatchPhase — ending a Round (M4 ticket 05)", () => {
  const running = at("RUNNING", 200);
  const ending = (extra: Partial<MatchPhaseInputs>) =>
    advanceMatchPhase(running, { tick: 300, connectedPlayers: 2, ...extra });

  it("ends the Round the moment every connected Character has Qualified", () => {
    const next = ending({ allQualified: true });

    expect(next.phase).toBe("ROUND_END");
    expect(next.phaseStartTick).toBe(300);
  });

  it("ends the Round when the clock runs out, however many are still running", () => {
    expect(ending({ timeExpired: true }).phase).toBe("ROUND_END");
  });

  it("takes whichever comes first — qualifying early does not wait out the clock", () => {
    expect(ending({ allQualified: true, timeExpired: false }).phase).toBe("ROUND_END");
    expect(ending({ allQualified: false, timeExpired: true }).phase).toBe("ROUND_END");
  });

  it("keeps running while someone is still out there with time on the clock", () => {
    expect(ending({ allQualified: false, timeExpired: false }).phase).toBe("RUNNING");
  });

  it("moves on to the Results after the round-end beat", () => {
    const roundEnd = at("ROUND_END", 300);

    expect(advanceMatchPhase(roundEnd, { tick: 300 + ROUND_END_TICKS - 1, connectedPlayers: 2 }).phase).toBe(
      "ROUND_END",
    );
    const next = advanceMatchPhase(roundEnd, { tick: 300 + ROUND_END_TICKS, connectedPlayers: 2 });
    expect(next.phase).toBe("RESULTS");
    expect(next.phaseStartTick).toBe(300 + ROUND_END_TICKS);
  });

  it("honours a configured round-end beat, so a test needn't sit through it", () => {
    expect(
      advanceMatchPhase(at("ROUND_END", 300), { tick: 301, connectedPlayers: 2, roundEndMs: 0 }).phase,
    ).toBe("RESULTS");
  });

  it("stays on the Results — returning to the Lobby for another Round is M4 ticket 08", () => {
    const results = at("RESULTS", 400);

    expect(advanceMatchPhase(results, { tick: 99_999, connectedPlayers: 2 })).toEqual(results);
  });

  it("still returns to the Lobby once everyone has gone, from any phase", () => {
    for (const phase of ["ROUND_END", "RESULTS"] as const) {
      expect(advanceMatchPhase(at(phase, 300), { tick: 400, connectedPlayers: 0 }).phase).toBe("LOBBY");
    }
  });

  it("never ends a Round that has not started — the Lobby ignores both endings", () => {
    const lobby = advanceMatchPhase(at("LOBBY"), {
      tick: 300,
      connectedPlayers: 1,
      allQualified: true,
      timeExpired: true,
    });

    expect(lobby.phase).toBe("LOBBY");
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
