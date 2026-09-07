import { describe, expect, it } from "vitest";
import { buildResults } from "./Results.js";

describe("buildResults", () => {
  it("ranks Qualified Characters by finish Tick, earliest first", () => {
    const rows = buildResults(
      {
        a: { finishTick: 200, checkpointIndex: 4, fallCount: 1 },
        b: { finishTick: 100, checkpointIndex: 4, fallCount: 0 },
      },
      [
        { id: "a", nickname: "Alice", ready: true, joinOrder: 0 },
        { id: "b", nickname: "Bob", ready: true, joinOrder: 1 },
      ],
      [],
    );

    expect(rows.map((r) => r.id)).toEqual(["b", "a"]);
    expect(rows[0]!.placement).toBe(1);
    expect(rows[1]!.placement).toBe(2);
    expect(rows.every((r) => r.qualified)).toBe(true);
  });

  it("shares a placement between Characters who finished on the same Tick, and the next one skips", () => {
    const rows = buildResults(
      {
        a: { finishTick: 100, checkpointIndex: 4, fallCount: 0 },
        b: { finishTick: 100, checkpointIndex: 4, fallCount: 0 },
        c: { finishTick: 150, checkpointIndex: 4, fallCount: 0 },
      },
      [],
      [],
    );

    const byId = Object.fromEntries(rows.map((r) => [r.id, r.placement]));
    expect(byId.a).toBe(1);
    expect(byId.b).toBe(1);
    expect(byId.c).toBe(3); // skips 2 — standard competition ranking
  });

  it("ranks everyone who did not Qualify by how far along the Track they got, furthest first", () => {
    const rows = buildResults(
      {
        a: { finishTick: null, checkpointIndex: 1, fallCount: 3 },
        b: { finishTick: null, checkpointIndex: 3, fallCount: 0 },
        c: { finishTick: null, checkpointIndex: null, fallCount: 2 }, // never reached the first Checkpoint
      },
      [],
      [],
    );

    expect(rows.map((r) => r.id)).toEqual(["b", "a", "c"]);
    expect(rows.every((r) => !r.qualified && r.placement === null)).toBe(true);
  });

  it("lists every Qualified Character before every non-Qualified one, regardless of input order", () => {
    const rows = buildResults(
      {
        eliminated: { finishTick: null, checkpointIndex: 5, fallCount: 0 },
        qualified: { finishTick: 999, checkpointIndex: 6, fallCount: 0 },
      },
      [],
      [],
    );

    expect(rows.map((r) => r.id)).toEqual(["qualified", "eliminated"]);
  });

  it("carries falls and Checkpoint progress through for every row, Qualified or not", () => {
    const rows = buildResults(
      { a: { finishTick: 100, checkpointIndex: 4, fallCount: 7 } },
      [{ id: "a", nickname: "Alice", ready: true, joinOrder: 0 }],
      [],
    );

    expect(rows[0]).toMatchObject({ fallCount: 7, checkpointIndex: 4, nickname: "Alice" });
  });

  it("appends a DNF row for a Player who dropped mid-Round, last and unranked", () => {
    const rows = buildResults(
      { a: { finishTick: 100, checkpointIndex: 4, fallCount: 0 } },
      [{ id: "a", nickname: "Alice", ready: true, joinOrder: 0 }],
      [{ id: "left-id", nickname: "Casey" }],
    );

    expect(rows.map((r) => r.id)).toEqual(["a", "left-id"]);
    const dnfRow = rows[1]!;
    expect(dnfRow.dnf).toBe(true);
    expect(dnfRow.qualified).toBe(false);
    expect(dnfRow.placement).toBeNull();
    expect(dnfRow.nickname).toBe("Casey");
  });

  it("falls back to a generic nickname for a row whose Lobby entry is gone", () => {
    const rows = buildResults({ a: { finishTick: null, checkpointIndex: 0, fallCount: 0 } }, [], []);

    expect(rows[0]!.nickname).toBe("Player");
  });

  it("returns an empty list for an empty Round", () => {
    expect(buildResults({}, [], [])).toEqual([]);
  });
});

describe("buildResults — a DNF'd Player whose Character is still in the world (M5 ticket 08, found live)", () => {
  // Since M5 ticket 04 a mid-Round drop *marks* the Character eliminated
  // rather than removing it (ADR 0042), so `characters` and `dnfEntries` now
  // both describe the same Player — this used to put them on the Results
  // Screen twice, once as "Did not reach a Checkpoint" and again as "Left
  // early".
  const players = [
    { id: "stayed", nickname: "Stayed", ready: true, joinOrder: 0 },
    { id: "left", nickname: "Left", ready: true, joinOrder: 1 },
  ];

  it("gives them one row, not two", () => {
    const rows = buildResults(
      {
        stayed: { finishTick: 90, checkpointIndex: 1, fallCount: 0 },
        left: { finishTick: null, checkpointIndex: 0, fallCount: 2 },
      },
      players,
      [{ id: "left", nickname: "Left" }],
    );

    expect(rows.map((r) => r.id)).toEqual(["stayed", "left"]);
    expect(rows.filter((r) => r.id === "left")).toHaveLength(1);
  });

  it("and it is the DNF row — they left early, they did not merely fail to Qualify", () => {
    const rows = buildResults(
      { left: { finishTick: null, checkpointIndex: 0, fallCount: 2 } },
      players,
      [{ id: "left", nickname: "Left" }],
    );

    expect(rows[0]).toMatchObject({ id: "left", dnf: true, qualified: false });
  });

  it("carries the progress their Character actually made, now that it is still there to ask", () => {
    const rows = buildResults(
      { left: { finishTick: null, checkpointIndex: 1, fallCount: 3 } },
      players,
      [{ id: "left", nickname: "Left" }],
    );

    expect(rows[0]).toMatchObject({ checkpointIndex: 1, fallCount: 3 });
  });

  it("still ranks a Qualification earned before the drop, rather than demoting it to a DNF", () => {
    // A Player can cross the Finish Zone and then lose their connection while
    // the Round is still RUNNING, which is when a DNF is recorded.
    const rows = buildResults(
      {
        left: { finishTick: 40, checkpointIndex: 2, fallCount: 0 },
        stayed: { finishTick: 90, checkpointIndex: 2, fallCount: 0 },
      },
      players,
      [{ id: "left", nickname: "Left" }],
    );

    expect(rows.map((r) => ({ id: r.id, placement: r.placement, dnf: r.dnf }))).toEqual([
      { id: "left", placement: 1, dnf: false },
      { id: "stayed", placement: 2, dnf: false },
    ]);
  });

  it("still lists a DNF whose Character really is gone — a drop outside a Round removes it", () => {
    const rows = buildResults(
      { stayed: { finishTick: 90, checkpointIndex: 1, fallCount: 0 } },
      players,
      [{ id: "left", nickname: "Left" }],
    );

    expect(rows.map((r) => r.id)).toEqual(["stayed", "left"]);
    expect(rows[1]).toMatchObject({ dnf: true, checkpointIndex: null, fallCount: 0 });
  });
});

