import { afterEach, describe, expect, it, vi } from "vitest";
import { httpMatchResultsNotifier } from "./matchResults.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const RESULT = {
  matchId: "m1",
  results: [{ rows: [{ id: "a", placement: 1, qualified: true }] }],
  roundTrackIds: ["track-1"],
  nicknames: { a: "Ann" },
  accountIds: { a: "acc-1" },
  colors: { a: 2 },
  skins: { a: "tiger" },
  hats: { a: "crown" },
  totalFalls: { a: 2 },
  endedAtMs: 60_000,
};

describe("httpMatchResultsNotifier", () => {
  it("posts the finished Match to the API and reports the landing", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const notifier = httpMatchResultsNotifier(
      "http://api:9999",
      fetchMock as unknown as typeof fetch,
      "service-token",
    );

    await expect(notifier.saveResult(RESULT)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe("http://api:9999/internal/match-results");
    const init = fetchMock.mock.calls[0]![1] as { headers: Record<string, string>; body: string };
    expect(init.headers["x-service-token"]).toBe("service-token");
    expect(JSON.parse(init.body)).toEqual(RESULT);
  });

  it("a refused or unreachable API reports false — the loop retries, never throws", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    const refused = httpMatchResultsNotifier(
      "http://api:9999",
      (async () => ({ ok: false, status: 403 })) as never,
      "wrong-token",
    );
    await expect(refused.saveResult(RESULT)).resolves.toBe(false);

    const down = httpMatchResultsNotifier(
      "http://api:9999",
      (() => Promise.reject(new Error("down"))) as never,
    );
    await expect(down.saveResult(RESULT)).resolves.toBe(false);
    expect(silence).toHaveBeenCalled();
  });
});
