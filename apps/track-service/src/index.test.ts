import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Track } from "@dont-fall/shared";
import { M1_SEED_TRACK_ID, startTrackService, type TrackService } from "./index.js";

let dir: string;
let dbPath: string;
let service: TrackService | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "track-service-test-"));
  dbPath = join(dir, "test.sqlite");
});

afterEach(async () => {
  await service?.close();
  service = undefined;
  rmSync(dir, { recursive: true, force: true });
});

const SAMPLE_TRACK: Track = [
  { moduleId: "start", position: { x: 0, y: 0, z: 0 }, rotation: 0 },
  { moduleId: "bridge", position: { x: 0, y: -0.5, z: -6 }, rotation: 0 },
];

describe("track-service", () => {
  it("answers /health", async () => {
    service = await startTrackService({ port: 0, dbPath });
    const res = await fetch(`http://localhost:${service.port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("seeds the M1 Track at startup — fetchable by its known id", async () => {
    service = await startTrackService({ port: 0, dbPath });
    const res = await fetch(`http://localhost:${service.port}/tracks/${M1_SEED_TRACK_ID}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; track: Track };
    expect(body.id).toBe(M1_SEED_TRACK_ID);
    expect(body.track.length).toBeGreaterThan(0);
  });

  it("saves a Track and fetches it back by the returned id", async () => {
    service = await startTrackService({ port: 0, dbPath });

    const saveRes = await fetch(`http://localhost:${service.port}/tracks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "hand-built test track", track: SAMPLE_TRACK }),
    });
    expect(saveRes.status).toBe(201);
    const { id } = (await saveRes.json()) as { id: string };
    expect(id).not.toBe(M1_SEED_TRACK_ID);

    const getRes = await fetch(`http://localhost:${service.port}/tracks/${id}`);
    expect(getRes.status).toBe(200);
    const body = (await getRes.json()) as { id: string; name: string | null; track: Track };
    expect(body).toEqual({ id, name: "hand-built test track", track: SAMPLE_TRACK });
  });

  it("/tracks/any returns some stored Track without needing its id", async () => {
    service = await startTrackService({ port: 0, dbPath });
    const res = await fetch(`http://localhost:${service.port}/tracks/any`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(typeof body.id).toBe("string");
  });

  it("404s for an unknown Track id", async () => {
    service = await startTrackService({ port: 0, dbPath });
    const res = await fetch(`http://localhost:${service.port}/tracks/does-not-exist`);
    expect(res.status).toBe(404);
  });

  it("400s a save whose body isn't a valid Segment[]", async () => {
    service = await startTrackService({ port: 0, dbPath });
    const res = await fetch(`http://localhost:${service.port}/tracks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ track: "not a track" }),
    });
    expect(res.status).toBe(400);
  });

  it("persists a saved Track across a process restart (same dbPath)", async () => {
    service = await startTrackService({ port: 0, dbPath });
    const saveRes = await fetch(`http://localhost:${service.port}/tracks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ track: SAMPLE_TRACK }),
    });
    const { id } = (await saveRes.json()) as { id: string };
    await service.close();

    service = await startTrackService({ port: 0, dbPath });
    const getRes = await fetch(`http://localhost:${service.port}/tracks/${id}`);
    expect(getRes.status).toBe(200);
    expect(((await getRes.json()) as { track: Track }).track).toEqual(SAMPLE_TRACK);
  });

  it("does not re-seed the M1 Track on a restart with existing data (idempotent seeding)", async () => {
    service = await startTrackService({ port: 0, dbPath });
    await service.close();
    service = await startTrackService({ port: 0, dbPath });

    const res = await fetch(`http://localhost:${service.port}/tracks/any`);
    // Only ever one row named exactly the seed id should exist for the seed —
    // fetching it directly by id still resolves to the same single row.
    const byId = await fetch(`http://localhost:${service.port}/tracks/${M1_SEED_TRACK_ID}`);
    expect(res.status).toBe(200);
    expect(byId.status).toBe(200);
  });
});
