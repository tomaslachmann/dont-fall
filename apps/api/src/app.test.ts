import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

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

describe("api shell (ADR 0058)", () => {
  it("answers /health", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("sends CORS headers so a browser-based caller (another origin) isn't blocked", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });

  it("answers an OPTIONS preflight with 204 + CORS headers", async () => {
    const res = await app.inject({
      method: "OPTIONS",
      url: "/tracks",
      headers: { origin: "http://localhost:5173", "access-control-request-method": "POST" },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.headers["access-control-allow-methods"]).toContain("POST");
  });

  it("answers unknown routes with a JSON 404, never an HTML error page", async () => {
    const res = await app.inject({ method: "GET", url: "/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "not found" });
  });

  it("answers malformed JSON with a 400 naming it", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/tracks",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "invalid JSON body" });
  });

  it("answers a wrong method on a known route with the same JSON 404", async () => {
    const res = await app.inject({ method: "DELETE", url: "/health" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "not found" });
  });
});
