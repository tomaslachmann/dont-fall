import { describe, expect, it } from "vitest";
import { allReady, resolveHostId, type LobbyPlayer } from "./Lobby.js";

const player = (id: string, ready: boolean, joinOrder: number): LobbyPlayer => ({
  id,
  nickname: `nick-${id}`,
  ready,
  joinOrder,
});

describe("allReady", () => {
  it("is true once every connected Player has marked themselves Ready", () => {
    expect(allReady([player("a", true, 0), player("b", true, 1)])).toBe(true);
  });

  it("is false while anyone has not marked themselves Ready", () => {
    expect(allReady([player("a", true, 0), player("b", false, 1)])).toBe(false);
  });

  it("is false for an empty Lobby — nobody being Ready is not everybody being Ready", () => {
    expect(allReady([])).toBe(false);
  });

  it("is true for a single Player who is Ready", () => {
    expect(allReady([player("a", true, 0)])).toBe(true);
  });
});

describe("resolveHostId", () => {
  it("is the first joiner", () => {
    expect(resolveHostId([player("a", false, 5), player("b", false, 2), player("c", false, 9)])).toBe("b");
  });

  it("is undefined for an empty Lobby", () => {
    expect(resolveHostId([])).toBeUndefined();
  });

  it("reassigns to whoever has been here longest once the original host leaves", () => {
    // Simulates "a" (joinOrder 0, the original host) having disconnected —
    // resolveHostId is recomputed from who is here now, never stored.
    expect(resolveHostId([player("b", false, 1), player("c", false, 2)])).toBe("b");
  });

  it("is stable for a single Player", () => {
    expect(resolveHostId([player("a", false, 0)])).toBe("a");
  });
});
