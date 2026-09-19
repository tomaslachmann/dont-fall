import { MATCH_OVER_CLOSE_GRACE_MS } from "@dont-fall/shared";
import { describe, expect, it, vi } from "vitest";
import {
  SAVE_RETRY_TICKS,
  saveMatchResultIfDue,
  shouldBroadcastIdle,
  terminalCloseDue,
  type CloseRuntime,
  type SaveRuntime,
} from "./matchLoop.js";

/**
 * The ADR 0057 decision table, pinned without a socket (the live
 * `matchServer.test.ts` suites that exercise the whole loop need loopback,
 * which this sandbox denies — the table is what carries the correctness, so
 * it lives in a pure function with its own tests).
 */
describe("shouldBroadcastIdle (ADR 0057)", () => {
  it("sends the first broadcast — there is nothing to compare against yet", () => {
    expect(shouldBroadcastIdle(false, '{"phase":"LOBBY"}', null)).toBe(true);
  });

  it("stays silent when nothing changed and nobody joined", () => {
    expect(shouldBroadcastIdle(false, '{"phase":"LOBBY"}', '{"phase":"LOBBY"}')).toBe(false);
  });

  it("sends when the shared payload changed — a mutation is a push", () => {
    expect(shouldBroadcastIdle(false, '{"ready":true}', '{"ready":false}')).toBe(true);
  });

  it("sends when a join (or a sync) set the dirty flag, even with identical payload", () => {
    expect(shouldBroadcastIdle(true, '{"phase":"LOBBY"}', '{"phase":"LOBBY"}')).toBe(true);
  });
});

const saveRuntime = (saveResult: (result: unknown) => Promise<boolean>): SaveRuntime => ({
  savingResults: false,
  lastSaveAttemptTick: null,
  resultsSavedMatchId: null,
  resultsSavedAtMs: null,
  closed: false,
  config: { matchId: "m1" },
  roundResults: [{ rows: [{ id: "a", placement: 1, qualified: true }] }],
  roundTrackIds: ["track-1"],
  matchNicknames: new Map([["a", "Ann"]]),
  matchAccountIds: new Map([["a", "acc-1"]]),
  matchColors: new Map([["a", 2]]),
  matchSkins: new Map([["a", "tiger"]]),
  matchHats: new Map([["a", "crown"]]),
  totalFalls: { a: 2 },
  matchSurvivalMs: new Map([["a", 64_000]]),
  matchGrabsBroken: new Map([["a", 3]]),
  matchResults: { saveResult: saveResult as SaveRuntime["matchResults"]["saveResult"] },
});

/** Flushes the fire-and-observe save promise `saveMatchResultIfDue` never returns. */
const flushSaves = async (): Promise<void> => {
  await new Promise((resolve) => setImmediate(resolve));
};

describe("saveMatchResultIfDue (ADR 0059)", () => {
  it("saves on the first due tick and lands the saved id", async () => {
    const saveResult = vi.fn(async (_result: unknown) => true);
    const rt = saveRuntime(saveResult);

    saveMatchResultIfDue(rt, 1_000);
    expect(rt.savingResults).toBe(true);
    await flushSaves();

    expect(saveResult).toHaveBeenCalledTimes(1);
    expect(saveResult.mock.calls[0]![0]).toMatchObject({
      matchId: "m1",
      results: [{ rows: [{ id: "a", placement: 1, qualified: true }] }],
      roundTrackIds: ["track-1"],
      nicknames: { a: "Ann" },
      colors: { a: 2 },
      skins: { a: "tiger" },
      hats: { a: "crown" },
      totalFalls: { a: 2 },
      survivalMs: { a: 64_000 },
      grabsBroken: { a: 3 },
    });
    expect(rt.savingResults).toBe(false);
    expect(rt.resultsSavedMatchId).toBe("m1");
    expect(rt.resultsSavedAtMs).toEqual(expect.any(Number));
  });

  it("a Match with no played Round marks itself saved without calling the API — nothing to persist, and rows the API would refuse (found live 2026-09-18)", () => {
    const saveResult = vi.fn(async () => true);
    const rt = saveRuntime(saveResult);
    rt.roundResults = [];

    saveMatchResultIfDue(rt, 1_000);
    expect(saveResult).not.toHaveBeenCalled();
    expect(rt.savingResults).toBe(false);
    expect(rt.resultsSavedMatchId).toBe("m1");
    expect(rt.resultsSavedAtMs).toEqual(expect.any(Number));
  });

  it("never stacks a second save on an in-flight one", () => {
    const saveResult = vi.fn(async () => true);
    const rt = saveRuntime(saveResult);
    rt.savingResults = true;

    saveMatchResultIfDue(rt, 1_000);
    expect(saveResult).not.toHaveBeenCalled();
  });

  it("backs retries off in ticks, then tries again", async () => {
    const saveResult = vi.fn(async () => false);
    const rt = saveRuntime(saveResult);

    saveMatchResultIfDue(rt, 1_000);
    await flushSaves();
    expect(saveResult).toHaveBeenCalledTimes(1);
    expect(rt.resultsSavedMatchId).toBeNull();

    saveMatchResultIfDue(rt, 1_000 + SAVE_RETRY_TICKS - 1);
    expect(saveResult).toHaveBeenCalledTimes(1);

    saveMatchResultIfDue(rt, 1_000 + SAVE_RETRY_TICKS);
    await flushSaves();
    expect(saveResult).toHaveBeenCalledTimes(2);
  });

  it("a save landing after close leaves the saved id unset", async () => {
    let resolveSave!: (saved: boolean) => void;
    const saveResult = vi.fn(() => new Promise<boolean>((resolve) => (resolveSave = resolve)));
    const rt = saveRuntime(saveResult);

    saveMatchResultIfDue(rt, 1_000);
    rt.closed = true;
    resolveSave(true);
    await flushSaves();

    expect(rt.savingResults).toBe(false);
    expect(rt.resultsSavedMatchId).toBeNull();
  });
});

describe("terminalCloseDue (ADR 0059)", () => {
  const closeRuntime = (overrides: Partial<CloseRuntime> = {}): CloseRuntime => ({
    closeRequested: false,
    resultsSavedAtMs: 10_000,
    sockets: { size: 0 },
    ...overrides,
  });

  it("closes an emptied server the tick its results are saved", () => {
    expect(terminalCloseDue(closeRuntime({ sockets: { size: 0 } }), 10_001)).toBe(true);
  });

  it("keeps serving stragglers inside the grace, closes past it", () => {
    const full = closeRuntime({ sockets: { size: 2 } });
    expect(terminalCloseDue(full, 10_000 + MATCH_OVER_CLOSE_GRACE_MS)).toBe(false);
    expect(terminalCloseDue(full, 10_000 + MATCH_OVER_CLOSE_GRACE_MS + 1)).toBe(true);
  });

  it("never closes before the save lands or twice", () => {
    expect(terminalCloseDue(closeRuntime({ resultsSavedAtMs: null }), 99_999_999)).toBe(false);
    expect(terminalCloseDue(closeRuntime({ closeRequested: true }), 99_999_999)).toBe(false);
  });
});
