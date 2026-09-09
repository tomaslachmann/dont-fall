import { readFileSync } from "node:fs";
import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Phase-1 feedback loop for "opening the Assets tab blanks the builder
// viewport (grid and placed Segments gone)". A browser pixel assertion is
// impossible in this sandbox (no WebGL, no loopback, Chrome itself returns
// nothing even for data: URLs), so this loop counts the resource whose
// exhaustion blanks canvases: live WebGL renderers. Chromium holds at most
// 16 active WebGL contexts per page — past that it kills contexts or
// refuses new ones, and a builder that needs more is broken whatever the
// exact eviction looks like on a given machine.

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
// counted separately as VIEWPORT_CONTEXTS below. ----
const viewportStub = {
  setTrack: vi.fn(),
  retransformSegments: vi.fn(),
  render: vi.fn(),
  setSelected: vi.fn(),
  setTransformCallbacks: vi.fn(),
  setGizmoMode: vi.fn(),
  isGizmoActive: (): boolean => false,
  pick: (): number | undefined => 0,
  setSnapIndicator: vi.fn(),
  dispose: vi.fn(),
  canvas: null as unknown as ElStub,
};
vi.mock("./viewport.js", async (importActual) => {
  const actual = await importActual<typeof import("./viewport.js")>();
  return { ...actual, createTrackViewport: () => viewportStub };
});

// ---- Minimal DOM ----
interface ElStub {
  tag: string;
  hidden: boolean;
  disabled: boolean;
  value: string;
  textContent: string | null;
  width: number;
  height: number;
  files: File[];
  classList: { toggle: () => void; add: () => void; remove: () => void };
  children: unknown[];
  addEventListener: (type: string, fn: (event: Record<string, unknown>) => void) => void;
  appendChild: (child: unknown) => unknown;
  replaceChildren: (...kids: unknown[]) => void;
  getContext: (kind: string) => { drawImage: () => void } | null;
  fire: (type: string, event?: Record<string, unknown>) => void;
}

const makeElement = (tag: string): ElStub => {
  const listeners = new Map<string, ((event: Record<string, unknown>) => void)[]>();
  const children: unknown[] = [];
  return {
    tag,
    hidden: false,
    disabled: false,
    value: "",
    textContent: "",
    width: 300,
    height: 150,
    files: [],
    classList: { toggle: () => {}, add: () => {}, remove: () => {} },
    children,
    addEventListener: (type, fn) => {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
    appendChild: (child) => {
      children.push(child);
      return child;
    },
    getContext: (kind) => (kind === "2d" ? { drawImage: () => {} } : null),
    replaceChildren: (...kids) => {
      children.length = 0;
      children.push(...kids);
    },
    fire: (type, event = {}) => {
      for (const fn of listeners.get(type) ?? []) fn({ preventDefault: () => {}, stopPropagation: () => {}, ...event });
    },
  };
};

const elementsById = new Map<string, ElStub>();
const createdElements: ElStub[] = [];
const getElementById = (id: string): ElStub => {
  const existing = elementsById.get(id);
  if (existing) return existing;
  const el = makeElement("div");
  if (id === "service-url") el.value = "http://test";
  elementsById.set(id, el);
  return el;
};

const windowListeners = new Map<string, ((event: Record<string, unknown>) => void)[]>();

const assetsRoot = path.resolve(import.meta.dirname, "../../../assets");

const flush = async (rounds = 10): Promise<void> => {
  for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

beforeEach(() => {
  vi.resetModules();
  liveRenderers = 0;
  elementsById.clear();
  createdElements.length = 0;
  windowListeners.clear();
  viewportStub.setTrack.mockClear();

  (globalThis as Record<string, unknown>).requestAnimationFrame = () => 0;
  (globalThis as Record<string, unknown>).location = { hostname: "test" };
  (globalThis as Record<string, unknown>).window = {
    addEventListener: (type: string, fn: (event: Record<string, unknown>) => void) => {
      windowListeners.set(type, [...(windowListeners.get(type) ?? []), fn]);
    },
    open: vi.fn(),
  };
  (globalThis as Record<string, unknown>).document = {
    getElementById,
    createElement: (tag: string) => {
      const el = makeElement(tag);
      createdElements.push(el);
      return el;
    },
  };
  (globalThis as Record<string, unknown>).fetch = async (url: string): Promise<Response> => {
    if (url.includes("/assets/")) {
      const fileName = url.substring(url.lastIndexOf("/") + 1);
      return new Response(new Uint8Array(readFileSync(path.join(assetsRoot, fileName))));
    }
    if (url.endsWith("/tracks")) return Response.json({ tracks: [] });
    throw new Error(`unexpected fetch ${url}`);
  };
  viewportStub.canvas = makeElement("canvas");
});

const boot = async (): Promise<void> => {
  await import("./main.js");
  await flush();
};

describe("builder live-WebGL-context budget", () => {
  it("shares one thumbnail renderer across all previews — boot, placement and Assets tab open stay flat", async () => {
    await boot();
    // Fifteen procedural palette entries, one shared thumbnail renderer.
    expect(liveRenderers).toBe(1);

    // Place two procedural Segments through real palette entries, select one.
    const palette = getElementById("palette-list");
    const entries = (palette.children as ElStub[]).filter((c) => c.tag === "div");
    expect(entries.length).toBe(15);
    entries[0]!.fire("click");
    entries[0]!.fire("click");
    getElementById("viewport").fire("click", { clientX: 10, clientY: 10, shiftKey: false });

    // Open the Assets tab (fetches real GLBs through the stubbed fetch).
    getElementById("tab-assets").fire("click");
    await flush(20);

    const assetEntries = (getElementById("assets-list").children as ElStub[]).filter((c) => c.tag === "div");
    expect(assetEntries).toHaveLength(4);
    // No new renderer for the four asset previews — the shared one is reused.
    expect(liveRenderers).toBe(1);

    // Placing from the tab reaches the viewport with templates attached
    // (inserted after the selected Segment, so mid-track, not last).
    assetEntries[0]!.fire("click");
    const lastSetTrack = viewportStub.setTrack.mock.calls.at(-1)!;
    expect(lastSetTrack[1].map((s: { moduleId: string }) => s.moduleId)).toContain("platform_straight");
    expect(Object.keys(lastSetTrack[2] ?? {})).toHaveLength(4);

    // The real viewport owns exactly one renderer outside this harness
    // (mocked here); everything else counted above must fit under the
    // browser ceiling (16 active WebGL contexts) alongside it.
    expect(liveRenderers + 1).toBeLessThanOrEqual(16);
  });
});
