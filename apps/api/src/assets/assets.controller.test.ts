import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { defaultAssetsDir } from "./assets.service.js";

let dir: string;
let app: FastifyInstance;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "api-test-"));
  app = await buildApp({ dbPath: join(dir, "test.sqlite") });
});

afterEach(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("assets", () => {
  it("serves a seeded Module GLB with its content type and length", async () => {
    const expected = readFileSync(join(defaultAssetsDir(), "kaykit_floor_wood_2x2.glb"));
    const res = await app.inject({ method: "GET", url: "/assets/kaykit_floor_wood_2x2.glb" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("model/gltf-binary");
    expect(Number(res.headers["content-length"])).toBe(expected.length);
    // `inject` decodes binary bodies to strings, so byte-exactness is pinned
    // one layer down (`assets.service.test.ts`); here the ASCII-safe glTF
    // magic proves the right file is behind the response.
    expect(res.body.slice(0, 4)).toBe("glTF");
  });

  it("serves the shared ice texture with its image content type and length (ADR 0066)", async () => {
    const expected = readFileSync(join(defaultAssetsDir(), "ice_surface.jpg"));
    const res = await app.inject({ method: "GET", url: "/assets/ice_surface.jpg" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/jpeg");
    expect(Number(res.headers["content-length"])).toBe(expected.length);
  });

  it("serves the shared mud texture with its image content type and length (ADR 0067)", async () => {
    const expected = readFileSync(join(defaultAssetsDir(), "mud_surface.jpg"));
    const res = await app.inject({ method: "GET", url: "/assets/mud_surface.jpg" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/jpeg");
    expect(Number(res.headers["content-length"])).toBe(expected.length);
  });

  it("404s a missing file naming it, never an HTML error page", async () => {
    const res = await app.inject({ method: "GET", url: "/assets/does_not_exist.glb" });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: string }).error).toContain("does_not_exist.glb");
  });

  it("400s a path that isn't /assets/<name>.(glb|png|jpg)", async () => {
    expect((await app.inject({ method: "GET", url: "/assets/not-an-asset.txt" })).statusCode).toBe(400);
  });
});
