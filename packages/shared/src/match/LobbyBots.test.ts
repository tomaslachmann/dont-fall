import { describe, expect, it } from "vitest";
import { botsToFill, defaultLobbyBots, invalidLobbyBotsReason } from "./LobbyBots.js";

describe("a Lobby's Bot settings (M17 ticket 10, ADR 0129)", () => {
  it("a fresh Lobby has none, with the cap at a full Lobby less its host", () => {
    expect(defaultLobbyBots(10)).toEqual({ enabled: false, max: 9, level: "normal" });
    expect(botsToFill(defaultLobbyBots(10), 9)).toBe(0);
  });

  it("fills min(max, free seats) when on, and nothing when off", () => {
    expect(botsToFill({ enabled: true, max: 5, level: "easy" }, 9)).toBe(5);
    expect(botsToFill({ enabled: true, max: 5, level: "easy" }, 3)).toBe(3);
    expect(botsToFill({ enabled: true, max: 5, level: "easy" }, 0)).toBe(0);
    expect(botsToFill({ enabled: false, max: 5, level: "easy" }, 9)).toBe(0);
  });

  it("refuses anything but a boolean, a whole number up to capacity less the host, and a known level", () => {
    expect(invalidLobbyBotsReason({ enabled: true, max: 9, level: "hard" }, 10)).toBeUndefined();
    expect(invalidLobbyBotsReason({ enabled: true, max: 0, level: "easy" }, 10)).toBeUndefined();
    expect(invalidLobbyBotsReason({ enabled: true, max: 10, level: "hard" }, 10)).toMatch(/max/);
    expect(invalidLobbyBotsReason({ enabled: true, max: -1, level: "hard" }, 10)).toMatch(/max/);
    expect(invalidLobbyBotsReason({ enabled: true, max: 1.5, level: "hard" }, 10)).toMatch(/max/);
    expect(invalidLobbyBotsReason({ enabled: "yes", max: 1, level: "hard" }, 10)).toMatch(/enabled/);
    expect(invalidLobbyBotsReason({ enabled: true, max: 1, level: "insane" }, 10)).toMatch(/level/);
    expect(invalidLobbyBotsReason(null, 10)).toMatch(/object/);
  });
});
