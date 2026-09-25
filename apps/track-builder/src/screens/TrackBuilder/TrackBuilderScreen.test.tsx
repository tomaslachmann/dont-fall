import { act, fireEvent, render, screen } from "@testing-library/react";
import { LAUNCH_HEIGHT_PRESETS, segmentScale } from "@dont-fall/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBuilderEngine } from "../../engine.js";
import { TrackBuilderScreen } from "./TrackBuilderScreen";

// The shell renders around stub islands: no GL (CountingRenderer stands in
// for the thumbnail context), no real viewport scene, real DOM everywhere.
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  class CountingRenderer {
    setSize(): void {}
    render(): void {}
    dispose(): void {}
  }
  return { ...actual, WebGLRenderer: CountingRenderer };
});

vi.mock("../../scene/viewport.js", async (importActual) => {
  const actual = await importActual<typeof import("../../scene/viewport.js")>();
  return {
    ...actual,
    createTrackViewport: () => ({
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
      isGizmoActive: () => false,
      pickPartPivot: () => undefined,
      pick: () => undefined,
      setCourseVisible: vi.fn(),
      capturePreview: () => undefined,
      resize: vi.fn(),
      render: vi.fn(),
      dispose: vi.fn(),
    }),
  };
});

beforeEach(() => {
  // jsdom canvases have no 2D context; the previews only need these two calls.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    (kind: string) => (kind === "2d" ? ({ clearRect: () => {}, drawImage: () => {} }) : null) as never,
  );
});

describe("TrackBuilderScreen", () => {
  it("renders all five regions and places through a real palette row", () => {
    const engine = createBuilderEngine();
    // Hermetic: the Assets tab fires the template load, which must not reach
    // the real network — and the click below lands before that async load
    // settles anyway, because placement never waits for thumbnails.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("hermetic: no network");
      }),
    );
    try {
      render(<TrackBuilderScreen engine={engine} />);

      expect(screen.getByText("Track Builder")).toBeDefined();
      // Assets only (ADR 0078): no procedural tab to switch to.
      expect(screen.queryByRole("tab", { name: /^PROCEDURAL/ })).toBeNull();
      expect(screen.getByText("ONE CLOCK · EVERY MOTION ON THIS TRACK PLAYS AGAINST IT")).toBeDefined();
      expect(screen.getByText("PLAYTEST")).toBeDefined();
      expect(screen.getByText("Empty track")).toBeDefined();

      // Place through a real asset row: the fan, whose field replaced the
      // updraft's — it lists under Launcher, with the Springs (ADR 0122).
      fireEvent.click(screen.getByRole("tab", { name: /^LAUNCHER/ }));
      fireEvent.click(screen.getByText("fan"));
      expect(engine.track).toHaveLength(1);
      expect(screen.queryByText("Empty track")).toBeNull();
      // The inspector mounts for the selection, with the motion editor inside.
      expect(screen.getByText("Selected")).toBeDefined();
      expect(screen.getByText("SPIN → SWING → SLIDE")).toBeDefined();

      // Exact size entry through the stepper commits one undoable edit.
      const size = screen.getByLabelText("size") as HTMLInputElement;
      fireEvent.change(size, { target: { value: "2" } });
      fireEvent.keyDown(size, { key: "Enter" });
      fireEvent.blur(size);
      expect(segmentScale(engine.track[0]!)).toBe(2);

      fireEvent.click(screen.getByText("UNDO"));
      expect(segmentScale(engine.track[0]!)).toBe(1);
      fireEvent.click(screen.getByText("UNDO"));
      expect(engine.track).toHaveLength(0);
    } finally {
      engine.dispose();
      vi.unstubAllGlobals();
    }
  });

  it("picks the Environment in the toolbar and previews it from the viewport (ADR 0074)", () => {
    const engine = createBuilderEngine();
    try {
      render(<TrackBuilderScreen engine={engine} />);

      fireEvent.click(screen.getByRole("tab", { name: "SUNSET" }));
      expect(engine.environment).toBe("sunset");
      expect(screen.getByRole("tab", { name: "SUNSET" }).getAttribute("aria-selected")).toBe("true");

      const preview = screen.getByRole("button", { name: /ENVIRONMENT OFF/ });
      expect(preview.getAttribute("aria-pressed")).toBe("false");
      fireEvent.click(preview);
      expect(engine.environmentPreview).toBe(true);
      expect(screen.getByRole("button", { name: /ENVIRONMENT ON/ }).getAttribute("aria-pressed")).toBe("true");
    } finally {
      engine.dispose();
    }
  });

  it("folds inspector sections, and the folded header still says what they hold", () => {
    const engine = createBuilderEngine();
    try {
      render(<TrackBuilderScreen engine={engine} />);
      // Any segment mounts the inspector — the retired updraft's row is gone,
      // so the fan places programmatically.
      act(() => engine.placeModule("fan"));

      // Four sections, one per panel — the whole inspector is now this list.
      const heads = ["TRANSFORM", "COURSE", "MOTION", "SURFACE"].map((title) =>
        screen.getByRole("button", { name: new RegExp(`^${title}`) }),
      );
      expect(heads.map((h) => h.getAttribute("aria-expanded"))).toEqual(["true", "false", "true", "false"]);

      // Folded: the controls are hidden, never the state they hold.
      const surface = heads[3]!;
      expect(screen.getByText("ATTACH BELT")).not.toBeVisible();
      act(() => {
        engine.setSegmentSurface("ice");
        engine.setSegmentConveyor({ preset: "fast", angle: 0 });
      });
      expect(surface.textContent).toContain("ICE · BELT · FAST");

      fireEvent.click(surface);
      expect(surface.getAttribute("aria-expanded")).toBe("true");
      expect(screen.getByLabelText("detach belt")).toBeVisible();
    } finally {
      engine.dispose();
    }
  });

  it("offers a launch height on a Spring and on nothing else", () => {
    const engine = createBuilderEngine();
    try {
      render(<TrackBuilderScreen engine={engine} />);

      // A non-Spring segment first: the fan lifts, never launches.
      act(() => engine.placeModule("fan"));
      expect(screen.queryByRole("button", { name: /^LAUNCH/ })).toBeNull();

      // A Spring is a shape, not a switch: placing one is all the authoring
      // it needs, and the section shows what it already throws.
      act(() => engine.placeModule("kaykit_spring"));
      const launch = screen.getByRole("button", { name: /^LAUNCH/ });
      const own = engine.library.kaykit_spring!.launch!.height;
      expect(launch.textContent).toContain(`${own} m`);

      fireEvent.click(screen.getByText("LOW"));
      expect(engine.track.at(-1)!.launch).toEqual({ height: LAUNCH_HEIGHT_PRESETS.low });
      expect(launch.textContent).toContain(`${LAUNCH_HEIGHT_PRESETS.low} m`);

      // Clearing returns it to the Asset's own throw, never to no throw.
      fireEvent.click(screen.getByLabelText("reset launch height"));
      expect(engine.track.at(-1)!.launch).toBeUndefined();
      expect(launch.textContent).toContain(`${own} m`);
    } finally {
      engine.dispose();
    }
  });

  it("starts loading the asset templates as soon as the palette mounts — there is no other tab to wait on", () => {
    const engine = createBuilderEngine();
    try {
      const fetchMock = vi.fn(async () => new Response(new Uint8Array()));
      vi.stubGlobal("fetch", fetchMock);
      expect(engine.assetsLoading).toBe(false);
      render(<TrackBuilderScreen engine={engine} />);

      expect(engine.assetsLoading).toBe(true);
      expect(fetchMock).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      engine.dispose();
    }
  });

  it("SAVE frames the Thumbnail fullscreen — chrome hides, the canvas stays mounted, CANCEL puts it all back", () => {
    const engine = createBuilderEngine();
    try {
      render(<TrackBuilderScreen engine={engine} />);
      act(() => engine.placeModule("fan"));
      const detach = vi.spyOn(engine, "detachViewport");

      // SAVE doesn't save anymore — it opens capture mode.
      fireEvent.click(screen.getByText("SAVE"));
      expect(engine.previewing).toBe(true);
      expect(screen.getByRole("button", { name: "CREATE PREVIEW" })).toBeDefined();
      expect(screen.getByRole("button", { name: "CANCEL" })).toBeDefined();
      expect(screen.queryByText("Track Builder")).toBeNull();
      expect(screen.queryByText("PLAYTEST")).toBeNull();
      // The same tree: the Viewport never detached, so the camera survives the switch.
      expect(detach).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "CANCEL" }));
      expect(engine.previewing).toBe(false);
      expect(screen.getByText("SAVE")).toBeDefined();
      expect(screen.getByText("Track Builder")).toBeDefined();
      expect(detach).not.toHaveBeenCalled();
    } finally {
      engine.dispose();
    }
  });

  it("SAVE and CANCEL each re-fit the renderer — the canvas box resizes with no window resize", () => {
    const engine = createBuilderEngine();
    try {
      render(<TrackBuilderScreen engine={engine} />);
      act(() => engine.placeModule("fan"));
      const refit = vi.spyOn(engine, "resizeViewport");

      fireEvent.click(screen.getByText("SAVE"));
      expect(refit).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByRole("button", { name: "CANCEL" }));
      expect(refit).toHaveBeenCalledTimes(2);
    } finally {
      engine.dispose();
    }
  });

  it("a capture that yields no pixels stays in capture mode and says so in the bar", async () => {
    const engine = createBuilderEngine();
    try {
      render(<TrackBuilderScreen engine={engine} />);
      act(() => engine.placeModule("fan"));
      fireEvent.click(screen.getByText("SAVE"));

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "CREATE PREVIEW" }));
      });

      expect(engine.previewing).toBe(true);
      expect(screen.getByText(/capture failed/)).toBeDefined();
    } finally {
      engine.dispose();
    }
  });
});
