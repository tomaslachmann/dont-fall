import { COUNTDOWN_MS, PLAYERS_TO_START } from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import { matchBanner, type MatchBannerState } from "./matchBanner.js";

const banner = (state: Partial<MatchBannerState>): string | null =>
  matchBanner({
    phase: "RUNNING",
    countdownMsLeft: 0,
    connectedPlayers: 2,
    playersToStart: 2,
    eliminated: false,
    ...state,
  });

describe("matchBanner", () => {
  it("says what the Lobby is waiting for", () => {
    expect(banner({ phase: "LOBBY", connectedPlayers: 1, playersToStart: PLAYERS_TO_START })).toBe(
      `waiting for players · 1/${PLAYERS_TO_START}`,
    );
  });

  it("reports the threshold the server is actually using, not the default", () => {
    // The Match server takes it as config, so a client that assumed the
    // constant would tell a solo developer they were waiting for a second
    // player who is never going to be needed.
    expect(banner({ phase: "LOBBY", connectedPlayers: 1, playersToStart: 1 })).toBe("waiting for players · 1/1");
  });

  it("counts the Countdown down in whole seconds", () => {
    expect(banner({ phase: "COUNTDOWN", countdownMsLeft: COUNTDOWN_MS })).toBe("3");
    expect(banner({ phase: "COUNTDOWN", countdownMsLeft: 2_100 })).toBe("3");
    expect(banner({ phase: "COUNTDOWN", countdownMsLeft: 2_000 })).toBe("2");
    expect(banner({ phase: "COUNTDOWN", countdownMsLeft: 1 })).toBe("1");
  });

  it("says GO at the moment of release rather than showing a bare zero", () => {
    expect(banner({ phase: "COUNTDOWN", countdownMsLeft: 0 })).toBe("GO!");
  });

  it("shows nothing once the Round is running — the HUD is the game's, not a banner's", () => {
    expect(banner({ phase: "RUNNING" })).toBeNull();
  });

  it("tells an Eliminated Player they were Eliminated", () => {
    expect(banner({ phase: "ROUND_END", eliminated: true })).toBe("ELIMINATED");
    expect(banner({ phase: "RESULTS", eliminated: true })).toBe("ELIMINATED");
  });

  it("does not call a Player who Qualified Eliminated", () => {
    expect(banner({ phase: "ROUND_END", eliminated: false })).not.toMatch(/ELIMINATED/);
    expect(banner({ phase: "RESULTS", eliminated: false })).not.toMatch(/ELIMINATED/);
  });
});
