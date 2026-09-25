import type { Track, TrackRoundDefaults } from "@dont-fall/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  listDrafts,
  listTracks,
  loadDraft,
  loadTrack,
  PLAYTEST_TRACK_ID,
  publishPlaytestTrack,
  saveDraft,
  saveTrack,
} from "./api.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const SAMPLE: Track = [{ moduleId: "start", position: { x: 0, y: 0, z: 0 }, rotation: 0 }];
/** Both authored Round defaults a publish carries (M4 ticket 03 / M5 ticket 07). */
const DEFAULTS: TrackRoundDefaults = { timeLimitMs: 45_000, survivorTarget: 3 };

describe("saveTrack", () => {
  it("POSTs to /tracks and returns the id", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "abc" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await saveTrack("http://x", "my track", SAMPLE, DEFAULTS, "sunset");

    expect(result).toEqual({ id: "abc" });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://x/tracks",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "my track", track: SAMPLE, timeLimitMs: 45_000, survivorTarget: 3, environment: "sunset" }),
      }),
    );
  });

  it("omits name entirely when blank", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "abc" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await saveTrack("http://x", "", SAMPLE, DEFAULTS, "day");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://x/tracks",
      expect.objectContaining({ body: JSON.stringify({ track: SAMPLE, timeLimitMs: 45_000, survivorTarget: 3, environment: "day" }) }),
    );
  });

  it("carries the capture's Thumbnail with the publish, and omits the key without one", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "abc" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await saveTrack("http://x", "my track", SAMPLE, DEFAULTS, "day", "data:image/jpeg;base64,aGVsbG8=");
    await saveTrack("http://x", "bare", SAMPLE, DEFAULTS, "day");

    const bodies = (fetchMock.mock.calls as unknown as [string, RequestInit][]).map(([, init]) =>
      JSON.parse(String(init.body)),
    );
    expect(bodies[0]).toMatchObject({ thumbnail: "data:image/jpeg;base64,aGVsbG8=" });
    expect(bodies[1]).not.toHaveProperty("thumbnail");
  });

  it("throws on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "bad" }), { status: 400 })),
    );
    await expect(saveTrack("http://x", "", SAMPLE, DEFAULTS, "day")).rejects.toThrow(/400/);
  });
});

describe("loadTrack", () => {
  it("GETs /tracks/:id and returns the stored Track", async () => {
    const stored = { id: "base-race", name: "Base Race", track: SAMPLE };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(stored), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await loadTrack("http://x", "base-race");

    expect(result).toEqual(stored);
    expect(fetchMock).toHaveBeenCalledWith("http://x/tracks/base-race");
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

    const result = await publishPlaytestTrack("http://x", SAMPLE, DEFAULTS, "night");

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
          survivorTarget: 3,
          environment: "night",
        }),
      }),
    );
  });

  it("throws on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "bad" }), { status: 400 })),
    );
    await expect(publishPlaytestTrack("http://x", SAMPLE, DEFAULTS, "night")).rejects.toThrow(/400/);
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

describe("drafts (ADR 0115)", () => {
  it("lists and loads through the draft endpoints", async () => {
    const fetchMock = vi.fn(async () => Response.json([{ id: "d1", segmentCount: 3 }]));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listDrafts("http://x")).resolves.toEqual([{ id: "d1", segmentCount: 3 }]);
    expect(fetchMock).toHaveBeenCalledWith("http://x/drafts");

    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ id: "d 1", track: SAMPLE })));
    await expect(loadDraft("http://x", "d 1")).resolves.toMatchObject({ track: SAMPLE });
  });

  it("writes Segments before metadata, so a refused patch still leaves the work saved", async () => {
    const seen: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      seen.push(`${init?.method ?? "GET"} ${url}`);
      return Response.json({ id: "d1", name: "Mine", track: SAMPLE, ...DEFAULTS, environment: "day", roundType: "race" });
    });
    vi.stubGlobal("fetch", fetchMock);

    await saveDraft("http://x", "d1", SAMPLE, { name: "Mine", defaults: DEFAULTS, environment: "day" });

    expect(seen).toEqual(["PUT http://x/drafts/d1/segments", "PATCH http://x/drafts/d1"]);
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({ track: SAMPLE });
    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string)).toEqual({
      name: "Mine",
      timeLimitMs: 45_000,
      survivorTarget: 3,
      environment: "day",
    });
  });

  it("untitles a Draft with an explicit null rather than an empty string", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ id: "d1" }));
    vi.stubGlobal("fetch", fetchMock);

    await saveDraft("http://x", "d1", SAMPLE, { name: "", defaults: DEFAULTS, environment: "day" });

    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string)).toMatchObject({ name: null });
  });

  it("names the failing step when the API refuses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));

    await expect(loadDraft("http://x", "gone")).rejects.toThrow(/draft load failed: HTTP 404/);
    await expect(saveDraft("http://x", "gone", SAMPLE, { name: "", defaults: DEFAULTS, environment: "day" }))
      .rejects.toThrow(/draft save failed: HTTP 404/);
  });
});
