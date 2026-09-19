import { describe, expect, it } from "vitest";
import type { RoundResult } from "@dont-fall/shared";
import { localDeadline, standingsRows } from "./standings.js";

const players = (...ids: string[]) => ids.map((id) => ({ id }));
const round = (...rows: [string, number][]): RoundResult => ({
  rows: rows.map(([id, placement]) => ({ id, placement, qualified: false })),
});

describe("standingsRows (ADR 0110)", () => {
  it("measures this Round's gain and each climb against the Standings before it", () => {
    const rows = standingsRows(
      {
        roundResults: [round(["a", 1], ["b", 2]), round(["b", 1], ["a", 2])],
        standingsReady: [],
        lobby: { players: players("a", "b") },
      },
      (id) => id,
    );
    const a = rows.find((row) => row.id === "a")!;
    const b = rows.find((row) => row.id === "b")!;
    // A two-bean Round pays the winner everything and the loser nothing, so
    // the second Round's winner gains all of it and ties the first's.
    expect(b.gained).toBe(b.score - 0);
    expect(a.gained).toBe(0);
    expect(a.previousPlacement).toBe(1);
    expect(b.previousPlacement).toBe(2);
  });

  it("gives no earlier place to anyone who had no Score before this Round", () => {
    const rows = standingsRows(
      { roundResults: [round(["a", 1])], standingsReady: [], lobby: { players: players("a", "late") } },
      (id) => id,
    );
    expect(rows.map((row) => row.previousPlacement)).toEqual([null, null]);
    expect(rows.find((row) => row.id === "late")).toMatchObject({ score: 0, gained: 0 });
  });
});

describe("localDeadline", () => {
  it("moves a server-clock deadline onto the page clock", () => {
    expect(localDeadline(10_000, 4_000, 1_700_000_000_000)).toBe(1_700_000_006_000);
  });

  it("gives nothing before time sync, or without a deadline", () => {
    expect(localDeadline(10_000, null, 5)).toBeNull();
    expect(localDeadline(null, 4_000, 5)).toBeNull();
  });
});
