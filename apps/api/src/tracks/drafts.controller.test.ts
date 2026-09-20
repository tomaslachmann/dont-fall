import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BASE_RACE_TRACK_ID, DEFAULT_TIME_LIMIT_MS, type Track, type TrackDraft } from "@dont-fall/shared";
import { buildApp } from "../app.js";

let dir: string;
let dbPath: string;
let app: FastifyInstance;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "api-test-"));
  dbPath = join(dir, "test.sqlite");
  app = await buildApp({ dbPath, serviceToken: "test-service-token" });
});

afterEach(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const SAMPLE_TRACK: Track = [
  { moduleId: "start", position: { x: 0, y: 0, z: 0 }, rotation: 0 },
  { moduleId: "start", position: { x: 0, y: -0.5, z: -6 }, rotation: 0 },
];

const create = (body: unknown) => app.inject({ method: "POST", url: "/drafts", payload: body as Record<string, unknown> });

describe("drafts", () => {
  it("runs the full lifecycle: create, get, replace, patch, list, discard", async () => {
    const saved = (await create({ name: "half pipe", roundType: "race", track: SAMPLE_TRACK })).json() as {
      id: string;
      created: boolean;
    };
    expect(saved.created).toBe(true);

    const fetched = (await app.inject({ method: "GET", url: `/drafts/${saved.id}` })).json() as TrackDraft;
    expect(fetched).toMatchObject({ id: saved.id, name: "half pipe", roundType: "race", track: SAMPLE_TRACK });
    expect(fetched.timeLimitMs).toBe(DEFAULT_TIME_LIMIT_MS);

    const grown: Track = [...SAMPLE_TRACK, { moduleId: "start", position: { x: 0, y: -1, z: -12 }, rotation: 0 }];
    const replaced = (
      await app.inject({ method: "PUT", url: `/drafts/${saved.id}/segments`, payload: { track: grown } })
    ).json() as TrackDraft;
    expect(replaced.track).toEqual(grown);

    const patched = (
      await app.inject({ method: "PATCH", url: `/drafts/${saved.id}`, payload: { name: "full pipe", roundType: "survival" } })
    ).json() as TrackDraft;
    expect(patched).toMatchObject({ name: "full pipe", roundType: "survival", track: grown });

    const listed = (await app.inject({ method: "GET", url: "/drafts" })).json() as { id: string; segmentCount: number }[];
    expect(listed).toEqual([{ id: saved.id, name: "full pipe", roundType: "survival", segmentCount: 3, updatedAt: patched.updatedAt }]);

    expect((await app.inject({ method: "DELETE", url: `/drafts/${saved.id}` })).json()).toEqual({ id: saved.id });
    expect((await app.inject({ method: "GET", url: `/drafts/${saved.id}` })).statusCode).toBe(404);
  });

  it("creates from an existing Revision, copying its Segments and clock", async () => {
    const saved = (await create({ from: { trackId: BASE_RACE_TRACK_ID } })).json() as { id: string };
    const draft = (await app.inject({ method: "GET", url: `/drafts/${saved.id}` })).json() as TrackDraft;
    const raced = (await app.inject({ method: "GET", url: `/tracks/${BASE_RACE_TRACK_ID}` })).json() as {
      track: Track;
      timeLimitMs: number;
    };
    expect(draft.track).toEqual(raced.track);
    expect(draft.timeLimitMs).toBe(raced.timeLimitMs);
    expect(draft.name).toBeNull();
  });

  it("an explicit id twice resets the draft instead of failing", async () => {
    expect(((await create({ id: "mine", track: SAMPLE_TRACK })).json() as { created: boolean }).created).toBe(true);
    const again = (await create({ id: "mine", track: [] })).json() as { id: string; created: boolean };
    expect(again).toEqual({ id: "mine", created: false });
    expect(((await app.inject({ method: "GET", url: "/drafts/mine" })).json() as TrackDraft).track).toEqual([]);
  });

  it("rejects misshapen Segments and unknown Modules, but never judges the course", async () => {
    expect((await create({ track: [{ moduleId: "start" }] })).statusCode).toBe(400);
    expect((await create({ track: [{ moduleId: "nope", position: { x: 0, y: 0, z: 0 }, rotation: 0 }] })).statusCode).toBe(400);
    expect((await create({ roundType: "royale" })).statusCode).toBe(400);
    // Half-built is the point of a draft: no start, no finish, no checkpoints — still stored.
    expect((await create({ track: [] })).statusCode).toBe(201);
  });

  it("404s naming the miss for unknown drafts on every route", async () => {
    for (const [method, url] of [
      ["GET", "/drafts/ghost"],
      ["PUT", "/drafts/ghost/segments"],
      ["PATCH", "/drafts/ghost"],
      ["DELETE", "/drafts/ghost"],
    ] as const) {
      const res = await app.inject({ method, url, payload: { track: [] } });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'no draft with id "ghost"' });
    }
  });
});
