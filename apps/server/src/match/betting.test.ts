import { BETTING_CEILING_MS } from "@dont-fall/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { httpBettingNotifier, openBettingArgs, roundWinners, runnersLeft } from "./betting.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("roundWinners", () => {
  it("takes the placement-1 row as the winner", () => {
    expect(
      roundWinners({
        rows: [
          { id: "b", placement: 2, qualified: false },
          { id: "a", placement: 1, qualified: true },
        ],
      }),
    ).toEqual(["a"]);
  });

  it("ties share the crown — every placement-1 backer wins", () => {
    expect(
      roundWinners({
        rows: [
          { id: "a", placement: 1, qualified: true },
          { id: "b", placement: 1, qualified: true },
          { id: "c", placement: 3, qualified: false },
        ],
      }),
    ).toEqual(["a", "b"]);
  });
});

describe("runnersLeft (ADR 0110)", () => {
  it("counts only who is neither out nor across the line", () => {
    expect(
      runnersLeft({
        running: { eliminated: false, finishTick: null },
        alsoRunning: { eliminated: false, finishTick: null },
        out: { eliminated: true, finishTick: null },
        home: { eliminated: false, finishTick: 400 },
      }),
    ).toBe(2);
  });
});

describe("openBettingArgs", () => {
  const players = new Map([
    ["a", { nickname: "Ann" }],
    ["b", { nickname: "Bob" }],
    ["s", { nickname: "Sid" }],
  ]);

  it("opens round 1 with the roster and a close one window out", () => {
    expect(
      openBettingArgs({ matchId: "m1", finishedRounds: 0, players, sidelined: new Set(), nowMs: 1_000 }),
    ).toEqual({
      matchId: "m1",
      round: 1,
      closesAtMs: 1_000 + BETTING_CEILING_MS,
      runners: [
        { playerId: "a", nickname: "Ann" },
        { playerId: "b", nickname: "Bob" },
        { playerId: "s", nickname: "Sid" },
      ],
    });
  });

  it("counts finished Rounds and leaves sidelined spectators off the board", () => {
    const args = openBettingArgs({ matchId: "m1", finishedRounds: 2, players, sidelined: new Set(["s"]), nowMs: 0 });
    expect(args.round).toBe(3);
    expect(args.runners.map((r) => r.playerId)).toEqual(["a", "b"]);
  });
});

describe("httpBettingNotifier", () => {
  it("posts open and settle to the API's betting rounds", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const notifier = httpBettingNotifier("http://api:9999", fetchMock as unknown as typeof fetch);

    await notifier.openRound({ matchId: "m1", round: 1, closesAtMs: 5_000, runners: [] });
    await notifier.closeRound({ matchId: "m1", round: 1 });
    await notifier.settleRound({ matchId: "m1", round: 1, winnerIds: ["a"] });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]![0]).toBe("http://api:9999/bets/rounds/open");
    expect(fetchMock.mock.calls[1]![0]).toBe("http://api:9999/bets/rounds/close");
    expect(fetchMock.mock.calls[2]![0]).toBe("http://api:9999/bets/rounds/settle");
    expect(JSON.parse(String(fetchMock.mock.calls[2]![1]?.body))).toEqual({
      matchId: "m1",
      round: 1,
      winnerIds: ["a"],
    });
  });

  it("a down API logs and resolves — the Round never waits on betting", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    const notifier = httpBettingNotifier("http://api:9999", (() => Promise.reject(new Error("down"))) as never);

    await expect(notifier.openRound({ matchId: "m1", round: 1, closesAtMs: 5_000, runners: [] })).resolves.toBeUndefined();
    expect(silence).toHaveBeenCalled();
  });
});

describe("a Bot on the board (M17 ticket 10, ADR 0129)", () => {
  it("is a runner one can back, and can take the Round — it is never a bettor, having no Account to bet with", () => {
    // A Bot's seat is a roster row with no Account; the board lists it like anyone's.
    const players = new Map([
      ["player", { nickname: "Floppo", accountId: "acc-1" }],
      ["bot", { nickname: "pixelpeach", accountId: null }],
    ]);
    const opened = openBettingArgs({ matchId: "m1", finishedRounds: 0, players, sidelined: new Set(), nowMs: 0 });
    expect(opened.runners).toEqual([
      { playerId: "player", nickname: "Floppo" },
      { playerId: "bot", nickname: "pixelpeach" },
    ]);
    expect(
      roundWinners({
        rows: [
          { id: "bot", placement: 1, qualified: true },
          { id: "player", placement: 2, qualified: false },
        ],
      }),
    ).toEqual(["bot"]);
  });
});
