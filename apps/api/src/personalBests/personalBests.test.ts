import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";

const SERVICE_TOKEN = "test-service-token";

describe("Personal Best routes (ADR 0088)", () => {
  let dir: string;
  let app: FastifyInstance;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "api-personal-best-test-"));
    app = await buildApp({
      dbPath: join(dir, "test.sqlite"),
      apiUrl: "http://localhost:8081",
      maxPlayers: 4,
      serviceToken: SERVICE_TOKEN,
    });
  });

  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const signup = async (email: string): Promise<{ accountId: string; token: string }> => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email, password: "correct horse battery staple", displayName: email.split("@")[0] },
    });
    const { account, token } = res.json() as { account: { id: string }; token: string };
    return { accountId: account.id, token };
  };

  const report = (payload: unknown, token: string | null = SERVICE_TOKEN) =>
    app.inject({
      method: "POST",
      url: "/internal/personal-bests",
      ...(token === null ? {} : { headers: { "x-service-token": token } }),
      payload: payload as Record<string, unknown>,
    });

  const read = (trackId: string, token?: string) =>
    app.inject({
      method: "GET",
      url: `/tracks/${trackId}/personal-best`,
      ...(token === undefined ? {} : { headers: { authorization: `Bearer ${token}` } }),
    });

  it("reads null before any run, then the reported time", async () => {
    const me = await signup("runner@example.com");
    expect((await read("t1", me.token)).json()).toEqual({ bestMs: null });

    const res = await report({ trackId: "t1", matchId: "m1", runs: [{ accountId: me.accountId, raceTimeMs: 83_300 }] });
    expect(res.statusCode).toBe(200);

    expect((await read("t1", me.token)).json()).toEqual({ bestMs: 83_300 });
  });

  it("keeps the fastest run — a slower one never replaces it", async () => {
    const me = await signup("runner@example.com");
    await report({ trackId: "t1", matchId: "m1", runs: [{ accountId: me.accountId, raceTimeMs: 90_000 }] });
    await report({ trackId: "t1", matchId: "m2", runs: [{ accountId: me.accountId, raceTimeMs: 80_000 }] });
    await report({ trackId: "t1", matchId: "m3", runs: [{ accountId: me.accountId, raceTimeMs: 85_000 }] });

    expect((await read("t1", me.token)).json()).toEqual({ bestMs: 80_000 });
  });

  it("keeps a record per Track and per Account — you only ever read your own", async () => {
    const me = await signup("runner@example.com");
    const rival = await signup("rival@example.com");
    await report({
      trackId: "t1",
      matchId: "m1",
      runs: [
        { accountId: me.accountId, raceTimeMs: 70_000 },
        { accountId: rival.accountId, raceTimeMs: 60_000 },
      ],
    });

    expect((await read("t1", me.token)).json()).toEqual({ bestMs: 70_000 });
    expect((await read("t1", rival.token)).json()).toEqual({ bestMs: 60_000 });
    expect((await read("t2", me.token)).json()).toEqual({ bestMs: null });
  });

  it("refuses a report without the service token, and records nothing", async () => {
    const me = await signup("runner@example.com");
    const payload = { trackId: "t1", matchId: "m1", runs: [{ accountId: me.accountId, raceTimeMs: 1 }] };

    expect((await report(payload, null)).statusCode).toBe(403);
    expect((await report(payload, "wrong")).statusCode).toBe(403);
    expect((await read("t1", me.token)).json()).toEqual({ bestMs: null });
  });

  it("refuses a malformed report, naming why", async () => {
    const res = await report({ trackId: "t1", matchId: "m1", runs: [{ accountId: "a", raceTimeMs: -5 }] });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toMatch(/raceTimeMs/);
  });

  it("needs a session to read", async () => {
    expect((await read("t1")).statusCode).toBe(401);
  });
});
