import { describe, expect, it } from "vitest";
import { rankWithTies } from "./ranking.js";

describe("rankWithTies", () => {
  it("gives every item a distinct, ascending placement when nothing ties", () => {
    expect(rankWithTies(["a", "b", "c"], (a, b) => a === b)).toEqual([1, 2, 3]);
  });

  it("shares a placement across a tie and skips the next one", () => {
    expect(rankWithTies([1, 1, 2], (a, b) => a === b)).toEqual([1, 1, 3]);
  });

  it("shares across more than two tied in a row", () => {
    expect(rankWithTies([1, 1, 1, 2], (a, b) => a === b)).toEqual([1, 1, 1, 4]);
  });

  it("only compares adjacent items — a tie does not propagate past a non-tied item in between", () => {
    // 1, 1, 2, 1 — the last 1 is NOT tied with the earlier 1s, since it only compares to its immediate predecessor (2).
    expect(rankWithTies([1, 1, 2, 1], (a, b) => a === b)).toEqual([1, 1, 3, 4]);
  });

  it("returns an empty array for an empty input", () => {
    expect(rankWithTies([], () => true)).toEqual([]);
  });

  it("gives a single item placement 1", () => {
    expect(rankWithTies(["only"], () => true)).toEqual([1]);
  });
});
