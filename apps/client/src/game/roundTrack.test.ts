import { describe, expect, it } from "vitest";
import { bootTrackRef, needsTrackReload } from "./roundTrack.js";

const WELCOME = { trackId: "welcome-track", trackRevision: 1 };

describe("bootTrackRef", () => {
  it("boots on the Track the Match is on now, not the one the welcome named", () => {
    expect(bootTrackRef(WELCOME, { trackId: "picked", trackRevision: 4 })).toEqual({ trackId: "picked", trackRevision: 4 });
  });

  it("falls back to the welcome when no snapshot has arrived yet", () => {
    expect(bootTrackRef(WELCOME, null)).toEqual(WELCOME);
    expect(bootTrackRef(WELCOME, undefined)).toEqual(WELCOME);
  });

  it("follows a republish of the same Track id", () => {
    expect(bootTrackRef(WELCOME, { trackId: "welcome-track", trackRevision: 2 })).toEqual({
      trackId: "welcome-track",
      trackRevision: 2,
    });
  });
});

describe("needsTrackReload", () => {
  const loaded = { trackId: "t1", trackRevision: 1 };

  it("is false while the loaded Track is the one the snapshot names", () => {
    expect(needsTrackReload(loaded, { trackId: "t1", trackRevision: 1 }, false)).toBe(false);
  });

  it("is true for a different Track, and for a different Revision of the same one", () => {
    expect(needsTrackReload(loaded, { trackId: "t2", trackRevision: 1 }, false)).toBe(true);
    expect(needsTrackReload(loaded, { trackId: "t1", trackRevision: 2 }, false)).toBe(true);
  });

  it("is true outside LOBBY too — a Match's later Rounds change Track inside COUNTDOWN", () => {
    // The old LOBBY-only guard left Round 2 drawing Round 1's Track.
    expect(needsTrackReload(loaded, { trackId: "round-2-track", trackRevision: 7 }, false)).toBe(true);
  });

  it("is false while a reload is already in flight", () => {
    expect(needsTrackReload(loaded, { trackId: "t2", trackRevision: 1 }, true)).toBe(false);
  });
});
