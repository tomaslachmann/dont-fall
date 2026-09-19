import { afterEach, describe, expect, it, vi } from "vitest";
import type { TrackListing } from "@dont-fall/shared";
import { forgetPreloadedTrackArt, preloadTrackArt, thumbnailFor } from "./trackArt.js";

const row = (id: string, revision: number, hasThumbnail: boolean): TrackListing => ({
  id,
  name: id,
  authorId: "a1",
  createdAt: 1,
  revision,
  hasThumbnail,
  plays: 0,
  playsThisWeek: 0,
  playsToday: 0,
  hasFinishZone: true,
});

afterEach(() => forgetPreloadedTrackArt());

describe("thumbnailFor (ADR 0105)", () => {
  it("pins a listed Track's picture to its Revision, and has none for a Track without one or not listed", () => {
    const listing = [row("spin-cycle", 3, true), row("bare", 1, false)];
    expect(thumbnailFor(listing, "spin-cycle")).toBe("http://localhost:8081/tracks/spin-cycle/thumbnail?revision=3");
    expect(thumbnailFor(listing, "bare")).toBeUndefined();
    expect(thumbnailFor(listing, "missing")).toBeUndefined();
    expect(thumbnailFor(null, "spin-cycle")).toBeUndefined();
  });
});

describe("preloadTrackArt (ADR 0105)", () => {
  it("loads every listed picture once per visit, and skips Tracks without one", async () => {
    const load = vi.fn(async (_url: string) => undefined);
    const listing = [row("a", 1, true), row("b", 2, true), row("bare", 1, false)];

    await preloadTrackArt(listing, load);
    await preloadTrackArt(listing, load);
    await preloadTrackArt([...listing, row("a", 2, true)], load); // a republish is a new picture

    expect(load.mock.calls.map(([url]) => url)).toEqual([
      "http://localhost:8081/tracks/a/thumbnail?revision=1",
      "http://localhost:8081/tracks/b/thumbnail?revision=2",
      "http://localhost:8081/tracks/a/thumbnail?revision=2",
    ]);
  });

  it("settles only once every picture has, and a failed one never fails the rest", async () => {
    let release!: () => void;
    const slow = new Promise<void>((resolve) => (release = resolve));
    const load = vi.fn((url: string) => (url.includes("/slow/") ? slow : Promise.reject(new Error("404"))));
    let settled = false;

    const done = preloadTrackArt([row("slow", 1, true), row("broken", 1, true)], load).then(() => (settled = true));
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    release();
    await done;
    expect(settled).toBe(true);
  });
});
