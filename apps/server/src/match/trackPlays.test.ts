import { afterEach, describe, expect, it, vi } from "vitest";
import { httpTrackPlayRecorder } from "./trackPlays.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("httpTrackPlayRecorder", () => {
  it("reports the Round's Track to the API's internal played endpoint, with the service token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const recorder = httpTrackPlayRecorder("http://api:9999", fetchMock as unknown as typeof fetch, "tok");

    await recorder.recordPlay("t1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe("http://api:9999/internal/tracks/t1/played");
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json", "x-service-token": "tok" },
    });
  });

  it("a refused report logs and resolves — the Round never waits on a counter", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    const recorder = httpTrackPlayRecorder("http://api:9999", fetchMock as unknown as typeof fetch);

    await expect(recorder.recordPlay("t1")).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
  });

  it("a down API logs and resolves — the Round never waits on a counter", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const recorder = httpTrackPlayRecorder("http://api:9999", (() => Promise.reject(new Error("down"))) as never);

    await expect(recorder.recordPlay("t1")).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
  });
});
