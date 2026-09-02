import type { Track } from "@dont-fall/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadTrack, saveTrack } from "./api.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const SAMPLE: Track = [{ moduleId: "start", position: { x: 0, y: 0, z: 0 }, rotation: 0 }];

describe("saveTrack", () => {
  it("POSTs to /tracks and returns the id", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "abc" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await saveTrack("http://x", "my track", SAMPLE);

    expect(result).toEqual({ id: "abc" });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://x/tracks",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ name: "my track", track: SAMPLE }) }),
    );
  });

  it("omits name entirely when blank", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "abc" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await saveTrack("http://x", "", SAMPLE);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://x/tracks",
      expect.objectContaining({ body: JSON.stringify({ track: SAMPLE }) }),
    );
  });

  it("throws on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "bad" }), { status: 400 })),
    );
    await expect(saveTrack("http://x", "", SAMPLE)).rejects.toThrow(/400/);
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
