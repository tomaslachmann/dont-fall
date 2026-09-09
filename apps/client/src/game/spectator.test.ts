import { describe, expect, it } from "vitest";
import { isSpectating, livingIds, nextSpectatorTarget, SpectatorController } from "./spectator.js";

const chars = (entries: [id: string, eliminated: boolean][]): Record<string, { eliminated: boolean }> =>
  Object.fromEntries(entries.map(([id, eliminated]) => [id, { eliminated }]));

describe("isSpectating", () => {
  it("is true while eliminated and the Round is still running", () => {
    expect(isSpectating("RUNNING", true)).toBe(true);
  });

  it("is false while still playing", () => {
    expect(isSpectating("RUNNING", false)).toBe(false);
  });

  it("ends with the Round — never later (CONTEXT.md Spectator Mode lasts until the Round ends)", () => {
    expect(isSpectating("ROUND_END", true)).toBe(false);
    expect(isSpectating("RESULTS", true)).toBe(false);
    expect(isSpectating("COUNTDOWN", true)).toBe(false);
    expect(isSpectating("LOBBY", true)).toBe(false);
  });
});

describe("livingIds", () => {
  it("lists everyone still in the Round except yourself, sorted", () => {
    expect(livingIds(chars([["me", true], ["c", false], ["a", false], ["b", true]]), "me")).toEqual(["a", "c"]);
  });

  it("is empty when nobody is left to follow", () => {
    expect(livingIds(chars([["me", true], ["a", true]]), "me")).toEqual([]);
    expect(livingIds(chars([["me", true]]), "me")).toEqual([]);
  });
});

describe("nextSpectatorTarget", () => {
  it("returns null when nobody is living", () => {
    expect(nextSpectatorTarget([], null)).toBeNull();
    expect(nextSpectatorTarget([], "a")).toBeNull();
  });

  it("starts on the first living Character", () => {
    expect(nextSpectatorTarget(["a", "b"], null)).toBe("a");
  });

  it("restarts on the first living Character when the followed one is gone", () => {
    expect(nextSpectatorTarget(["a", "b"], "gone")).toBe("a");
  });

  it("cycles forward and wraps around", () => {
    expect(nextSpectatorTarget(["a", "b", "c"], "a")).toBe("b");
    expect(nextSpectatorTarget(["a", "b", "c"], "c")).toBe("a");
  });
});

describe("SpectatorController", () => {
  it("starts with no target", () => {
    expect(new SpectatorController().target).toBeNull();
  });

  it("update picks the first living Character and keeps a still-living one (no camera yank)", () => {
    const spectator = new SpectatorController();
    spectator.update(["a", "b"]);
    expect(spectator.target).toBe("a");

    spectator.update(["a", "b"]);
    expect(spectator.target).toBe("a");
  });

  it("update moves off a Character that just got eliminated, and clears when none are left", () => {
    const spectator = new SpectatorController();
    spectator.update(["a", "b"]);
    spectator.cycle(["a", "b"]);
    expect(spectator.target).toBe("b");

    spectator.update(["a"]);
    expect(spectator.target).toBe("a");

    spectator.update([]);
    expect(spectator.target).toBeNull();
  });

  it("cycle walks the living list and wraps", () => {
    const spectator = new SpectatorController();
    spectator.update(["a", "b"]);
    spectator.cycle(["a", "b"]);
    spectator.cycle(["a", "b"]);
    expect(spectator.target).toBe("a");
  });

  it("reset hands the camera back — no leftover target into the next Round", () => {
    const spectator = new SpectatorController();
    spectator.update(["a", "b"]);
    spectator.reset();
    expect(spectator.target).toBeNull();
  });
});
