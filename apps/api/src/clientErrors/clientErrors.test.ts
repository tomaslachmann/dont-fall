import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";

let dir: string;
let app: FastifyInstance;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "api-client-errors-test-"));
  app = await buildApp({ dbPath: join(dir, "test.sqlite"), apiUrl: "http://localhost:8081", maxPlayers: 4, serviceToken: "svc" });
});

afterEach(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("client errors (ADR 0110)", () => {
  it("files a report under its support code, with the Account when signed in, and support reads it back", async () => {
    const signup = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email: "bean@example.com", password: "correct horse battery staple", displayName: "Bean" },
    });
    const { token, account } = signup.json() as { token: string; account: { id: string } };

    const filed = await app.inject({
      method: "POST",
      url: "/client-errors",
      headers: { authorization: `Bearer ${token}` },
      payload: { code: "DF-7K2M-QX", kind: "crash", message: "boom", page: "/play", userAgent: "test" },
    });
    expect(filed.statusCode).toBe(201);

    const read = await app.inject({ method: "GET", url: "/internal/client-errors/DF-7K2M-QX", headers: { "x-service-token": "svc" } });
    expect(read.json()).toMatchObject({ code: "DF-7K2M-QX", kind: "crash", message: "boom", page: "/play", accountId: account.id });
    expect((await app.inject({ method: "GET", url: "/internal/client-errors/DF-7K2M-QX" })).statusCode).toBe(403);
  });

  it("keeps a signed-out report, and refuses a malformed code or kind", async () => {
    const post = (payload: Record<string, unknown>) => app.inject({ method: "POST", url: "/client-errors", payload });
    expect((await post({ code: "DF-AAAA-BB", kind: "connection", message: "closed 1006" })).statusCode).toBe(201);
    expect((await post({ code: "not-a-code", kind: "crash" })).statusCode).toBe(400);
    expect((await post({ code: "DF-AAAA-CC", kind: "exploded" })).statusCode).toBe(400);
  });
});
