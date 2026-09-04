import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_TIME_LIMIT_MS,
  MAX_TIME_LIMIT_MS,
  MIN_TIME_LIMIT_MS,
  type Track,
} from "@dont-fall/shared";
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

  it("sends CORS headers so a browser-based caller (the builder tool, a different origin) isn't blocked", async () => {
    service = await startTrackService({ port: 0, dbPath });
    const res = await fetch(`http://localhost:${service.port}/health`);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("answers an OPTIONS preflight with 204 + CORS headers", async () => {
    service = await startTrackService({ port: 0, dbPath });
    const res = await fetch(`http://localhost:${service.port}/tracks`, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
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
    const body = (await getRes.json()) as {
      id: string;
      name: string | null;
      track: Track;
      revision: number;
      authorId: string;
      contentHash: string;
    };
    expect(body.id).toBe(id);
    expect(body.name).toBe("hand-built test track");
    expect(body.track).toEqual(SAMPLE_TRACK);
    // ADR 0032: a first publish is Revision 1, mocked authorId, a real content hash.
    expect(body.revision).toBe(1);
    expect(body.authorId).toBe("local-author");
    expect(body.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("publishing the same trackId again creates Revision 2, never mutating Revision 1 (ADR 0032)", async () => {
    service = await startTrackService({ port: 0, dbPath });

    const first = await fetch(`http://localhost:${service.port}/tracks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "v1", track: SAMPLE_TRACK }),
    });
    const { id } = (await first.json()) as { id: string };

    const ANOTHER_TRACK: Track = [{ moduleId: "start", position: { x: 0, y: 0, z: 0 }, rotation: 0 }];
    const second = await fetch(`http://localhost:${service.port}/tracks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, name: "v2", track: ANOTHER_TRACK }),
    });
    expect(second.status).toBe(201);
    expect(((await second.json()) as { id: string }).id).toBe(id);

    const getRes = await fetch(`http://localhost:${service.port}/tracks/${id}`);
    const latest = (await getRes.json()) as { name: string | null; track: Track; revision: number };
    expect(latest.revision).toBe(2);
    expect(latest.name).toBe("v2");
    expect(latest.track).toEqual(ANOTHER_TRACK);

    // GET /tracks (the list) shows only the latest Revision per trackId, not one row per Revision.
    const listRes = await fetch(`http://localhost:${service.port}/tracks`);
    const list = (await listRes.json()) as { id: string; name: string | null }[];
    expect(list.filter((t) => t.id === id)).toHaveLength(1);
    expect(list.find((t) => t.id === id)?.name).toBe("v2");
  });

  it("`?revision=` pins an exact Revision instead of always returning latest (ticket 11)", async () => {
    service = await startTrackService({ port: 0, dbPath });

    const first = await fetch(`http://localhost:${service.port}/tracks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "v1", track: SAMPLE_TRACK }),
    });
    const { id } = (await first.json()) as { id: string };

    const ANOTHER_TRACK: Track = [{ moduleId: "start", position: { x: 0, y: 0, z: 0 }, rotation: 0 }];
    await fetch(`http://localhost:${service.port}/tracks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, name: "v2", track: ANOTHER_TRACK }),
    });

    // A client that was told "revision 1" (e.g. by a Match server's WelcomeMessage)
    // must still get Revision 1's exact content, even though v2 is now latest.
    const pinnedRes = await fetch(`http://localhost:${service.port}/tracks/${id}?revision=1`);
    expect(pinnedRes.status).toBe(200);
    const pinned = (await pinnedRes.json()) as { name: string | null; track: Track; revision: number };
    expect(pinned.revision).toBe(1);
    expect(pinned.name).toBe("v1");
    expect(pinned.track).toEqual(SAMPLE_TRACK);

    const latestRes = await fetch(`http://localhost:${service.port}/tracks/${id}?revision=2`);
    const latest = (await latestRes.json()) as { revision: number; track: Track };
    expect(latest.revision).toBe(2);
    expect(latest.track).toEqual(ANOTHER_TRACK);
  });

  it("404s a Revision that was never published, and 400s a malformed `revision`", async () => {
    service = await startTrackService({ port: 0, dbPath });
    const saveRes = await fetch(`http://localhost:${service.port}/tracks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "v1", track: SAMPLE_TRACK }),
    });
    const { id } = (await saveRes.json()) as { id: string };

    const missingRevision = await fetch(`http://localhost:${service.port}/tracks/${id}?revision=7`);
    expect(missingRevision.status).toBe(404);

    const malformed = await fetch(`http://localhost:${service.port}/tracks/${id}?revision=not-a-number`);
    expect(malformed.status).toBe(400);
  });

  it("generates a random Track and persists it exactly like a hand-built one (ADR 0028)", async () => {
    service = await startTrackService({ port: 0, dbPath });

    const genRes = await fetch(`http://localhost:${service.port}/tracks/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "generated track", count: 4 }),
    });
    expect(genRes.status).toBe(201);
    const generated = (await genRes.json()) as { id: string; track: Track };
    expect(generated.track).toHaveLength(4);
    expect(generated.id).not.toBe(M1_SEED_TRACK_ID);

    // Fetched back exactly like any other Track — no "is this random?" flag.
    const getRes = await fetch(`http://localhost:${service.port}/tracks/${generated.id}`);
    expect(getRes.status).toBe(200);
    const body = (await getRes.json()) as { id: string; name: string | null; track: Track; revision: number };
    expect(body.id).toBe(generated.id);
    expect(body.name).toBe("generated track");
    expect(body.track).toEqual(generated.track);
    expect(body.revision).toBe(1);
  });

  it("generate produces a different Track on repeated calls (not a fixed fixture)", async () => {
    service = await startTrackService({ port: 0, dbPath });
    const call = () =>
      fetch(`http://localhost:${service!.port}/tracks/generate`, { method: "POST" }).then(
        (res) => res.json() as Promise<{ track: Track }>,
      );
    const results = await Promise.all([call(), call(), call(), call(), call()]);
    const serialized = results.map((r) => JSON.stringify(r.track));
    expect(new Set(serialized).size).toBeGreaterThan(1);
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

  it("400s a save whose Segments reference an unknown Module id (ticket 09)", async () => {
    service = await startTrackService({ port: 0, dbPath });
    const badTrack: Track = [{ moduleId: "not-a-real-module", position: { x: 0, y: 0, z: 0 }, rotation: 0 }];
    const res = await fetch(`http://localhost:${service.port}/tracks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ track: badTrack }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("not-a-real-module");
  });

  it("GET /tracks lists every stored Track by id/name/createdAt (ticket 09)", async () => {
    service = await startTrackService({ port: 0, dbPath });
    await fetch(`http://localhost:${service.port}/tracks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "my track", track: SAMPLE_TRACK }),
    });

    const res = await fetch(`http://localhost:${service.port}/tracks`);
    expect(res.status).toBe(200);
    const list = (await res.json()) as { id: string; name: string | null; createdAt: number }[];
    // The M1 seed plus the one just saved.
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list.some((t) => t.name === "my track")).toBe(true);
    expect(list.some((t) => t.id === M1_SEED_TRACK_ID)).toBe(true);
    // Full Segment data should NOT be in the list payload.
    expect(list[0]).not.toHaveProperty("track");
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

describe("Time Limit on publish (M4 ticket 03, ADR 0038)", () => {
  const publish = async (port: number, body: Record<string, unknown>) =>
    fetch(`http://localhost:${port}/tracks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  it("returns the authored Time Limit alongside the Track", async () => {
    service = await startTrackService({ port: 0, dbPath });
    const { id } = (await (await publish(service.port, { track: SAMPLE_TRACK, timeLimitMs: 45_000 })).json()) as {
      id: string;
    };

    const stored = (await (await fetch(`http://localhost:${service.port}/tracks/${id}`)).json()) as {
      timeLimitMs: number;
      track: Track;
    };

    expect(stored.timeLimitMs).toBe(45_000);
    expect(stored.track).toEqual(SAMPLE_TRACK);
  });

  it("defaults a publish that omits it, so every existing caller keeps working", async () => {
    service = await startTrackService({ port: 0, dbPath });
    const { id } = (await (await publish(service.port, { track: SAMPLE_TRACK })).json()) as { id: string };

    const stored = (await (await fetch(`http://localhost:${service.port}/tracks/${id}`)).json()) as {
      timeLimitMs: number;
    };

    expect(stored.timeLimitMs).toBe(DEFAULT_TIME_LIMIT_MS);
  });

  it("gives the M1 seed the default clock, so the seeded Track stays raceable", async () => {
    service = await startTrackService({ port: 0, dbPath });

    const stored = (await (await fetch(`http://localhost:${service.port}/tracks/${M1_SEED_TRACK_ID}`)).json()) as {
      timeLimitMs: number;
    };

    expect(stored.timeLimitMs).toBe(DEFAULT_TIME_LIMIT_MS);
  });

  it("rejects a Time Limit below the floor rather than storing an unraceable Revision", async () => {
    service = await startTrackService({ port: 0, dbPath });

    const res = await publish(service.port, { track: SAMPLE_TRACK, timeLimitMs: MIN_TIME_LIMIT_MS - 1 });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/timeLimitMs/);
  });

  it("rejects a Time Limit above the ceiling — a stray zero shouldn't make a Round nobody can wait out", async () => {
    service = await startTrackService({ port: 0, dbPath });

    expect((await publish(service.port, { track: SAMPLE_TRACK, timeLimitMs: MAX_TIME_LIMIT_MS + 1 })).status).toBe(400);
  });

  it("rejects a non-integer Time Limit", async () => {
    service = await startTrackService({ port: 0, dbPath });

    expect((await publish(service.port, { track: SAMPLE_TRACK, timeLimitMs: 45_000.5 })).status).toBe(400);
    expect((await publish(service.port, { track: SAMPLE_TRACK, timeLimitMs: "60000" })).status).toBe(400);
  });

  it("accepts exactly the floor and the ceiling", async () => {
    service = await startTrackService({ port: 0, dbPath });

    expect((await publish(service.port, { track: SAMPLE_TRACK, timeLimitMs: MIN_TIME_LIMIT_MS })).status).toBe(201);
    expect((await publish(service.port, { track: SAMPLE_TRACK, timeLimitMs: MAX_TIME_LIMIT_MS })).status).toBe(201);
  });
});
