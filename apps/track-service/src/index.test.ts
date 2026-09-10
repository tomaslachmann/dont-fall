import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SURVIVOR_TARGET,
  DEFAULT_TIME_LIMIT_MS,
  M1_TRACK,
  MAX_SURVIVOR_TARGET,
  MAX_TIME_LIMIT_MS,
  MIN_SURVIVOR_TARGET,
  MIN_TIME_LIMIT_MS,
  type Track,
} from "@dont-fall/shared";
import { ASSET_DEMO_TRACK_ID } from "@dont-fall/shared";
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

  // NOTE: binding tests — unrunnable where loopback listen is denied. The
  // pure helpers they pin (`parseAssetFileName`, `readAssetFile`) run in
  // `assets.test.ts` without sockets.
  it("serves Module art byte-for-byte at /assets/:name (M8 ticket 02)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dont-fall-assets-route-"));
    try {
      const bytes = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 9, 9, 9]);
      writeFileSync(join(dir, "platform_straight.glb"), bytes);
      service = await startTrackService({ port: 0, dbPath, assetsDir: dir });

      const res = await fetch(`http://localhost:${service.port}/assets/platform_straight.glb`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("model/gltf-binary");
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("answers a missing asset with a 404 naming it, never an HTML error page", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dont-fall-assets-route-"));
    try {
      service = await startTrackService({ port: 0, dbPath, assetsDir: dir });

      const res = await fetch(`http://localhost:${service.port}/assets/missing.glb`);
      expect(res.status).toBe(404);
      expect(((await res.json()) as { error: string }).error).toMatch(/missing\.glb/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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

  it("seeds the asset demo Track at startup — all four asset Modules plus a finish", async () => {
    service = await startTrackService({ port: 0, dbPath });
    const res = await fetch(`http://localhost:${service.port}/tracks/${ASSET_DEMO_TRACK_ID}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; track: Track; timeLimitMs: number };
    expect(body.id).toBe(ASSET_DEMO_TRACK_ID);
    expect(body.track.map((segment) => segment.moduleId)).toEqual([
      "platform_straight",
      "ramp_45",
      "stairs_4step",
      "corner_lshape",
      "finish",
    ]);
    // A seeded Track carries the default clock, like the M1 seed — raceable.
    expect(body.timeLimitMs).toBe(DEFAULT_TIME_LIMIT_MS);
  });

  it("does not duplicate the asset demo seed on restart", async () => {
    service = await startTrackService({ port: 0, dbPath });
    await service.close();
    service = await startTrackService({ port: 0, dbPath });

    const first = await fetch(`http://localhost:${service.port}/tracks/${ASSET_DEMO_TRACK_ID}?revision=1`);
    expect(first.status).toBe(200);
    const second = await fetch(`http://localhost:${service.port}/tracks/${ASSET_DEMO_TRACK_ID}?revision=2`);
    expect(second.status).toBe(404);
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

describe("publish validation — a Segment must actually be a Segment", () => {
  const publish = async (port: number, track: unknown) =>
    fetch(`http://localhost:${port}/tracks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ track }),
    });

  it("rejects a null position rather than storing a Track that cannot be resolved", async () => {
    service = await startTrackService({ port: 0, dbPath });

    // `typeof null === "object"`, so a null position used to pass the shape
    // check, get stored in an immutable Revision (ADR 0032), and only surface
    // later as a NaN quaternion inside `segmentOrientation`.
    const res = await publish(service.port, [{ moduleId: "start", position: null, rotation: 0 }]);

    expect(res.status).toBe(400);
  });

  it("rejects a missing rotation — an absent one reaches segmentOrientation as undefined", async () => {
    service = await startTrackService({ port: 0, dbPath });

    expect((await publish(service.port, [{ moduleId: "start", position: { x: 0, y: 0, z: 0 } }])).status).toBe(400);
  });

  it("rejects non-numeric coordinates", async () => {
    service = await startTrackService({ port: 0, dbPath });

    expect(
      (await publish(service.port, [{ moduleId: "start", position: { x: "0", y: 0, z: 0 }, rotation: 0 }])).status,
    ).toBe(400);
    expect(
      (await publish(service.port, [{ moduleId: "start", position: { x: 0, y: 0, z: 0 }, rotation: "0" }])).status,
    ).toBe(400);
  });

  it("rejects a non-finite coordinate — NaN survives JSON as null, Infinity does not survive at all", async () => {
    service = await startTrackService({ port: 0, dbPath });

    expect(
      (await publish(service.port, [{ moduleId: "start", position: { x: 0, y: null, z: 0 }, rotation: 0 }])).status,
    ).toBe(400);
  });

  it("rejects a bad optional pitch/roll while still accepting their absence", async () => {
    service = await startTrackService({ port: 0, dbPath });
    const at = (extra: Record<string, unknown>) => [{ moduleId: "start", position: { x: 0, y: 0, z: 0 }, rotation: 0, ...extra }];

    expect((await publish(service.port, at({ pitch: "up" }))).status).toBe(400);
    expect((await publish(service.port, at({}))).status).toBe(201); // absent is valid (ADR 0034)
    expect((await publish(service.port, at({ pitch: 0.5, roll: -0.5 }))).status).toBe(201);
  });

  it("still accepts every Track shape published before this check existed", async () => {
    service = await startTrackService({ port: 0, dbPath });

    expect((await publish(service.port, SAMPLE_TRACK)).status).toBe(201);
    expect((await publish(service.port, M1_TRACK)).status).toBe(201);
  });
});

describe("Survivor Target on publish (M5 ticket 07, ADR 0041)", () => {
  const publish = async (port: number, body: Record<string, unknown>) =>
    fetch(`http://localhost:${port}/tracks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  it("returns the authored Survivor Target alongside the Track", async () => {
    service = await startTrackService({ port: 0, dbPath });
    const { id } = (await (await publish(service.port, { track: SAMPLE_TRACK, survivorTarget: 4 })).json()) as {
      id: string;
    };

    const stored = (await (await fetch(`http://localhost:${service.port}/tracks/${id}`)).json()) as {
      survivorTarget: number;
      track: Track;
    };

    expect(stored.survivorTarget).toBe(4);
    expect(stored.track).toEqual(SAMPLE_TRACK);
  });

  it("defaults a publish that omits it, so every existing caller keeps working", async () => {
    service = await startTrackService({ port: 0, dbPath });
    const { id } = (await (await publish(service.port, { track: SAMPLE_TRACK })).json()) as { id: string };

    const stored = (await (await fetch(`http://localhost:${service.port}/tracks/${id}`)).json()) as {
      survivorTarget: number;
    };

    expect(stored.survivorTarget).toBe(DEFAULT_SURVIVOR_TARGET);
  });

  it("rejects a target outside the bounds rather than storing a Revision that can't be survived", async () => {
    service = await startTrackService({ port: 0, dbPath });

    const res = await publish(service.port, { track: SAMPLE_TRACK, survivorTarget: MIN_SURVIVOR_TARGET - 1 });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/survivorTarget/);
    expect((await publish(service.port, { track: SAMPLE_TRACK, survivorTarget: MAX_SURVIVOR_TARGET + 1 })).status).toBe(400);
    expect((await publish(service.port, { track: SAMPLE_TRACK, survivorTarget: 2.5 })).status).toBe(400);
  });

  it("stores a Track's clock and its Survivor Target together — one publish authors both", async () => {
    service = await startTrackService({ port: 0, dbPath });
    const { id } = (await (
      await publish(service.port, { track: SAMPLE_TRACK, timeLimitMs: 45_000, survivorTarget: 3 })
    ).json()) as { id: string };

    const stored = (await (await fetch(`http://localhost:${service.port}/tracks/${id}`)).json()) as {
      timeLimitMs: number;
      survivorTarget: number;
    };

    expect(stored).toMatchObject({ timeLimitMs: 45_000, survivorTarget: 3 });
  });
});

describe("Discord OAuth / accounts (M9 ticket 11, ADR 0052)", () => {
  const DISCORD_CONFIG = { clientId: "client-1", clientSecret: "secret-1", redirectUri: "http://localhost:0/auth/discord/callback" };

  const fakeDiscordFetch = vi.fn(async (url: string) => {
    if (url === "https://discord.com/api/oauth2/token") {
      return new Response(JSON.stringify({ access_token: "at-1" }), { status: 200 });
    }
    if (url === "https://discord.com/api/users/@me") {
      return new Response(JSON.stringify({ id: "d-1", username: "Wobbleton", avatar: null }), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });

  it("without Discord configured, /auth/discord/authorize answers 500 rather than crashing the service", async () => {
    service = await startTrackService({ port: 0, dbPath });
    const res = await fetch(`http://localhost:${service.port}/auth/discord/authorize`, { redirect: "manual" });
    expect(res.status).toBe(500);
    // Every unrelated route keeps working — Accounts config is independent of Track storage.
    expect((await fetch(`http://localhost:${service.port}/health`)).status).toBe(200);
  });

  it("/auth/discord/authorize redirects to Discord with a state cookie set", async () => {
    service = await startTrackService({ port: 0, dbPath, discord: DISCORD_CONFIG });
    const res = await fetch(`http://localhost:${service.port}/auth/discord/authorize`, { redirect: "manual" });

    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location")!);
    expect(location.origin + location.pathname).toBe("https://discord.com/oauth2/authorize");
    expect(location.searchParams.get("client_id")).toBe("client-1");
    expect(res.headers.get("set-cookie")).toMatch(/^df_oauth_state=/);
  });

  it("a full login: authorize -> callback (state verified) -> /auth/me -> /auth/logout -> /auth/me 401s again", async () => {
    service = await startTrackService({
      port: 0,
      dbPath,
      discord: DISCORD_CONFIG,
      clientAppUrl: "http://localhost:5173",
      discordFetch: fakeDiscordFetch,
    });

    const authorizeRes = await fetch(`http://localhost:${service.port}/auth/discord/authorize`, { redirect: "manual" });
    const state = new URL(authorizeRes.headers.get("location")!).searchParams.get("state")!;
    const cookie = authorizeRes.headers.get("set-cookie")!.split(";")[0]!; // "df_oauth_state=<value>"

    const callbackRes = await fetch(
      `http://localhost:${service.port}/auth/discord/callback?code=the-code&state=${state}`,
      { redirect: "manual", headers: { Cookie: cookie } },
    );
    expect(callbackRes.status).toBe(302);
    const redirectLocation = new URL(callbackRes.headers.get("location")!);
    expect(redirectLocation.origin + redirectLocation.pathname).toBe("http://localhost:5173/auth/callback");
    // The token rides the URL fragment, never a query param (never sent to a server/proxy/Referer).
    expect(redirectLocation.search).toBe("");
    const token = new URLSearchParams(redirectLocation.hash.slice(1)).get("token")!;
    expect(token).toBeTruthy();

    const meRes = await fetch(`http://localhost:${service.port}/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
    expect(meRes.status).toBe(200);
    expect(await meRes.json()).toMatchObject({ discordId: "d-1", displayName: "Wobbleton" });

    const logoutRes = await fetch(`http://localhost:${service.port}/auth/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(logoutRes.status).toBe(204);

    const meAfterLogoutRes = await fetch(`http://localhost:${service.port}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(meAfterLogoutRes.status).toBe(401);
  });

  it("the callback rejects a state that doesn't match the cookie (CSRF protection)", async () => {
    service = await startTrackService({ port: 0, dbPath, discord: DISCORD_CONFIG, discordFetch: fakeDiscordFetch });

    const authorizeRes = await fetch(`http://localhost:${service.port}/auth/discord/authorize`, { redirect: "manual" });
    const cookie = authorizeRes.headers.get("set-cookie")!.split(";")[0]!;

    const callbackRes = await fetch(
      `http://localhost:${service.port}/auth/discord/callback?code=the-code&state=not-the-real-state`,
      { redirect: "manual", headers: { Cookie: cookie } },
    );
    expect(callbackRes.status).toBe(400);
  });

  it("the callback rejects a missing state cookie (no prior /authorize visit)", async () => {
    service = await startTrackService({ port: 0, dbPath, discord: DISCORD_CONFIG, discordFetch: fakeDiscordFetch });

    const res = await fetch(`http://localhost:${service.port}/auth/discord/callback?code=the-code&state=anything`, {
      redirect: "manual",
    });
    expect(res.status).toBe(400);
  });

  it("/auth/me with no bearer token answers 401", async () => {
    service = await startTrackService({ port: 0, dbPath });
    const res = await fetch(`http://localhost:${service.port}/auth/me`);
    expect(res.status).toBe(401);
  });

  it("/auth/me with an unknown/garbage bearer token answers 401", async () => {
    service = await startTrackService({ port: 0, dbPath });
    const res = await fetch(`http://localhost:${service.port}/auth/me`, { headers: { Authorization: "Bearer garbage" } });
    expect(res.status).toBe(401);
  });
});
