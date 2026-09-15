import { MODULE_LIBRARY } from "@dont-fall/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assetTabModuleIds } from "./assets.js";
import { createBuilderEngine, type BuilderEngine } from "./engine.js";
import { MOVE_STEP_FINE } from "./trackEdit.js";
import { triangleGlb } from "./test/glb.js";
import type { TrackViewport } from "./viewport.js";

// ---- Counting WebGLRenderer stand-in (real three otherwise) ----
let liveRenderers = 0;
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  class CountingRenderer {
    constructor() {
      liveRenderers += 1;
    }
    setSize(): void {}
    render(): void {}
    dispose(): void {
      liveRenderers -= 1;
    }
  }
  return { ...actual, WebGLRenderer: CountingRenderer };
});

// ---- Viewport stub (no GL): the real viewport owns exactly one renderer,
// counted separately as +1 in the budget test below. ----
type ViewportStub = { [K in keyof TrackViewport]: TrackViewport[K] };
const makeViewportStub = (): ViewportStub => ({
  setTrack: vi.fn(),
  retransformSegments: vi.fn(),
  setMotionTime: vi.fn(),
  showMotionGuide: vi.fn(),
  setImpactTintVisible: vi.fn(),
  frameTrack: vi.fn(),
  setSelected: vi.fn(),
  setGizmoMode: vi.fn(),
  isGizmoActive: vi.fn(() => false),
  pickPartPivot: vi.fn(() => undefined),
  pick: vi.fn(() => undefined),
  render: vi.fn(),
  dispose: vi.fn(),
});

const flush = async (rounds = 20): Promise<void> => {
  for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

let engine: BuilderEngine;
let viewport: ViewportStub;

beforeEach(() => {
  liveRenderers = 0;
  viewport = makeViewportStub();
  engine = createBuilderEngine({ createViewport: () => viewport });
  // jsdom canvases have no 2D context; the previews only need these two calls.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    (kind: string) => (kind === "2d" ? ({ clearRect: () => {}, drawImage: () => {} }) : null) as never,
  );
});

afterEach(() => {
  engine.dispose();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("edits", () => {
  it("places after the selection (or appends), selects the new Segment, and notifies", () => {
    const heard: number[] = [];
    engine.subscribe(() => heard.push(engine.track.length));
    engine.placeModule("bridge");
    engine.placeModule("ice");

    expect(engine.track.map((s) => s.moduleId)).toEqual(["bridge", "ice"]);
    expect(engine.primary).toBe(1);
    expect(engine.canUndo).toBe(true);
    expect(engine.canRedo).toBe(false);
    expect(heard).toEqual([1, 2]);
    expect(viewport.setTrack).not.toHaveBeenCalled(); // headless: no island attached, no crash
  });

  it("ignores unknown Modules", () => {
    engine.placeModule("nope");
    expect(engine.track).toEqual([]);
  });

  it("duplicate/delete/removeLast/undo/redo round-trip with the viewport in sync", () => {
    engine.attachViewport(document.createElement("div"));
    engine.placeModule("bridge");
    engine.placeModule("ice");
    engine.select(0);
    engine.duplicateSelected();
    expect(engine.track.map((s) => s.moduleId)).toEqual(["bridge", "bridge", "ice"]);

    engine.deleteSelected();
    expect(engine.track.map((s) => s.moduleId)).toEqual(["bridge", "ice"]);

    engine.undo();
    expect(engine.track.map((s) => s.moduleId)).toEqual(["bridge", "bridge", "ice"]);
    engine.redo();
    expect(engine.track.map((s) => s.moduleId)).toEqual(["bridge", "ice"]);

    engine.removeLast();
    expect(engine.track.map((s) => s.moduleId)).toEqual(["bridge"]);
    expect(viewport.setTrack).toHaveBeenCalled();
    const lastSetTrack = vi.mocked(viewport.setTrack).mock.calls.at(-1)!;
    expect(lastSetTrack[1].map((s: { moduleId: string }) => s.moduleId)).toEqual(["bridge"]);
  });

  it("syncs the selection highlight and motion guide on select/toggle", () => {
    engine.attachViewport(document.createElement("div"));
    engine.placeModule("bridge");
    engine.placeModule("ice");
    engine.select(0);
    engine.toggleSelect(1);

    expect(engine.selection).toEqual([0, 1]);
    expect(viewport.setSelected).toHaveBeenLastCalledWith([0, 1]);
    expect(viewport.showMotionGuide).toHaveBeenLastCalledWith(1);
  });

  it("rotate/nudge/scale move the primary through the transform-only path", () => {
    engine.attachViewport(document.createElement("div"));
    engine.placeModule("bridge");
    vi.mocked(viewport.setTrack).mockClear();
    vi.mocked(viewport.retransformSegments).mockClear();
    const before = engine.track[0]!;
    engine.nudgeSelected({ x: 1, y: 0, z: 0 }, false);
    expect(engine.track[0]!.position.x).toBeCloseTo(before.position.x + 0.5, 5);
    engine.rotateSelected90(1);
    engine.stepScale(1, false);
    expect(viewport.retransformSegments).toHaveBeenCalledTimes(3);
    expect(viewport.setTrack).not.toHaveBeenCalled();
  });

  it("forwards gizmo mode and rotate axis to the viewport", () => {
    engine.attachViewport(document.createElement("div"));
    engine.setGizmoMode("rotate");
    engine.setRotateAxis("pitch");
    expect(engine.gizmoMode).toBe("rotate");
    expect(engine.rotateAxis).toBe("pitch");
    expect(viewport.setGizmoMode).toHaveBeenCalledWith("rotate");
  });
});

describe("keyboard", () => {
  it("nudges/rotates/scales the primary, ignores typing targets and empty selection", () => {
    expect(engine.handleKeyDown({ code: "ArrowUp", shiftKey: false, target: null })).toBe(false);
    engine.placeModule("bridge");

    const x = engine.track[0]!.position.x;
    // Shift picks the finer tier, never an unconstrained value.
    expect(engine.handleKeyDown({ code: "ArrowRight", shiftKey: true, target: null })).toBe(true);
    expect(engine.track[0]!.position.x).toBeCloseTo(x + MOVE_STEP_FINE, 5);

    const input = document.createElement("input");
    expect(engine.handleKeyDown({ code: "ArrowRight", shiftKey: false, target: input })).toBe(false);
    expect(engine.track[0]!.position.x).toBeCloseTo(x + MOVE_STEP_FINE, 5);

    expect(engine.handleKeyDown({ code: "BracketRight", shiftKey: false, target: null })).toBe(true);
    expect(engine.handleKeyDown({ code: "Equal", shiftKey: false, target: null })).toBe(true);
    expect(engine.handleKeyDown({ code: "KeyQ", shiftKey: false, target: null })).toBe(false);
  });

  it("Escape cancels a pending pivot pick", () => {
    engine.requestPivotPick(() => {});
    expect(engine.picking).toBe(true);
    expect(engine.handleKeyDown({ code: "Escape", shiftKey: false, target: null })).toBe(true);
    expect(engine.picking).toBe(false);
  });
});

describe("viewport picking", () => {
  it("click selects, shift-click toggles, orbit drags and gizmo grabs never pick", () => {
    engine.attachViewport(document.createElement("div"));
    engine.placeModule("bridge");
    engine.placeModule("ice");
    vi.mocked(viewport.pick).mockReturnValue(1);

    engine.viewportPointerDown(10, 10);
    engine.viewportClick(11, 11, false);
    expect(engine.selection).toEqual([1]);

    engine.viewportPointerDown(10, 10);
    engine.viewportClick(11, 11, true);
    expect(engine.selection).toEqual([]); // toggled off, was the only one
    engine.viewportClick(11, 11, true);
    expect(engine.selection).toEqual([1]);

    engine.viewportPointerDown(10, 10);
    engine.viewportClick(100, 100, false); // an orbit drag ending over a Segment
    expect(engine.selection).toEqual([1]);

    vi.mocked(viewport.isGizmoActive).mockReturnValue(true);
    vi.mocked(viewport.pick).mockReturnValue(0);
    engine.viewportPointerDown(10, 10);
    engine.viewportClick(11, 11, false);
    expect(engine.selection).toEqual([1]); // grabbing a gizmo handle must not deselect
  });

  it("routes clicks to the pending pivot pick, with a miss status on empty space", () => {
    engine.attachViewport(document.createElement("div"));
    engine.placeModule("bridge");
    const applied: { x: number; y: number; z: number }[] = [];
    engine.requestPivotPick((pivot) => applied.push(pivot));

    vi.mocked(viewport.pickPartPivot).mockReturnValue(undefined);
    engine.viewportClick(0, 0, false);
    expect(engine.picking).toBe(true);
    expect(engine.status).toMatchObject({ kind: "error" });

    vi.mocked(viewport.pickPartPivot).mockReturnValue({ x: 1, y: 2, z: 3 });
    engine.viewportClick(0, 0, false);
    expect(engine.picking).toBe(false);
    expect(applied).toEqual([{ x: 1, y: 2, z: 3 }]);
  });
});

describe("motion clock", () => {
  it("advances while playing, freezes on pause/scrub, restarts to zero", () => {
    const ticks: number[] = [];
    engine.subscribeClock(() => ticks.push(engine.clockSeconds));
    engine.frame(1000);
    engine.frame(1100);
    expect(engine.clockSeconds).toBeCloseTo(0.1, 5);

    engine.setPlaying(false);
    engine.frame(1200);
    expect(engine.clockSeconds).toBeCloseTo(0.1, 5);

    engine.setClockSeconds(20);
    expect(engine.playing).toBe(false);
    expect(engine.clockSeconds).toBe(20);

    engine.restartClock();
    expect(engine.clockSeconds).toBe(0);
    expect(ticks.length).toBeGreaterThan(0);
  });

  it("drives the viewport and previews every frame without notifying the shell", () => {
    engine.attachViewport(document.createElement("div"));
    let structural = 0;
    engine.subscribe(() => (structural += 1));
    engine.frame(1000);
    engine.frame(1016);
    expect(viewport.setMotionTime).toHaveBeenCalledTimes(2);
    expect(viewport.render).toHaveBeenCalledTimes(2);
    expect(structural).toBe(0); // the 60 Hz clock must not re-render the shell
  });
});

describe("persistence", () => {
  const defaults = { timeLimitMs: 120000, survivorTarget: 8 };

  it("saves, loads and lists through the API with honest statuses", async () => {
    engine.placeModule("bridge");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/tracks")) return Response.json({ id: "abc" });
        if (url.endsWith("/tracks/abc"))
          return Response.json({
            id: "abc",
            name: "Mine",
            track: [{ moduleId: "ice", position: { x: 0, y: 0, z: 0 }, rotation: 0 }],
            timeLimitMs: 60000,
            survivorTarget: 4,
          });
        throw new Error(`unexpected fetch ${url}`);
      }),
    );

    await engine.saveTrack("Mine", defaults);
    expect(engine.status).toMatchObject({ kind: "ok", text: 'saved as "abc"' });
    expect(engine.loadedTrack).toMatchObject({ id: "abc", name: "Mine" });

    await engine.loadTrackById("abc");
    expect(engine.track.map((s) => s.moduleId)).toEqual(["ice"]);
    expect(engine.loadedTrack).toMatchObject({ id: "abc", name: "Mine", timeLimitMs: 60000, survivorTarget: 4 });
    expect(engine.status.kind).toBe("ok");

    vi.stubGlobal("fetch", vi.fn(async () => Response.json([{ id: "abc", name: "Mine" }])));
    await engine.fetchTrackList();
    expect(engine.browseState).toBe("ready");
    expect(engine.browseTracks).toHaveLength(1);

    vi.stubGlobal("fetch", vi.fn(async () => Response.json([])));
    await engine.fetchTrackList();
    expect(engine.browseState).toBe("empty");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("down");
      }),
    );
    await engine.fetchTrackList();
    expect(engine.browseState).toBe("error");
    expect(engine.status.kind).toBe("error");
  });

  it("refuses to playtest an empty Track, opens free-roam otherwise", async () => {
    await engine.playtest(defaults);
    expect(engine.status).toMatchObject({ kind: "error" });

    engine.placeModule("bridge");
    const opened: string[] = [];
    const realOpen = window.open;
    window.open = ((url: string) => {
      opened.push(url);
      return null;
    }) as unknown as typeof window.open;
    try {
      vi.stubGlobal("fetch", vi.fn(async () => Response.json({ id: "track-builder-playtest" })));
      await engine.playtest(defaults);
    } finally {
      window.open = realOpen;
    }
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatch(/\/play\?track=track-builder-playtest&freeroam=1/);
    expect(engine.status.kind).toBe("ok");
  });
});

describe("asset visuals", () => {
  it("settles every file independently — one bad file never fails the tab", async () => {
    const glb = triangleGlb();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("kaykit_ball.glb")) return new Response(new TextEncoder().encode("not a glb"));
        return new Response(glb as unknown as BodyInit);
      }),
    );

    engine.ensureAssetTemplates();
    expect(engine.assetsLoading).toBe(true);
    for (let i = 0; i < 100 && !engine.assetsLoaded; i += 1) await flush(5);

    expect(engine.assetsLoaded).toBe(true);
    expect(engine.templateFor(assetTabModuleIds()[0]!)).toBeDefined();
    expect(engine.assetError("kaykit_ball")).toMatch(/kaykit_ball/);
    expect(engine.status.kind).toBe("error");

    // A second ensure is a no-op — the tab never refetches a settled set.
    const fetchMock = vi.mocked(globalThis.fetch);
    const calls = fetchMock.mock.calls.length;
    engine.ensureAssetTemplates();
    await flush();
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it("retries a single failed file without touching the settled ones", async () => {
    const glb = triangleGlb();
    let failBall = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (failBall && url.endsWith("kaykit_ball.glb")) throw new Error("GET answered 500");
        return new Response(glb as unknown as BodyInit);
      }),
    );
    engine.ensureAssetTemplates();
    for (let i = 0; i < 100 && !engine.assetsLoaded; i += 1) await flush(5);
    expect(engine.assetError("kaykit_ball")).toBeDefined();

    failBall = false;
    engine.retryAsset("kaykit_ball");
    await flush(10);
    expect(engine.assetError("kaykit_ball")).toBeUndefined();
    expect(engine.templateFor("kaykit_ball")).toBeDefined();
  });

  it("a Track that places asset Segments loads their visuals in the background", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/tracks/abc"))
          return Response.json({
            id: "abc",
            name: null,
            track: [{ moduleId: assetTabModuleIds()[0]!, position: { x: 0, y: 0, z: 0 }, rotation: 0 }],
            timeLimitMs: 60000,
            survivorTarget: 4,
          });
        return new Response(triangleGlb() as unknown as BodyInit);
      }),
    );
    await engine.loadTrackById("abc");
    expect(engine.assetsLoading).toBe(true);
  });
});

describe("preview renderer budget", () => {
  it("shares one thumbnail renderer across every palette and tile preview", () => {
    const detaches: (() => void)[] = [];
    for (const moduleId of Object.keys(MODULE_LIBRARY)) {
      const entry = document.createElement("div");
      const canvas = document.createElement("canvas");
      entry.appendChild(canvas);
      detaches.push(engine.attachPreview(entry, canvas, moduleId));
    }
    for (const moduleId of assetTabModuleIds()) {
      const entry = document.createElement("div");
      const canvas = document.createElement("canvas");
      entry.appendChild(canvas);
      detaches.push(engine.attachPreview(entry, canvas, moduleId));
    }

    // Placing from the tab reaches the viewport with templates attached.
    engine.attachViewport(document.createElement("div"));
    engine.placeModule("bridge");
    engine.placeModule(assetTabModuleIds()[0]!);
    engine.frame(1000);
    engine.frame(1016);
    expect(liveRenderers).toBeLessThanOrEqual(1);
    expect(liveRenderers + 1).toBeLessThanOrEqual(16); // + the real viewport's own context

    for (const detach of detaches) detach();
    engine.frame(1032);
    expect(liveRenderers).toBeLessThanOrEqual(1);
  });

  it("attaching an unknown Module is a detachable no-op", () => {
    const detach = engine.attachPreview(document.createElement("div"), document.createElement("canvas"), "nope");
    expect(() => detach()).not.toThrow();
  });
});

describe("motion panel island", () => {
  it("attaching, selecting and editing through the panel never throws headless", () => {
    const container = document.createElement("div");
    engine.attachMotionPanel(container);
    engine.placeModule("bridge");
    engine.select(0);
    expect(container.hidden).toBe(false);
    engine.select(undefined);
    expect(container.hidden).toBe(true);
    engine.detachMotionPanel();
  });
});
