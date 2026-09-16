import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { DEFAULT_ENVIRONMENT_ID } from "@dont-fall/shared";
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
