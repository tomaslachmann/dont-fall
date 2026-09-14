import { describe, expect, it } from "vitest";
import {
  derivePresence,
  IDLE_WINDOW_MS,
  ONLINE_WINDOW_MS,
  type LobbySeat,
} from "./presence.js";

const seat = (overrides: {
  lobbyId?: string;
  isPrivate?: boolean;
  code?: string;
  phase?: string;
  round?: number | null;
  playerCount?: number;
  maxPlayers?: number;
} = {}): LobbySeat => ({
  lobbyId: overrides.lobbyId ?? "lobby-1",
  phase: overrides.phase ?? "LOBBY",
  round: overrides.round ?? null,
  playerCount: overrides.playerCount ?? 2,
  maxPlayers: overrides.maxPlayers ?? 10,
  ...(overrides.isPrivate
    ? { isPrivate: true as const, code: overrides.code ?? "CODE42" }
    : { isPrivate: false as const }),
});

const NOW = 1_000_000;

describe("derivePresence", () => {
  it("a seated friend reads their lobby — slots, join ref, and the JOIN gate", () => {
    const seats = new Map([["a", seat({ playerCount: 7, maxPlayers: 10 })]]);

    const presence = derivePresence(["a"], new Map(), seats, NOW).get("a");

    expect(presence).toEqual({ status: "in-lobby", slotsOpen: 3, lobby: { kind: "public", lobbyId: "lobby-1" }, joinable: true });
  });

  it("a private lobby travels by join code; a full one is not joinable", () => {
    const seats = new Map([
      ["a", seat({ isPrivate: true, code: "ABC123", playerCount: 10, maxPlayers: 10 })],
    ]);

    const presence = derivePresence(["a"], new Map(), seats, NOW).get("a");

    expect(presence).toEqual({
      status: "in-lobby",
      slotsOpen: 0,
      lobby: { kind: "private", code: "ABC123" },
      joinable: false,
    });
  });

  it("COUNTDOWN through RESULTS all read in-match with the running Round — never a lobby ref", () => {
    for (const phase of ["COUNTDOWN", "RUNNING", "ROUND_END", "RESULTS"]) {
      const seats = new Map([["a", seat({ phase, round: 2, playerCount: 8, maxPlayers: 10 })]]);
      expect(derivePresence(["a"], new Map(), seats, NOW).get("a")).toEqual({ status: "in-match", round: 2 });
    }
  });

  it("a seated friend needs no heartbeat — the roster is authoritative", () => {
    const seats = new Map([["a", seat()]]);
    expect(derivePresence(["a"], new Map(), seats, NOW).get("a")?.status).toBe("in-lobby");
  });

  it("no seat plus a fresh beat reads online — in the app, between lobbies", () => {
    const presence = derivePresence(["a"], new Map([["a", NOW - 10_000]]), new Map(), NOW).get("a");
    expect(presence).toEqual({ status: "online" });
  });

  it("an aging beat reads idle with last-seen; a stale one reads offline", () => {
    const idle = derivePresence(["a"], new Map([["a", NOW - ONLINE_WINDOW_MS - 1_000]]), new Map(), NOW).get("a");
    expect(idle).toEqual({ status: "idle", lastSeenAt: NOW - ONLINE_WINDOW_MS - 1_000 });

    const offline = derivePresence(["a"], new Map([["a", NOW - IDLE_WINDOW_MS - 1_000]]), new Map(), NOW).get("a");
    expect(offline).toEqual({ status: "offline", lastSeenAt: NOW - IDLE_WINDOW_MS - 1_000 });
  });

  it("no seat and no beat ever reads offline with no last-seen", () => {
    expect(derivePresence(["a"], new Map(), new Map(), NOW).get("a")).toEqual({ status: "offline" });
  });

  it("window edges belong to the fresher status", () => {
    const atOnlineEdge = derivePresence(["a"], new Map([["a", NOW - ONLINE_WINDOW_MS + 1]]), new Map(), NOW).get("a");
    expect(atOnlineEdge?.status).toBe("online");
    const atIdleEdge = derivePresence(["a"], new Map([["a", NOW - IDLE_WINDOW_MS + 1]]), new Map(), NOW).get("a");
    expect(atIdleEdge?.status).toBe("idle");
  });

  it("derives every requested id, unknown included", () => {
    const result = derivePresence(["a", "b"], new Map([["a", NOW]]), new Map(), NOW);
    expect(result.get("a")).toEqual({ status: "online" });
    expect(result.get("b")).toEqual({ status: "offline" });
  });
});
