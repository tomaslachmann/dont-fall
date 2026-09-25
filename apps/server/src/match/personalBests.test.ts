import { afterEach, describe, expect, it, vi } from "vitest";
import { TICK_MS } from "@dont-fall/shared";
import { httpPersonalBestRecorder, personalBestRuns } from "./personalBests.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const REPORT = { trackId: "t1", matchId: "m1", runs: [{ accountId: "acc-1", raceTimeMs: 83_300 }] };

describe("httpPersonalBestRecorder", () => {
  it("posts the Round's finished runs to the API's internal endpoint, with the service token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const recorder = httpPersonalBestRecorder("http://api:9999", fetchMock as unknown as typeof fetch, "tok");

    await recorder.recordRuns(REPORT);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe("http://api:9999/internal/personal-bests");
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json", "x-service-token": "tok" },
    });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string)).toEqual(REPORT);
  });

  it("a refused report logs and resolves — the Round never waits on a record", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    const recorder = httpPersonalBestRecorder("http://api:9999", fetchMock as unknown as typeof fetch);

    await expect(recorder.recordRuns(REPORT)).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
  });

  it("a down API logs and resolves", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const recorder = httpPersonalBestRecorder("http://api:9999", (() => Promise.reject(new Error("down"))) as never);

    await expect(recorder.recordRuns(REPORT)).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
  });
});

describe("personalBestRuns (M17 ticket 10, ADR 0129)", () => {
  it("skips a Bot that finished first, and still reports the Player behind it", () => {
    // The Bot crossed the line first: its finish places it, and nothing is kept for it.
    const characters = { bot: { finishTick: 130 }, player: { finishTick: 160 }, stillRunning: { finishTick: null } };
    const accounts: Record<string, string | null> = { bot: null, player: "acc-1", stillRunning: "acc-2" };

    expect(personalBestRuns(characters, (id) => accounts[id], 100)).toEqual([
      { accountId: "acc-1", raceTimeMs: Math.round(60 * TICK_MS) },
    ]);
  });
});
