// @vitest-environment node
// Node, not the jsdom default: the Asset tests below parse real GLBs through
// GLTFLoader, whose texture path needs `URL.createObjectURL`, which jsdom lacks.
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { DEFAULT_ENVIRONMENT_ID, type Track } from "@dont-fall/shared";
import { createTrackLoading } from "./trackLoading.js";

describe("fetchTrack's Environment (ADR 0074)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const serving = (body: Record<string, unknown>): void => {
    vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => ({ track: [], name: "T", ...body }) }) as Response);
  };

  it("hands on the Environment the Revision names", async () => {
    serving({ environment: "sunset" });
    const fetched = await createTrackLoading("example.test").fetchTrack("t", 2);

    expect(fetched).toEqual({ track: [], name: "T", environment: "sunset" });
  });

  it("draws an API older than the field under the default, quietly", async () => {
    serving({});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect((await createTrackLoading("example.test").fetchTrack("t")).environment).toBe(DEFAULT_ENVIRONMENT_ID);
    expect(warn).not.toHaveBeenCalled();
  });

  it("falls back to the default with a dev warning for a preset this build lacks — never an error", async () => {
    serving({ environment: "aurora" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect((await createTrackLoading("example.test").fetchTrack("t")).environment).toBe(DEFAULT_ENVIRONMENT_ID);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("aurora"));
  });
});

describe("loadIceTexture (ADR 0066)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fetches the served texture once per session through the shared bytes pipe", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      seen.push(url);
      return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } as Response;
    });
    const bitmap = {} as ImageBitmap;
    const decode = vi.fn(async () => bitmap);
    vi.stubGlobal("createImageBitmap", decode);
    const { loadIceTexture } = createTrackLoading("example.test");

    const first = await loadIceTexture();
    const second = await loadIceTexture();

    expect(seen).toEqual(["http://example.test:8081/assets/ice_surface.jpg"]);
    expect(first).toBe(second); // session-cached, like the templates
    expect(decode).toHaveBeenCalledTimes(1);
    expect(first).toBeInstanceOf(THREE.Texture);
    expect((first as THREE.Texture).image).toBe(bitmap);
  });

  it("degrades to null with a dev warning when the texture cannot load — a cosmetic never bricks boot", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("GET answered 404");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { loadIceTexture } = createTrackLoading("example.test");

    await expect(loadIceTexture()).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ice overlay unavailable"));
    // ... and the null is cached too — a missing texture warns once, not per reload.
    await loadIceTexture();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("loadMudTexture (ADR 0067)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fetches the served texture once per session through the shared bytes pipe", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      seen.push(url);
      return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } as Response;
    });
    const bitmap = {} as ImageBitmap;
    const decode = vi.fn(async () => bitmap);
    vi.stubGlobal("createImageBitmap", decode);
    const { loadMudTexture } = createTrackLoading("example.test");

    const first = await loadMudTexture();
    const second = await loadMudTexture();

    expect(seen).toEqual(["http://example.test:8081/assets/mud_surface.jpg"]);
    expect(first).toBe(second); // session-cached, like the templates
    expect(decode).toHaveBeenCalledTimes(1);
    expect(first).toBeInstanceOf(THREE.Texture);
    expect((first as THREE.Texture).image).toBe(bitmap);
  });

  it("degrades to null with a dev warning when the texture cannot load — a cosmetic never bricks boot", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("GET answered 404");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { loadMudTexture } = createTrackLoading("example.test");

    await expect(loadMudTexture()).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("mud overlay unavailable"));
    await loadMudTexture();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("fetchStats (M13 ticket 01)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("counts each downloaded file once, with its bytes, and nothing that failed", async () => {
    vi.stubGlobal("fetch", async (url: string) =>
      url.endsWith("mud_surface.jpg")
        ? ({ ok: false, status: 404 } as Response)
        : ({ ok: true, arrayBuffer: async () => new Uint8Array(5).buffer } as Response),
    );
    vi.stubGlobal("createImageBitmap", async () => ({}) as ImageBitmap);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const loading = createTrackLoading("example.test");
    expect(loading.fetchStats()).toEqual({ files: 0, bytes: 0 });

    await loading.loadIceTexture();
    await loading.loadIceTexture();
    await loading.loadMudTexture();

    expect(loading.fetchStats()).toEqual({ files: 1, bytes: 5 });
  });
});

describe("loading only the Track's Assets (memory-footprint ticket 01)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const assetsRoot = path.resolve(import.meta.dirname, "../../../../assets");
  const at = (moduleId: string, z: number): Track[number] => ({ moduleId, position: { x: 0, y: 0, z }, rotation: 0 });
  const TWO_ASSETS: Track = [at("start", 0), at("kaykit_arch_green", 10), at("kaykit_arch_blue", 20), at("kaykit_arch_green", 30)];
  const SWAPPED: Track = [at("kaykit_arch_blue", 0), at("kaykit_arch_red", 10)];

  const servingAssets = (): string[] => {
    // GLTFLoader decodes embedded images through `self.URL` and `createImageBitmap`.
    vi.stubGlobal("self", globalThis);
    vi.stubGlobal("createImageBitmap", async () => ({ width: 4, height: 4, close: () => {} }));
    const requested: string[] = [];
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (url: string) => {
      // The loader's own `blob:` reads of embedded images are not downloads.
      if (url.startsWith("blob:")) return realFetch(url);
      const fileName = url.substring(url.lastIndexOf("/") + 1);
      requested.push(fileName);
      const bytes = readFileSync(path.join(assetsRoot, fileName));
      return { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } as Response;
    });
    return requested;
  };

  it("downloads each placed Asset once for both halves, and nothing else", async () => {
    const requested = servingAssets();
    const loading = createTrackLoading("example.test");

    const [library, templates] = await Promise.all([loading.loadLibrary(TWO_ASSETS), loading.loadVisualTemplates(TWO_ASSETS)]);

    expect(requested.sort()).toEqual(["kaykit_arch_blue.glb", "kaykit_arch_green.glb"]);
    expect(Object.keys(templates).sort()).toEqual(["kaykit_arch_blue", "kaykit_arch_green"]);
    expect(library.kaykit_arch_green?.asset).toBeDefined();
    expect(library.start).toBeDefined();
    expect(loading.fetchStats().files).toBe(2);
  });

  it("downloads only what a swapped-in Track adds, and reuses the templates it has", async () => {
    const requested = servingAssets();
    const loading = createTrackLoading("example.test");
    await loading.loadLibrary(TWO_ASSETS);
    const first = await loading.loadVisualTemplates(TWO_ASSETS);
    requested.length = 0;

    await loading.loadLibrary(SWAPPED);
    const second = await loading.loadVisualTemplates(SWAPPED);

    expect(requested).toEqual(["kaykit_arch_red.glb"]);
    expect(Object.keys(second).sort()).toEqual(["kaykit_arch_blue", "kaykit_arch_red"]);
    expect(second.kaykit_arch_blue).toBe(first.kaykit_arch_blue);
  });

  it("names a file that failed to download, and downloads it again on the next try", async () => {
    let failures = 1;
    const requested = servingAssets();
    const serve = globalThis.fetch;
    vi.stubGlobal("fetch", async (url: string) => {
      if (failures > 0 && !url.startsWith("blob:")) {
        failures -= 1;
        requested.push("failed");
        return { ok: false, status: 503 } as Response;
      }
      return serve(url);
    });
    const loading = createTrackLoading("example.test");
    const track: Track = [at("kaykit_arch_green", 0)];

    await expect(loading.loadLibrary(track)).rejects.toThrow(/kaykit_arch_green.*503/);
    await Promise.all([loading.loadLibrary(track), loading.loadVisualTemplates(track)]);
    expect(requested).toEqual(["failed", "kaykit_arch_green.glb"]);
  });
});
