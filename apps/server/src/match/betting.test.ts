import { BETTING_WINDOW_MS } from "@dont-fall/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { httpBettingNotifier, openBettingArgs, roundWinners } from "./betting.js";

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
      closesAtMs: 1_000 + BETTING_WINDOW_MS,
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
    await notifier.settleRound({ matchId: "m1", round: 1, winnerIds: ["a"] });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]![0]).toBe("http://api:9999/bets/rounds/open");
    expect(fetchMock.mock.calls[1]![0]).toBe("http://api:9999/bets/rounds/settle");
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1]?.body))).toEqual({
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
