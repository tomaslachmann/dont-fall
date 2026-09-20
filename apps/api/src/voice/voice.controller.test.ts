import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import { createAccountWithPassword, createSession } from "../auth/accounts.dao.js";
import { openDb, type ApiDb } from "../db/db.js";
import type { VoiceHostMessage } from "./voiceMessages.js";
import type { VoiceWorkerLike } from "./voice.service.js";

/**
 * An Account's Mutes over HTTP (ADR 0111), with a fake relay worker in place
 * of the real thread — so the test also says what the relay is told, which is
 * the half that actually stops a voice being heard.
 */

let dir: string;
let db: ApiDb;
let app: FastifyInstance;
let told: VoiceHostMessage[];

/** A worker that only records — it answers `listening` at once and never authenticates anyone. */
const fakeWorker = (sent: VoiceHostMessage[]): VoiceWorkerLike => {
  const listeners = new Map<string, (payload: never) => void>();
  return {
    postMessage: (message) => void sent.push(message),
    on: (event, listener) => {
      listeners.set(event, listener);
      if (event === "message") setTimeout(() => listener({ type: "listening", port: 61999 } as never), 0);
    },
    terminate: vi.fn(),
  };
};

const makeAccount = (name: string): { id: string; token: string } => {
  const account = createAccountWithPassword(db, {
    email: `${name}@example.com`,
    password: "password-123",
    displayName: name,
  });
  return { id: account.id, token: createSession(db, account.id).token };
};

const auth = (token: string): { authorization: string } => ({ authorization: `Bearer ${token}` });

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "api-voice-test-"));
  db = openDb(join(dir, "test.sqlite"));
  told = [];
  app = await buildApp({ db, apiUrl: "http://localhost:8081", voice: { spawn: () => fakeWorker(told) } });
});

afterEach(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("an Account's Mutes", () => {
  it("starts empty and remembers what it is told", async () => {
    const me = makeAccount("mia");
    const them = makeAccount("bo");

    expect((await app.inject({ method: "GET", url: "/voice/mutes", headers: auth(me.token) })).json()).toEqual({ muted: [] });

    const muted = await app.inject({
      method: "PUT",
      url: `/voice/mutes/${them.id}`,
      headers: auth(me.token),
      payload: { muted: true },
    });
    expect(muted.statusCode).toBe(200);
    expect(muted.json()).toEqual({ muted: [them.id] });
    expect((await app.inject({ method: "GET", url: "/voice/mutes", headers: auth(me.token) })).json()).toEqual({
      muted: [them.id],
    });
  });

  it("tells the relay at once, so the voice stops without anything reconnecting", async () => {
    const me = makeAccount("mia");
    const them = makeAccount("bo");
    await app.inject({ method: "PUT", url: `/voice/mutes/${them.id}`, headers: auth(me.token), payload: { muted: true } });

    expect(told).toContainEqual({ type: "mutes", accountId: me.id, muted: [them.id] });
  });

  it("is one Account's own list, never anyone else's", async () => {
    const me = makeAccount("mia");
    const them = makeAccount("bo");
    await app.inject({ method: "PUT", url: `/voice/mutes/${them.id}`, headers: auth(me.token), payload: { muted: true } });

    expect((await app.inject({ method: "GET", url: "/voice/mutes", headers: auth(them.token) })).json()).toEqual({ muted: [] });
  });

  it("unmutes, and takes a repeated mute as the one it already holds", async () => {
    const me = makeAccount("mia");
    const them = makeAccount("bo");
    const mute = { method: "PUT" as const, url: `/voice/mutes/${them.id}`, headers: auth(me.token), payload: { muted: true } };
    await app.inject(mute);
    expect((await app.inject(mute)).json()).toEqual({ muted: [them.id] });

    const unmuted = await app.inject({ ...mute, payload: { muted: false } });
    expect(unmuted.json()).toEqual({ muted: [] });
  });

  it("ignores muting yourself — you never hear yourself anyway", async () => {
    const me = makeAccount("mia");
    const res = await app.inject({ method: "PUT", url: `/voice/mutes/${me.id}`, headers: auth(me.token), payload: { muted: true } });
    expect(res.json()).toEqual({ muted: [] });
  });

  it("refuses a body that does not say which way, and a caller with no session", async () => {
    const me = makeAccount("mia");
    const them = makeAccount("bo");
    const bad = await app.inject({ method: "PUT", url: `/voice/mutes/${them.id}`, headers: auth(me.token), payload: {} });
    expect(bad.statusCode).toBe(400);

    expect((await app.inject({ method: "GET", url: "/voice/mutes" })).statusCode).toBe(401);
  });
});
