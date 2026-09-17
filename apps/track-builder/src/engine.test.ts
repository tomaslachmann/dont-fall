import {
  ASSET_MODULE_DEFS,
  DEFAULT_ENVIRONMENT_ID,
  ENVIRONMENT_PRESETS,
  LAUNCH_HEIGHT_MAX,
  LAUNCH_HEIGHT_MIN,
} from "@dont-fall/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { assetTabModuleIds } from "./assets/assets.js";
import { createBuilderEngine, type BuilderEngine } from "./engine.js";
import { MOVE_STEP_FINE } from "./track/trackEdit.js";
import { triangleGlb } from "./test/glb.js";
import type { TrackViewport } from "./scene/viewport.js";

/** Two plain asset decks — the builder places nothing procedural (ADR 0078). */
const DECK = "kaykit_platform_4x4x1_blue";
const OTHER_DECK = "kaykit_platform_6x6x1_red";

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
  showLaunchArc: vi.fn(),
  setImpactTintVisible: vi.fn(),
  setEnvironment: vi.fn(),
  frameTrack: vi.fn(),
  setSelected: vi.fn(),
  setGizmoMode: vi.fn(),
  isGizmoActive: vi.fn(() => false),
  pickPartPivot: vi.fn(() => undefined),
  pick: vi.fn(() => undefined),
  pickFloor: vi.fn(() => undefined),
  respawnOf: vi.fn(() => undefined),
  setCourseVisible: vi.fn(),
  capturePreview: vi.fn(() => "data:image/jpeg;base64,aGVsbG8="),
  resize: vi.fn(),
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
  // Hermetic by default: no test reaches the real network. Tests that place
  // ice would otherwise fire the engine's lazy texture load at localhost.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }) as Response),
  );
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({})));
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
    engine.placeModule(DECK);
    engine.placeModule(OTHER_DECK);

    expect(engine.track.map((s) => s.moduleId)).toEqual([DECK, OTHER_DECK]);
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
    engine.placeModule(DECK);
    engine.placeModule(OTHER_DECK);
    engine.select(0);
    engine.duplicateSelected();
    expect(engine.track.map((s) => s.moduleId)).toEqual([DECK, DECK, OTHER_DECK]);

    engine.deleteSelected();
    expect(engine.track.map((s) => s.moduleId)).toEqual([DECK, OTHER_DECK]);

    engine.undo();
    expect(engine.track.map((s) => s.moduleId)).toEqual([DECK, DECK, OTHER_DECK]);
    engine.redo();
    expect(engine.track.map((s) => s.moduleId)).toEqual([DECK, OTHER_DECK]);

    engine.removeLast();
    expect(engine.track.map((s) => s.moduleId)).toEqual([DECK]);
    expect(viewport.setTrack).toHaveBeenCalled();
    const lastSetTrack = vi.mocked(viewport.setTrack).mock.calls.at(-1)!;
    expect(lastSetTrack[1].map((s: { moduleId: string }) => s.moduleId)).toEqual([DECK]);
  });

  it("syncs the selection highlight and motion guide on select/toggle", () => {
    engine.attachViewport(document.createElement("div"));
    engine.placeModule(DECK);
    engine.placeModule(OTHER_DECK);
    engine.select(0);
    engine.toggleSelect(1);

    expect(engine.selection).toEqual([0, 1]);
    expect(viewport.setSelected).toHaveBeenLastCalledWith([0, 1]);
    expect(viewport.showMotionGuide).toHaveBeenLastCalledWith(1);
  });

  it("rotate/nudge/scale move the primary through the transform-only path", () => {
    engine.attachViewport(document.createElement("div"));
    engine.placeModule(DECK);
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
    engine.placeModule(DECK);

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
    engine.placeModule(DECK);
    engine.placeModule(OTHER_DECK);
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
    engine.placeModule(DECK);
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

describe("placing onto the last platform (user decision, 2026-09-16)", () => {
  const socketlessPlatform = ASSET_MODULE_DEFS.find((def) => def.category === "platform" && def.sockets.length === 0)!;
  const footprintOf = (moduleId: string) => engine.library[moduleId]!.footprint.bounds;

  it("continues a run flush and stands a gate on the middle of the last platform", () => {
    const deck = socketlessPlatform.id;
    const deckBounds = footprintOf(deck);
    const archBounds = footprintOf("kaykit_arch_blue");

    engine.placeModule(deck);
    engine.placeModule(deck);
    engine.placeModule("kaykit_arch_blue");
    const [first, second, arch] = engine.track;

    // Unturned: the second deck's +Z face meets the first's −Z face, tops level.
    expect(second!.position.z + deckBounds.center.z + deckBounds.halfExtents.z).toBeCloseTo(
      first!.position.z + deckBounds.center.z - deckBounds.halfExtents.z,
      9,
    );
    expect(second!.position.y).toBeCloseTo(first!.position.y, 9);
    // The arch stands on the second deck's top, centred on it.
    expect(arch!.position.x + archBounds.center.x).toBeCloseTo(second!.position.x + deckBounds.center.x, 9);
    expect(arch!.position.z + archBounds.center.z).toBeCloseTo(second!.position.z + deckBounds.center.z, 9);
    expect(arch!.position.y + archBounds.center.y - archBounds.halfExtents.y).toBeCloseTo(
      second!.position.y + deckBounds.center.y + deckBounds.halfExtents.y,
      9,
    );
  });
});

describe("course authoring (ADR 0068)", () => {
  it("makes any piece the Start and moves it on — a Track has one", () => {
    engine.attachViewport(document.createElement("div"));
    engine.placeModule(DECK);
    engine.placeModule("kaykit_floor_wood_2x2");
    engine.select(0);
    engine.setSegmentStart(true);
    expect(engine.course.start).toBe(0);
    engine.select(1);
    engine.setSegmentStart(true);
    expect(engine.track.map((s) => s.start ?? false)).toEqual([false, true]);
    engine.setSegmentStart(false);
    expect(engine.course.start).toBeUndefined();
  });

  it("switches on only hoops and arches as Checkpoints, numbered in the order they're made", () => {
    engine.attachViewport(document.createElement("div"));
    engine.placeModule("kaykit_arch_blue");
    engine.placeModule(DECK);
    engine.placeModule("kaykit_hoop_blue");
    engine.select(1);
    engine.setSegmentCheckpoint(true);
    expect(engine.course.checkpoints).toEqual([]); // a plain deck is no gate
    engine.select(2);
    engine.setSegmentCheckpoint(true);
    engine.select(0);
    engine.setSegmentCheckpoint(true);
    expect(engine.course.checkpoints).toEqual([{ index: 2, order: 1 }, { index: 0, order: 2 }]);
    engine.stepCheckpointOrder(-1);
    expect(engine.course.checkpoints).toEqual([{ index: 0, order: 1 }, { index: 2, order: 2 }]);
    engine.undo();
    expect(engine.course.checkpoints).toEqual([{ index: 2, order: 1 }, { index: 0, order: 2 }]);
  });

  it("picks a respawn spot on a platform in the gate's own frame — never on the gate itself — and Esc cancels", () => {
    engine.attachViewport(document.createElement("div"));
    engine.placeModule("kaykit_arch_blue");
    engine.select(0);
    engine.setSegmentCheckpoint(true);
    const at = engine.track[0]!.position;

    engine.requestRespawnPick();
    expect(engine.pickingRespawn).toBe(true);
    expect(engine.picking).toBe(true);
    vi.mocked(viewport.pickFloor).mockReturnValue({ index: 0, point: at });
    engine.viewportClick(0, 0, false);
    expect(engine.pickingRespawn).toBe(true);
    expect(engine.status).toMatchObject({ kind: "error" });

    vi.mocked(viewport.pickFloor).mockReturnValue({ index: 7, point: { x: at.x + 1, y: at.y, z: at.z + 3 } });
    engine.viewportClick(0, 0, false);
    expect(engine.pickingRespawn).toBe(false);
    expect(engine.track[0]!.checkpoint!.respawn).toEqual({ x: expect.closeTo(1, 9), y: expect.closeTo(0, 9), z: expect.closeTo(3, 9) });

    engine.requestRespawnPick();
    expect(engine.handleKeyDown({ code: "Escape", shiftKey: false, target: null })).toBe(true);
    expect(engine.pickingRespawn).toBe(false);

    engine.resetCheckpointRespawn();
    expect(engine.track[0]!.checkpoint).toEqual({ order: 1 });
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

describe("the Environment (ADR 0074)", () => {
  const defaults = { timeLimitMs: 120000, survivorTarget: 8 };

  const postedBodies = (): Record<string, unknown>[] =>
    (vi.mocked(fetch).mock.calls as unknown as [string, RequestInit | undefined][])
      .filter(([, init]) => init?.method === "POST")
      .map(([, init]) => JSON.parse(String(init!.body)) as Record<string, unknown>);

  it("starts a Draft under the default, with the authoring canvas showing", () => {
    engine.attachViewport(document.createElement("div"));

    expect(engine.environment).toBe(DEFAULT_ENVIRONMENT_ID);
    expect(engine.environmentPreview).toBe(false);
    expect(viewport.setEnvironment).toHaveBeenLastCalledWith(null);
  });

  it("previews the picked Environment, follows a new pick live, and puts the canvas back when turned off", () => {
    engine.attachViewport(document.createElement("div"));

    engine.setEnvironmentPreview(true);
    expect(viewport.setEnvironment).toHaveBeenLastCalledWith(ENVIRONMENT_PRESETS.day);

    engine.setEnvironment("night");
    expect(engine.environment).toBe("night");
    expect(viewport.setEnvironment).toHaveBeenLastCalledWith(ENVIRONMENT_PRESETS.night);

    engine.setEnvironmentPreview(false);
    expect(viewport.setEnvironment).toHaveBeenLastCalledWith(null);
  });

  it("picks without touching the canvas while not previewing", () => {
    engine.attachViewport(document.createElement("div"));
    vi.mocked(viewport.setEnvironment).mockClear();

    engine.setEnvironment("sunset");

    expect(engine.environment).toBe("sunset");
    expect(viewport.setEnvironment).not.toHaveBeenCalled();
  });

  it("keeps previewing across a remount of the viewport", () => {
    engine.setEnvironmentPreview(true);
    engine.setEnvironment("sunset");
    engine.attachViewport(document.createElement("div"));

    expect(viewport.setEnvironment).toHaveBeenLastCalledWith(ENVIRONMENT_PRESETS.sunset);
  });

  it("writes the pick with every save and every playtest", async () => {
    engine.placeModule(DECK);
    engine.setEnvironment("sunset");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ id: "abc" })));
    const realOpen = window.open;
    window.open = (() => null) as unknown as typeof window.open;
    try {
      await engine.saveTrack("Mine", defaults);
      await engine.playtest(defaults);
    } finally {
      window.open = realOpen;
    }

    expect(postedBodies().map((body) => body.environment)).toEqual(["sunset", "sunset"]);
  });

  it("reads the loaded Revision's Environment, and previews it when previewing", async () => {
    engine.attachViewport(document.createElement("div"));
    engine.setEnvironmentPreview(true);
    vi.stubGlobal("fetch", async () =>
      Response.json({ id: "abc", name: "Mine", track: [], timeLimitMs: 60000, survivorTarget: 4, environment: "night" }),
    );

    await engine.loadTrackById("abc");

    expect(engine.environment).toBe("night");
    expect(viewport.setEnvironment).toHaveBeenLastCalledWith(ENVIRONMENT_PRESETS.night);
    expect(engine.status.kind).toBe("ok");
  });

  it("loads a Revision naming a preset this build lacks under the default, and says so", async () => {
    engine.setEnvironment("night");
    vi.stubGlobal("fetch", async () =>
      Response.json({ id: "abc", name: "Mine", track: [], timeLimitMs: 60000, survivorTarget: 4, environment: "aurora" }),
    );

    await engine.loadTrackById("abc");

    expect(engine.environment).toBe(DEFAULT_ENVIRONMENT_ID);
    expect(engine.status.kind).toBe("error");
    expect(engine.status.text).toMatch(/loaded "abc".*aurora/);
  });
});

describe("Thumbnail capture (ADR 0085)", () => {
  const defaults = { timeLimitMs: 120000, survivorTarget: 8 };
  const THUMB = "data:image/jpeg;base64,aGVsbG8=";

  const postedBodies = (): Record<string, unknown>[] =>
    (vi.mocked(fetch).mock.calls as unknown as [string, RequestInit | undefined][])
      .filter(([, init]) => init?.method === "POST")
      .map(([, init]) => JSON.parse(String(init!.body)) as Record<string, unknown>);

  it("refuses to frame an empty Track — there is no map to shoot yet", () => {
    engine.startPreviewCapture("Mine", defaults);

    expect(engine.previewing).toBe(false);
    expect(engine.status).toMatchObject({ kind: "error", text: expect.stringMatching(/empty Track/) as string });
  });

  it("enters with the bare Track and everything on — no selection, no guides, Environment drawn, Motions running", () => {
    engine.attachViewport(document.createElement("div"));
    engine.placeModule(DECK);
    engine.setEnvironment("night");
    engine.setPlaying(false);
    engine.setTintVisible(false);
    vi.mocked(viewport.setEnvironment).mockClear();

    engine.startPreviewCapture("Mine", defaults);

    expect(engine.previewing).toBe(true);
    expect(engine.selection).toEqual([]);
    expect(viewport.setSelected).toHaveBeenLastCalledWith([]);
    expect(viewport.showMotionGuide).toHaveBeenLastCalledWith(undefined);
    expect(viewport.showLaunchArc).toHaveBeenLastCalledWith(undefined);
    expect(viewport.setCourseVisible).toHaveBeenLastCalledWith(false);
    // Everything on: the *authored* Environment (not the default), playing, tinted, framed.
    expect(viewport.setEnvironment).toHaveBeenLastCalledWith(ENVIRONMENT_PRESETS.night);
    expect(engine.playing).toBe(true);
    expect(viewport.setImpactTintVisible).toHaveBeenLastCalledWith(true);
    expect(viewport.frameTrack).toHaveBeenCalled();
  });

  it("never picks while framing — clicks don't select", () => {
    engine.attachViewport(document.createElement("div"));
    engine.placeModule(DECK);
    engine.startPreviewCapture("Mine", defaults);
    vi.mocked(viewport.pick).mockReturnValue(0);

    engine.viewportClick(10, 10, false);

    expect(viewport.pick).not.toHaveBeenCalled();
    expect(engine.selection).toEqual([]);
  });

  it("cancels without saving and puts the authoring view back as it was", () => {
    engine.attachViewport(document.createElement("div"));
    engine.placeModule(DECK);
    engine.setPlaying(false);
    engine.setTintVisible(false);
    engine.startPreviewCapture("Mine", defaults);
    vi.mocked(viewport.setEnvironment).mockClear();

    engine.cancelPreviewCapture();

    expect(engine.previewing).toBe(false);
    expect(engine.playing).toBe(false);
    expect(engine.tintVisible).toBe(false);
    expect(viewport.setEnvironment).toHaveBeenLastCalledWith(null); // the canvas, not the preview
    expect(viewport.setCourseVisible).toHaveBeenLastCalledWith(true);
    expect(viewport.setImpactTintVisible).toHaveBeenLastCalledWith(false);
    expect(postedBodies()).toEqual([]);
  });

  it("cancels on Escape, like every other modal pick in this builder", () => {
    engine.placeModule(DECK);
    engine.startPreviewCapture("Mine", defaults);

    expect(engine.handleKeyDown({ code: "Escape", shiftKey: false, target: null })).toBe(true);
    expect(engine.previewing).toBe(false);
  });

  it("confirms by capturing the view and saving it with the Revision, then leaves capture mode", async () => {
    engine.attachViewport(document.createElement("div"));
    engine.placeModule(DECK);
    vi.mocked(viewport.capturePreview).mockReturnValue(THUMB);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ id: "abc" })));

    engine.startPreviewCapture("  Mine  ", defaults);
    await engine.confirmPreviewCapture();

    expect(viewport.capturePreview).toHaveBeenCalledTimes(1);
    expect(postedBodies()).toEqual([
      expect.objectContaining({ name: "Mine", thumbnail: THUMB, timeLimitMs: 120000, survivorTarget: 8 }),
    ]);
    expect(engine.previewing).toBe(false);
    expect(engine.loadedTrack).toMatchObject({ id: "abc", name: "Mine" });
    expect(engine.status).toMatchObject({ kind: "ok", text: 'saved as "abc"' });
    expect(viewport.setCourseVisible).toHaveBeenLastCalledWith(true);
  });

  it("stays in capture mode when the canvas gives no pixels — the framing survives the retry", async () => {
    engine.attachViewport(document.createElement("div"));
    engine.placeModule(DECK);
    vi.mocked(viewport.capturePreview).mockReturnValue(undefined);

    engine.startPreviewCapture("Mine", defaults);
    await engine.confirmPreviewCapture();

    expect(engine.previewing).toBe(true);
    expect(engine.status.kind).toBe("error");
    expect(postedBodies()).toEqual([]);
  });

  it("re-fits the renderer to the swapped layout on demand — the shell asks once capture mode lands", () => {
    engine.attachViewport(document.createElement("div"));

    engine.resizeViewport();

    expect(viewport.resize).toHaveBeenCalledTimes(1);
  });

  it("stays in capture mode when the save is refused — the author retries instead of starting over", async () => {
    engine.attachViewport(document.createElement("div"));
    engine.placeModule(DECK);
    vi.mocked(viewport.capturePreview).mockReturnValue(THUMB);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 400 })));

    engine.startPreviewCapture("Mine", defaults);
    await engine.confirmPreviewCapture();

    expect(engine.previewing).toBe(true);
    expect(engine.status).toMatchObject({ kind: "error", text: expect.stringMatching(/save failed/) as string });
  });
});

describe("persistence", () => {
  const defaults = { timeLimitMs: 120000, survivorTarget: 8 };

  it("saves, loads and lists through the API with honest statuses", async () => {
    // A fan, not the retired updraft stub: the loaded track must resolve
    // warning-free, or the status below is honestly "error", not "ok".
    engine.placeModule("fan");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/tracks")) return Response.json({ id: "abc" });
        if (url.endsWith("/tracks/abc"))
          return Response.json({
            id: "abc",
            name: "Mine",
            track: [{ moduleId: "fan", position: { x: 0, y: 0, z: 0 }, rotation: 0 }],
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
    expect(engine.track.map((s) => s.moduleId)).toEqual(["fan"]);
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

  it("loading a Track with a Module the builder doesn't know names it, and still loads (ADR 0078)", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.endsWith("/tracks/abc"))
        return Response.json({
          id: "abc",
          name: null,
          track: [
            { moduleId: "ice", position: { x: 0, y: 0, z: 0 }, rotation: 0 },
            { moduleId: DECK, position: { x: 0, y: 0, z: -4 }, rotation: 0 },
          ],
          timeLimitMs: 60000,
          survivorTarget: 4,
        });
      throw new Error(`unexpected fetch ${url}`);
    });

    await engine.loadTrackById("abc");
    expect(engine.track.map((s) => s.moduleId)).toEqual(["ice", DECK]);
    expect(engine.status.kind).toBe("error");
    expect(engine.status.text).toMatch(/1 unknown Module\(s\), not drawn: ice/);
  });

  it("refuses to playtest an empty Track, opens free-roam otherwise", async () => {
    await engine.playtest(defaults);
    expect(engine.status).toMatchObject({ kind: "error" });

    engine.placeModule(DECK);
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
    // Let the background load settle inside this test — left running, its
    // hundreds of fetches land in the next test's fetch mock.
    for (let i = 0; i < 200 && !engine.assetsLoaded; i += 1) await flush(5);
    expect(engine.assetsLoaded).toBe(true);
  });
});

describe("a Spring's height (ADR 0069)", () => {
  // The engine's own library is the real one, so a real Spring Asset id is
  // what proves the def's default reaches the edit — not a hand-made Module.
  const SPRING = "kaykit_spring";

  it("overrides the Asset's default, and clearing goes back to it — a Spring is retuned, never switched off", () => {
    engine.placeModule(SPRING);
    expect(engine.track[0]!.launch).toBeUndefined();

    engine.setSegmentLaunch(7.5);
    expect(engine.track[0]!.launch).toEqual({ height: 7.5 });

    engine.setSegmentLaunch(undefined);
    expect(engine.track[0]!.launch).toBeUndefined();
    // Still a Spring: the Module's own def is what resolves now.
    expect(engine.library[SPRING]?.launch?.height).toBeGreaterThan(0);
  });

  it("clamps a height typed outside the authorable range instead of storing an invalid Track", () => {
    engine.placeModule(SPRING);
    engine.setSegmentLaunch(999);
    expect(engine.track[0]!.launch!.height).toBe(LAUNCH_HEIGHT_MAX);
    engine.setSegmentLaunch(0);
    expect(engine.track[0]!.launch!.height).toBe(LAUNCH_HEIGHT_MIN);
  });

  it("steps by a metre, or a tenth on Shift, from whatever it currently throws", () => {
    engine.placeModule(SPRING);
    const base = engine.library[SPRING]!.launch!.height;
    engine.stepLaunchHeight(-1, false);
    expect(engine.track[0]!.launch!.height).toBeCloseTo(base - 1, 6);
    engine.stepLaunchHeight(1, true);
    expect(engine.track[0]!.launch!.height).toBeCloseTo(base - 0.9, 6);
  });

  it("does nothing on a Segment that is not a Spring", () => {
    engine.placeModule(DECK);
    engine.stepLaunchHeight(1, false);
    expect(engine.track[0]!.launch).toBeUndefined();
  });

  it("is one undoable edit", () => {
    engine.placeModule(SPRING);
    engine.setSegmentLaunch(9);
    engine.undo();
    expect(engine.track[0]!.launch).toBeUndefined();
    engine.redo();
    expect(engine.track[0]!.launch).toEqual({ height: 9 });
  });

  it("is carried by a duplicate, like a belt or a Motion", () => {
    engine.placeModule(SPRING);
    engine.setSegmentLaunch(9);
    engine.duplicateSelected();
    expect(engine.track).toHaveLength(2);
    expect(engine.track[1]!.launch).toEqual({ height: 9 });
  });
});

describe("deck Surface", () => {
  it("swaps ice for mud in one undoable edit — never a Segment carrying both", () => {
    engine.placeModule(DECK);
    engine.setSegmentSurface("ice");
    expect(engine.track[0]!.ice).toBe(true);

    engine.setSegmentSurface("mud");
    // ADR 0067: publish refuses the pair, so the swap may not pass through it.
    expect(engine.track[0]!.ice).toBeUndefined();
    expect(engine.track[0]!.mud).toBe(true);

    // One edit, one undo: back to ice, not to a bare deck.
    engine.undo();
    expect(engine.track[0]!.ice).toBe(true);
    expect(engine.track[0]!.mud).toBeUndefined();
  });

  it("clears both when the deck goes plain", () => {
    engine.placeModule(DECK);
    engine.setSegmentSurface("mud");
    engine.setSegmentSurface(undefined);
    expect(engine.track[0]!.ice).toBeUndefined();
    expect(engine.track[0]!.mud).toBeUndefined();
  });
});

describe("ice texture (ADR 0066)", () => {
  it("loads lazily on the first sync with ice and hands the texture to the viewport", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      seen.push(url);
      return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } as Response;
    });
    engine.attachViewport(document.createElement("div"));
    engine.placeModule(DECK);
    engine.setSegmentSurface("ice");
    await flush();

    expect(seen).toEqual(["http://localhost:8081/assets/ice_surface.jpg"]);
    const lastSetTrack = vi.mocked(viewport.setTrack).mock.calls.at(-1)!;
    expect((lastSetTrack[3] as { ice?: unknown }).ice).toBeInstanceOf(THREE.Texture);
    expect((lastSetTrack[3] as { mud?: unknown }).mud).toBeUndefined();

    // Settled: further syncs reuse it without refetching.
    vi.mocked(viewport.setTrack).mockClear();
    engine.placeModule(DECK);
    await flush();
    expect(seen).toHaveLength(1);
    expect((vi.mocked(viewport.setTrack).mock.calls.at(-1)![3] as { ice?: unknown }).ice).toBeInstanceOf(THREE.Texture);
  });

  it("never fetches for a surface-free Track", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    engine.attachViewport(document.createElement("div"));
    engine.placeModule(DECK);
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(vi.mocked(viewport.setTrack).mock.calls.at(-1)![3]).toEqual({});
  });

  it("warns and retries on the next sync when the load fails — a cosmetic never crashes the builder", async () => {
    let fail = true;
    vi.stubGlobal("fetch", async () => {
      if (fail) throw new Error("GET answered 500");
      return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } as Response;
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    engine.attachViewport(document.createElement("div"));
    engine.placeModule(DECK);
    engine.setSegmentSurface("ice");
    await flush();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ice overlay unavailable"));
    expect((vi.mocked(viewport.setTrack).mock.calls.at(-1)![3] as { ice?: unknown }).ice).toBeUndefined();

    fail = false;
    engine.placeModule(DECK);
    await flush();
    expect((vi.mocked(viewport.setTrack).mock.calls.at(-1)![3] as { ice?: unknown }).ice).toBeInstanceOf(THREE.Texture);
  });
});

describe("mud texture (ADR 0067)", () => {
  it("loads lazily on the first sync with mud and hands the texture to the viewport", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      seen.push(url);
      return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } as Response;
    });
    engine.attachViewport(document.createElement("div"));
    engine.placeModule(DECK);
    engine.setSegmentSurface("mud");
    await flush();

    expect(seen).toEqual(["http://localhost:8081/assets/mud_surface.jpg"]);
    const lastSetTrack = vi.mocked(viewport.setTrack).mock.calls.at(-1)!;
    expect((lastSetTrack[3] as { mud?: unknown }).mud).toBeInstanceOf(THREE.Texture);
    expect((lastSetTrack[3] as { ice?: unknown }).ice).toBeUndefined();

    // Settled: further syncs reuse it without refetching.
    vi.mocked(viewport.setTrack).mockClear();
    engine.placeModule(DECK);
    await flush();
    expect(seen).toHaveLength(1);
    expect((vi.mocked(viewport.setTrack).mock.calls.at(-1)![3] as { mud?: unknown }).mud).toBeInstanceOf(THREE.Texture);
  });

  it("warns and retries on the next sync when the load fails — a cosmetic never crashes the builder", async () => {
    let fail = true;
    vi.stubGlobal("fetch", async () => {
      if (fail) throw new Error("GET answered 500");
      return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } as Response;
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    engine.attachViewport(document.createElement("div"));
    engine.placeModule(DECK);
    engine.setSegmentSurface("mud");
    await flush();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("mud overlay unavailable"));
    expect((vi.mocked(viewport.setTrack).mock.calls.at(-1)![3] as { mud?: unknown }).mud).toBeUndefined();

    fail = false;
    engine.placeModule(DECK);
    await flush();
    expect((vi.mocked(viewport.setTrack).mock.calls.at(-1)![3] as { mud?: unknown }).mud).toBeInstanceOf(THREE.Texture);
  });
});

describe("preview renderer budget", () => {
  it("shares one thumbnail renderer across every tile preview", () => {
    const detaches: (() => void)[] = [];
    for (const moduleId of assetTabModuleIds()) {
      const entry = document.createElement("div");
      const canvas = document.createElement("canvas");
      entry.appendChild(canvas);
      detaches.push(engine.attachPreview(entry, canvas, moduleId));
    }

    // Placing from the tab reaches the viewport with templates attached.
    engine.attachViewport(document.createElement("div"));
    engine.placeModule(DECK);
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
    engine.placeModule(DECK);
    engine.select(0);
    expect(container.hidden).toBe(false);
    engine.select(undefined);
    expect(container.hidden).toBe(true);
    engine.detachMotionPanel();
  });
});
