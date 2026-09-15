import { fireEvent, render, screen } from "@testing-library/react";
import { segmentScale } from "@dont-fall/shared";
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
      setImpactTintVisible: vi.fn(),
      frameTrack: vi.fn(),
      setSelected: vi.fn(),
      setGizmoMode: vi.fn(),
      isGizmoActive: () => false,
      pickPartPivot: () => undefined,
      pick: () => undefined,
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
    try {
      render(<TrackBuilderScreen engine={engine} />);

      expect(screen.getByText("Track Builder")).toBeDefined();
      expect(screen.getByText("Core path · 6")).toBeDefined();
      expect(screen.getByText("Pads & surfaces · 7")).toBeDefined();
      expect(screen.getByText("Hazard · 2")).toBeDefined();
      expect(screen.getByText("ONE CLOCK · EVERY MOTION ON THIS TRACK PLAYS AGAINST IT")).toBeDefined();
      expect(screen.getByText("PLAYTEST")).toBeDefined();
      expect(screen.getByText("Empty track")).toBeDefined();

      fireEvent.click(screen.getByText("Bridge"));
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
    }
  });

  it("opens the Assets tab without fetching until the engine is asked", () => {
    const engine = createBuilderEngine();
    try {
      const fetchMock = vi.fn(async () => new Response(new Uint8Array()));
      vi.stubGlobal("fetch", fetchMock);
      render(<TrackBuilderScreen engine={engine} />);

      fireEvent.click(screen.getByText(/ASSETS/));
      expect(engine.assetsLoading).toBe(true);
      expect(fetchMock).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      engine.dispose();
    }
  });
});
