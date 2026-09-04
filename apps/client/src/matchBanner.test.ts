import { COUNTDOWN_MS, PLAYERS_TO_START } from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import { matchBanner } from "./matchBanner.js";

describe("matchBanner", () => {
  it("says what the Lobby is waiting for", () => {
    expect(matchBanner("LOBBY", 0, 1, PLAYERS_TO_START)).toBe(`waiting for players · 1/${PLAYERS_TO_START}`);
  });

  it("reports the threshold the server is actually using, not the default", () => {
    // The Match server takes it as config, so a client that assumed the
    // constant would tell a solo developer they were waiting for a second
    // player who is never going to be needed.
    expect(matchBanner("LOBBY", 0, 1, 1)).toBe("waiting for players · 1/1");
  });

  it("counts the Countdown down in whole seconds", () => {
    expect(matchBanner("COUNTDOWN", COUNTDOWN_MS, 2, 2)).toBe("3");
    expect(matchBanner("COUNTDOWN", 2_100, 2, 2)).toBe("3");
    expect(matchBanner("COUNTDOWN", 2_000, 2, 2)).toBe("2");
    expect(matchBanner("COUNTDOWN", 1, 2, 2)).toBe("1");
  });

  it("says GO at the moment of release rather than showing a bare zero", () => {
    expect(matchBanner("COUNTDOWN", 0, 2, 2)).toBe("GO!");
  });

  it("shows nothing once the Round is running — the HUD is the game's, not a banner's", () => {
    expect(matchBanner("RUNNING", 0, 2, 2)).toBeNull();
  });

  it("has something to say for the phases M4 ticket 05 will start producing", () => {
    // Exhaustive from the start (ADR 0040's machine), so ticket 05 changes
    // wording rather than discovering an unhandled phase at runtime.
    expect(matchBanner("ROUND_END", 0, 2, 2)).not.toBeNull();
    expect(matchBanner("RESULTS", 0, 2, 2)).not.toBeNull();
  });
});
