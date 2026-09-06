import type { Track } from "@dont-fall/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listTracks, loadTrack, PLAYTEST_TRACK_ID, publishPlaytestTrack, saveTrack } from "./api.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const SAMPLE: Track = [{ moduleId: "start", position: { x: 0, y: 0, z: 0 }, rotation: 0 }];

describe("saveTrack", () => {
  it("POSTs to /tracks and returns the id", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "abc" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await saveTrack("http://x", "my track", SAMPLE, 45_000);

    expect(result).toEqual({ id: "abc" });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://x/tracks",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "my track", track: SAMPLE, timeLimitMs: 45_000 }),
      }),
    );
  });

  it("omits name entirely when blank", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "abc" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await saveTrack("http://x", "", SAMPLE, 45_000);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://x/tracks",
      expect.objectContaining({ body: JSON.stringify({ track: SAMPLE, timeLimitMs: 45_000 }) }),
    );
  });

  it("throws on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "bad" }), { status: 400 })),
    );
    await expect(saveTrack("http://x", "", SAMPLE, 45_000)).rejects.toThrow(/400/);
  });
});

describe("loadTrack", () => {
  it("GETs /tracks/:id and returns the stored Track", async () => {
    const stored = { id: "m1-playground", name: "M1 playground", track: SAMPLE };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(stored), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await loadTrack("http://x", "m1-playground");

    expect(result).toEqual(stored);
    expect(fetchMock).toHaveBeenCalledWith("http://x/tracks/m1-playground");
  });

  it("throws on 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "not found" }), { status: 404 })),
    );
    await expect(loadTrack("http://x", "ghost")).rejects.toThrow(/404/);
  });
});

describe("publishPlaytestTrack (Track Builder Playtest — 'true simulation' grilling session, 2026-09)", () => {
  it("POSTs to /tracks with the fixed reserved id, regardless of what the Track actually is", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: PLAYTEST_TRACK_ID }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await publishPlaytestTrack("http://x", SAMPLE, 45_000);

    expect(result).toEqual({ id: PLAYTEST_TRACK_ID });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://x/tracks",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          id: PLAYTEST_TRACK_ID,
          name: "Track Builder Playtest",
          track: SAMPLE,
          timeLimitMs: 45_000,
        }),
      }),
    );
  });

  it("throws on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "bad" }), { status: 400 })),
    );
    await expect(publishPlaytestTrack("http://x", SAMPLE, 45_000)).rejects.toThrow(/400/);
  });
});

describe("listTracks", () => {
  it("GETs /tracks and returns the listing", async () => {
    const listing = [{ id: "a", name: "A", createdAt: 1 }];
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(listing), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await listTracks("http://x");

    expect(result).toEqual(listing);
    expect(fetchMock).toHaveBeenCalledWith("http://x/tracks");
  });

  it("throws on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    await expect(listTracks("http://x")).rejects.toThrow(/500/);
  });
});
