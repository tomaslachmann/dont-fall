import { afterEach, describe, expect, it, vi } from "vitest";
import { createPerfSession } from "./perfSession.js";

const fakeStage = (calls: number) => ({
  domElement: document.createElement("canvas"),
  readRenderStats: (into: { calls: number; triangles: number; geometries: number; textures: number; programs: number }) => {
    into.calls = calls;
    into.triangles = 1000;
    into.geometries = 3;
    into.textures = 2;
    into.programs = 1;
  },
});

const origin = { x: 0, y: 0, z: 0 };

describe("createPerfSession (M13 ticket 01)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("measures the boot to the first frame and reads the live Stage", () => {
    const mount = document.createElement("div");
    let stage = fakeStage(10);
    const session = createPerfSession({
      mount,
      mode: "match",
      bootStartedAt: 1000,
      stage: () => stage,
      trackId: () => "base-race",
      fetchStats: () => ({ files: 33, bytes: 4_900_000 }),
    });
    session.frame(4000, 16, 0.4, 1, 2, origin);
    expect(mount.textContent).toContain("10 calls");

    stage = fakeStage(20); // a Track swap replaced it
    session.trackLoaded(700);
    session.frame(4016, 16, 0.4, 1, 2, origin);

    const summary = window.dontfallPerfSummary!();
    expect(summary.load).toEqual({ bootMs: 3000, lastTrackLoadMs: 700 });
    expect(summary.run.render.calls).toBe(20);
    expect(summary.context).toMatchObject({ mode: "match", trackId: "base-race", assetFiles: 33, assetBytes: 4_900_000 });
    session.dispose();
  });

  it("shows the sound's line, with the drops of the last second (M14 ticket 13)", () => {
    const mount = document.createElement("div");
    let inaudible = 0;
    const session = createPerfSession({
      mount,
      mode: "match",
      bootStartedAt: 0,
      stage: () => fakeStage(1),
      trackId: () => null,
      fetchStats: () => ({ files: 0, bytes: 0 }),
      audio: () => ({ voices: 4, loopsPlaying: 2, inaudible, overCap: 1, decodedBytes: 2 * 1024 * 1024 }),
    });
    session.frame(1000, 16, 0, 1, 1, origin);
    inaudible = 30;
    session.frame(1500, 16, 0, 1, 1, origin);
    expect(mount.textContent).toContain("audio  4 voices · 2 loops · dropped/s 30 quiet, 0 over cap · 2.0 MB decoded");
    session.frame(2600, 16, 0, 1, 1, origin);
    expect(mount.textContent).toContain("dropped/s 0 quiet");
    session.dispose();
  });

  it("logs the summary on the copy key and cleans up after itself", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const mount = document.createElement("div");
    const session = createPerfSession({
      mount,
      mode: "practice",
      bootStartedAt: 0,
      stage: () => fakeStage(1),
      trackId: () => null,
      fetchStats: () => ({ files: 0, bytes: 0 }),
    });
    session.reconcile(1.2, { replayedTicks: 3, corrected: true });
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "F8" }));
    expect(info).toHaveBeenCalledWith(expect.stringContaining('"kind": "dontfall-perf/1"'));

    session.dispose();
    expect(window.dontfallPerfSummary).toBeUndefined();
    expect(mount.childElementCount).toBe(0);
  });
});
