import { describe, expect, it } from "vitest";
import { roundScore } from "@dont-fall/shared";
import { detectRunEnd } from "./runEnd.js";

const chars = (
  entries: [id: string, finishTick: number | null, eliminated: boolean, checkpointIndex?: number | null][],
): Record<string, { finishTick: number | null; eliminated: boolean; checkpointIndex: number | null }> =>
  Object.fromEntries(
    entries.map(([id, finishTick, eliminated, checkpointIndex = null]) => [id, { finishTick, eliminated, checkpointIndex }]),
  );

describe("detectRunEnd", () => {
  it("fires once on the finish edge, placed among everyone who crossed before", () => {
    const characters = chars([
      ["me", 300, false],
      ["a", 200, false],
      ["b", 250, false],
      ["c", null, false],
    ]);
    const event = detectRunEnd({
      wasFinished: false,
      wasEliminated: false,
      character: characters["me"],
      characters,
      myId: "me",
      raceTimeMs: 82_104,
      survivedMs: 82_104,
      nicknameOf: (id) => id,
    });
    expect(event).toEqual({
      outcome: "finished",
      placement: 3,
      playerCount: 4,
      qualified: true,
      points: roundScore(3, 4, true),
      raceTimeMs: 82_104,
      survivedMs: null,
      checkpointIndex: null,
      outBy: null,
    });
  });

  it("fires once on the elimination edge, one past everyone still racing", () => {
    const characters = chars([
      ["me", null, true],
      ["a", null, false],
      ["b", null, false],
      ["c", null, true],
    ]);
    const event = detectRunEnd({
      wasFinished: false,
      wasEliminated: false,
      character: characters["me"],
      characters,
      myId: "me",
      raceTimeMs: 272_000,
      survivedMs: 272_000,
      nicknameOf: (id) => id,
    });
    expect(event).toEqual({
      outcome: "out",
      placement: 3,
      playerCount: 4,
      qualified: false,
      points: roundScore(3, 4, false),
      raceTimeMs: null,
      survivedMs: 272_000,
      checkpointIndex: null,
      outBy: null,
    });
  });

  it("names who put you out, off the server's credit (ADR 0110)", () => {
    const characters = {
      me: { finishTick: null, eliminated: true, checkpointIndex: null, eliminatedBy: { byId: "a", how: "hurled" as const } },
      a: { finishTick: null, eliminated: false, checkpointIndex: null },
    };
    const event = detectRunEnd({
      wasFinished: false,
      wasEliminated: false,
      character: characters.me,
      characters,
      myId: "me",
      raceTimeMs: 0,
      survivedMs: 40_000,
      nicknameOf: (id) => (id === "a" ? "Floppo" : id),
    });
    expect(event?.outBy).toEqual({ nickname: "Floppo", how: "hurled" });
  });

  it("stays silent mid-run, after the edge, and for a joiner with no Character", () => {
    const characters = chars([["me", null, false]]);
    const base = { character: characters["me"]!, characters, myId: "me", raceTimeMs: 0, survivedMs: 0, nicknameOf: (id: string) => id };
    expect(detectRunEnd({ ...base, wasFinished: false, wasEliminated: false })).toBeNull();
    expect(
      detectRunEnd({
        ...base,
        character: { finishTick: 300, eliminated: false, checkpointIndex: null },
        characters: chars([["me", 300, false]]),
        wasFinished: true,
        wasEliminated: false,
      }),
    ).toBeNull();
    expect(detectRunEnd({ ...base, character: undefined, wasFinished: false, wasEliminated: false })).toBeNull();
  });
});
