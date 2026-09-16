import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ASSET_PLACEMENT_MODULES,
  BASE_RACE_TIME_LIMIT_MS,
  BASE_RACE_TRACK,
  BASE_RACE_TRACK_ID,
  DEFAULT_ENVIRONMENT_ID,
  ENVIRONMENT_IDS,
  DEFAULT_SURVIVOR_TARGET,
  DEFAULT_TIME_LIMIT_MS,
  M1_TRACK,
  MAX_SURVIVOR_TARGET,
  MAX_TIME_LIMIT_MS,
  MIN_SURVIVOR_TARGET,
  MIN_TIME_LIMIT_MS,
  type Track,
} from "@dont-fall/shared";
import { buildApp } from "../app.js";

let dir: string;
let dbPath: string;
let app: FastifyInstance;

const SERVICE_TOKEN = "test-service-token";

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "api-test-"));
  dbPath = join(dir, "test.sqlite");
  app = await buildApp({ dbPath, serviceToken: SERVICE_TOKEN });
});

afterEach(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const SAMPLE_TRACK: Track = [
  { moduleId: "start", position: { x: 0, y: 0, z: 0 }, rotation: 0 },
  // Zoneless on purpose (the Discover test below publishes this as its
  // plain row) — the `bridge` ADR 0073 deleted stood here before.
  { moduleId: "start", position: { x: 0, y: -0.5, z: -6 }, rotation: 0 },
];

const publish = (body: unknown) => app.inject({ method: "POST", url: "/tracks", payload: body as Record<string, unknown> });

describe("tracks", () => {
  it("seeds the base race at startup — the one seed, Assets only, on its own clock (ADR 0078)", async () => {
    const res = await app.inject({ method: "GET", url: `/tracks/${BASE_RACE_TRACK_ID}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { id: string; track: Track; timeLimitMs: number };
    expect(body.id).toBe(BASE_RACE_TRACK_ID);
    expect(body.track).toEqual(BASE_RACE_TRACK);
    for (const segment of body.track) expect(ASSET_PLACEMENT_MODULES[segment.moduleId]).toBeDefined();
    expect(body.timeLimitMs).toBe(BASE_RACE_TIME_LIMIT_MS);

    const list = (await app.inject({ method: "GET", url: "/tracks" })).json() as { id: string }[];
    expect(list.map((t) => t.id)).toEqual([BASE_RACE_TRACK_ID]);
  });

  it("does not duplicate the seed on restart", async () => {
    await app.close();
    app = await buildApp({ dbPath });

    const first = await app.inject({ method: "GET", url: `/tracks/${BASE_RACE_TRACK_ID}?revision=1` });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({ method: "GET", url: `/tracks/${BASE_RACE_TRACK_ID}?revision=2` });
    expect(second.statusCode).toBe(404);
  });

  it("saves a Track and fetches it back by the returned id", async () => {
    const saveRes = await publish({ name: "hand-built test track", track: SAMPLE_TRACK });
    expect(saveRes.statusCode).toBe(201);
    const { id } = saveRes.json() as { id: string };
    expect(id).not.toBe(BASE_RACE_TRACK_ID);

    const getRes = await app.inject({ method: "GET", url: `/tracks/${id}` });
    expect(getRes.statusCode).toBe(200);
    const body = getRes.json() as {
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
    const first = await publish({ name: "v1", track: SAMPLE_TRACK });
    const { id } = first.json() as { id: string };

    const ANOTHER_TRACK: Track = [{ moduleId: "start", position: { x: 0, y: 0, z: 0 }, rotation: 0 }];
    const second = await publish({ id, name: "v2", track: ANOTHER_TRACK });
    expect(second.statusCode).toBe(201);
    expect((second.json() as { id: string }).id).toBe(id);

    const latest = (await app.inject({ method: "GET", url: `/tracks/${id}` })).json() as {
      name: string | null;
      track: Track;
      revision: number;
    };
    expect(latest.revision).toBe(2);
    expect(latest.name).toBe("v2");
    expect(latest.track).toEqual(ANOTHER_TRACK);

    // GET /tracks (the list) shows only the latest Revision per trackId, not one row per Revision.
    const list = (await app.inject({ method: "GET", url: "/tracks" })).json() as { id: string; name: string | null }[];
    expect(list.filter((t) => t.id === id)).toHaveLength(1);
    expect(list.find((t) => t.id === id)?.name).toBe("v2");
  });

  it("`?revision=` pins an exact Revision instead of always returning latest (ticket 11)", async () => {
    const { id } = (await publish({ name: "v1", track: SAMPLE_TRACK })).json() as { id: string };
    const ANOTHER_TRACK: Track = [{ moduleId: "start", position: { x: 0, y: 0, z: 0 }, rotation: 0 }];
    await publish({ id, name: "v2", track: ANOTHER_TRACK });

    // A client that was told "revision 1" (e.g. by a Match server's WelcomeMessage)
    // must still get Revision 1's exact content, even though v2 is now latest.
    const pinned = (await app.inject({ method: "GET", url: `/tracks/${id}?revision=1` })).json() as {
      name: string | null;
      track: Track;
      revision: number;
    };
    expect(pinned.revision).toBe(1);
    expect(pinned.name).toBe("v1");
    expect(pinned.track).toEqual(SAMPLE_TRACK);

    const latest = (await app.inject({ method: "GET", url: `/tracks/${id}?revision=2` })).json() as {
      revision: number;
      track: Track;
    };
    expect(latest.revision).toBe(2);
    expect(latest.track).toEqual(ANOTHER_TRACK);
  });

  it("404s a Revision that was never published, and 400s a malformed `revision`", async () => {
    const { id } = (await publish({ name: "v1", track: SAMPLE_TRACK })).json() as { id: string };

    expect((await app.inject({ method: "GET", url: `/tracks/${id}?revision=7` })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/tracks/${id}?revision=not-a-number` })).statusCode).toBe(400);
  });

  it("generates a random Track and persists it exactly like a hand-built one (ADR 0028)", async () => {
    const genRes = await app.inject({ method: "POST", url: "/tracks/generate", payload: { name: "generated track", count: 4 } });
    expect(genRes.statusCode).toBe(201);
    const generated = genRes.json() as { id: string; track: Track };
    expect(generated.track).toHaveLength(4);
    expect(generated.id).not.toBe(BASE_RACE_TRACK_ID);

    // Fetched back exactly like any other Track — no "is this random?" flag.
    const body = (await app.inject({ method: "GET", url: `/tracks/${generated.id}` })).json() as {
      id: string;
      name: string | null;
      track: Track;
      revision: number;
    };
    expect(body.id).toBe(generated.id);
    expect(body.name).toBe("generated track");
    expect(body.track).toEqual(generated.track);
    expect(body.revision).toBe(1);
  });

  it("generate produces a different Track on repeated calls (not a fixed fixture)", async () => {
    const results: { track: Track }[] = [];
    for (let i = 0; i < 5; i += 1) {
      results.push((await app.inject({ method: "POST", url: "/tracks/generate" })).json() as { track: Track });
    }
    expect(new Set(results.map((r) => JSON.stringify(r.track))).size).toBeGreaterThan(1);
  });

  it("/tracks/any returns some stored Track without needing its id", async () => {
    const res = await app.inject({ method: "GET", url: "/tracks/any" });
    expect(res.statusCode).toBe(200);
    expect(typeof (res.json() as { id: string }).id).toBe("string");
  });

  it("404s for an unknown Track id", async () => {
    expect((await app.inject({ method: "GET", url: "/tracks/does-not-exist" })).statusCode).toBe(404);
  });

  it("400s a save whose body isn't a valid Segment[]", async () => {
    expect((await publish({ track: "not a track" })).statusCode).toBe(400);
  });

  it("400s a save whose Segments reference an unknown Module id (ticket 09)", async () => {
    const badTrack: Track = [{ moduleId: "not-a-real-module", position: { x: 0, y: 0, z: 0 }, rotation: 0 }];
    const res = await publish({ track: badTrack });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toContain("not-a-real-module");
  });

  it("GET /tracks lists every stored Track by id/name/createdAt (ticket 09)", async () => {
    await publish({ name: "my track", track: SAMPLE_TRACK });

    const res = await app.inject({ method: "GET", url: "/tracks" });
    expect(res.statusCode).toBe(200);
    const list = res.json() as { id: string; name: string | null; createdAt: number }[];
    // The seed plus the one just saved.
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list.some((t) => t.name === "my track")).toBe(true);
    expect(list.some((t) => t.id === BASE_RACE_TRACK_ID)).toBe(true);
    // Full Segment data should NOT be in the list payload.
    expect(list[0]).not.toHaveProperty("track");
  });

  it("persists a saved Track across a restart (same dbPath)", async () => {
    const { id } = (await publish({ track: SAMPLE_TRACK })).json() as { id: string };
    await app.close();
    app = await buildApp({ dbPath });

    const getRes = await app.inject({ method: "GET", url: `/tracks/${id}` });
    expect(getRes.statusCode).toBe(200);
    expect((getRes.json() as { track: Track }).track).toEqual(SAMPLE_TRACK);
  });

  it("does not re-seed on a restart with existing data (idempotent seeding)", async () => {
    await app.close();
    app = await buildApp({ dbPath });

    expect((await app.inject({ method: "GET", url: "/tracks/any" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/tracks/${BASE_RACE_TRACK_ID}` })).statusCode).toBe(200);
  });
});

describe("Time Limit on publish (M4 ticket 03, ADR 0038)", () => {
  it("returns the authored Time Limit alongside the Track", async () => {
    const { id } = (await publish({ track: SAMPLE_TRACK, timeLimitMs: 45_000 })).json() as { id: string };
    const stored = (await app.inject({ method: "GET", url: `/tracks/${id}` })).json() as {
      timeLimitMs: number;
      track: Track;
    };
    expect(stored.timeLimitMs).toBe(45_000);
    expect(stored.track).toEqual(SAMPLE_TRACK);
  });

  it("defaults a publish that omits it, so every existing caller keeps working", async () => {
    const { id } = (await publish({ track: SAMPLE_TRACK })).json() as { id: string };
    const stored = (await app.inject({ method: "GET", url: `/tracks/${id}` })).json() as { timeLimitMs: number };
    expect(stored.timeLimitMs).toBe(DEFAULT_TIME_LIMIT_MS);
  });

  it("gives the seed its own clock — long enough for the whole race", async () => {
    const stored = (await app.inject({ method: "GET", url: `/tracks/${BASE_RACE_TRACK_ID}` })).json() as {
      timeLimitMs: number;
    };
    expect(stored.timeLimitMs).toBe(BASE_RACE_TIME_LIMIT_MS);
  });

  it("rejects a Time Limit below the floor rather than storing an unraceable Revision", async () => {
    const res = await publish({ track: SAMPLE_TRACK, timeLimitMs: MIN_TIME_LIMIT_MS - 1 });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toMatch(/timeLimitMs/);
  });

  it("rejects a Time Limit above the ceiling — a stray zero shouldn't make a Round nobody can wait out", async () => {
    expect((await publish({ track: SAMPLE_TRACK, timeLimitMs: MAX_TIME_LIMIT_MS + 1 })).statusCode).toBe(400);
  });

  it("rejects a non-integer Time Limit", async () => {
    expect((await publish({ track: SAMPLE_TRACK, timeLimitMs: 45_000.5 })).statusCode).toBe(400);
    expect((await publish({ track: SAMPLE_TRACK, timeLimitMs: "60000" })).statusCode).toBe(400);
  });

  it("accepts exactly the floor and the ceiling", async () => {
    expect((await publish({ track: SAMPLE_TRACK, timeLimitMs: MIN_TIME_LIMIT_MS })).statusCode).toBe(201);
    expect((await publish({ track: SAMPLE_TRACK, timeLimitMs: MAX_TIME_LIMIT_MS })).statusCode).toBe(201);
  });
});

describe("the Environment on publish (M12 ticket 09, ADR 0074)", () => {
  it("returns the authored Environment alongside the Track", async () => {
    const { id } = (await publish({ track: SAMPLE_TRACK, environment: "sunset" })).json() as { id: string };
    const stored = (await app.inject({ method: "GET", url: `/tracks/${id}` })).json() as { environment: string };
    expect(stored.environment).toBe("sunset");
  });

  it("defaults a publish that omits it, and the seeded Tracks, to the default preset", async () => {
    const { id } = (await publish({ track: SAMPLE_TRACK })).json() as { id: string };
    for (const trackId of [id, BASE_RACE_TRACK_ID]) {
      const stored = (await app.inject({ method: "GET", url: `/tracks/${trackId}` })).json() as { environment: string };
      expect(stored.environment).toBe(DEFAULT_ENVIRONMENT_ID);
    }
  });

  it.each(ENVIRONMENT_IDS)("accepts %s", async (environment) => {
    expect((await publish({ track: SAMPLE_TRACK, environment })).statusCode).toBe(201);
  });

  it("refuses a typo with a reason that names the presets there are", async () => {
    const res = await publish({ track: SAMPLE_TRACK, environment: "sunet" });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe(`environment must be one of ${ENVIRONMENT_IDS.join(", ")}`);
  });

  it("refuses anything that is not a preset id at all", async () => {
    for (const environment of [null, 3, "", { id: "day" }]) {
      expect((await publish({ track: SAMPLE_TRACK, environment })).statusCode).toBe(400);
    }
  });
});

describe("publish validation — a Segment must actually be a Segment", () => {
  const publishTrack = (track: unknown) => app.inject({ method: "POST", url: "/tracks", payload: { track } });

  it("rejects a null position rather than storing a Track that cannot be resolved", async () => {
    // `typeof null === "object"`, so a null position used to pass the shape
    // check, get stored in an immutable Revision (ADR 0032), and only surface
    // later as a NaN quaternion inside `segmentOrientation`.
    expect((await publishTrack([{ moduleId: "start", position: null, rotation: 0 }])).statusCode).toBe(400);
  });

  it("rejects a missing rotation — an absent one reaches segmentOrientation as undefined", async () => {
    expect((await publishTrack([{ moduleId: "start", position: { x: 0, y: 0, z: 0 } }])).statusCode).toBe(400);
  });

  it("rejects non-numeric coordinates", async () => {
    expect((await publishTrack([{ moduleId: "start", position: { x: "0", y: 0, z: 0 }, rotation: 0 }])).statusCode).toBe(
      400,
    );
    expect((await publishTrack([{ moduleId: "start", position: { x: 0, y: 0, z: 0 }, rotation: "0" }])).statusCode).toBe(
      400,
    );
  });

  it("rejects a non-finite coordinate — NaN survives JSON as null, Infinity does not survive at all", async () => {
    expect((await publishTrack([{ moduleId: "start", position: { x: 0, y: null, z: 0 }, rotation: 0 }])).statusCode).toBe(
      400,
    );
  });

  it("rejects a bad optional pitch/roll while still accepting their absence", async () => {
    const at = (extra: Record<string, unknown>) => [{ moduleId: "start", position: { x: 0, y: 0, z: 0 }, rotation: 0, ...extra }];
    expect((await publishTrack(at({ pitch: "up" }))).statusCode).toBe(400);
    expect((await publishTrack(at({}))).statusCode).toBe(201); // absent is valid (ADR 0034)
    expect((await publishTrack(at({ pitch: 0.5, roll: -0.5 }))).statusCode).toBe(201);
  });

  it("stores a Segment Motion and refuses one that would not move sanely (ADR 0061)", async () => {
    const at = (extra: Record<string, unknown>) => [{ moduleId: "start", position: { x: 0, y: 0, z: 0 }, rotation: 0, ...extra }];
    const slide = { offset: { x: 0, y: 2, z: 0 }, period: 3, easing: "easeInOut", pause: 0.5 };
    expect((await publishTrack(at({ motion: { slide } }))).statusCode).toBe(201);
    const refused = await publishTrack(at({ motion: { slide: { ...slide, period: 1 } } }));
    expect(refused.statusCode).toBe(400);
    expect(refused.body).toMatch(/track\[0\]\.motion\.slide\.period/);
  });

  it("stores a Segment Conveyor and refuses one with an unknown preset or a non-finite angle (ADR 0064)", async () => {
    const at = (extra: Record<string, unknown>) => [{ moduleId: "start", position: { x: 0, y: 0, z: 0 }, rotation: 0, ...extra }];
    expect((await publishTrack(at({ conveyor: { preset: "medium", angle: 1.2 } }))).statusCode).toBe(201);
    const badPreset = await publishTrack(at({ conveyor: { preset: "turbo", angle: 0 } }));
    expect(badPreset.statusCode).toBe(400);
    expect(badPreset.body).toMatch(/track\[0\]\.conveyor\.preset/);
    const badAngle = await publishTrack(at({ conveyor: { preset: "fast", angle: "north" } }));
    expect(badAngle.statusCode).toBe(400);
    expect(badAngle.body).toMatch(/track\[0\]\.conveyor\.angle/);
  });

  it("stores Segment ice and refuses anything but exactly true (ADR 0066)", async () => {
    const at = (extra: Record<string, unknown>) => [{ moduleId: "start", position: { x: 0, y: 0, z: 0 }, rotation: 0, ...extra }];
    expect((await publishTrack(at({ ice: true }))).statusCode).toBe(201);
    const bad = await publishTrack(at({ ice: "yes" }));
    expect(bad.statusCode).toBe(400);
    expect(bad.body).toMatch(/track\[0\]\.ice must be true/);
  });

  it("stores Segment mud, refuses anything but exactly true, and refuses an ice+mud pair (ADR 0067)", async () => {
    const at = (extra: Record<string, unknown>) => [{ moduleId: "start", position: { x: 0, y: 0, z: 0 }, rotation: 0, ...extra }];
    expect((await publishTrack(at({ mud: true }))).statusCode).toBe(201);
    const bad = await publishTrack(at({ mud: "yes" }));
    expect(bad.statusCode).toBe(400);
    expect(bad.body).toMatch(/track\[0\]\.mud must be true/);
    const conflict = await publishTrack(at({ ice: true, mud: true }));
    expect(conflict.statusCode).toBe(400);
    expect(conflict.body).toMatch(/track\[0\]\.ice and mud are mutually exclusive/);
  });

  it("stores Segment bounce, refuses anything but exactly true, and refuses it paired with ice or mud (ADR 0070)", async () => {
    const at = (extra: Record<string, unknown>) => [{ moduleId: "start", position: { x: 0, y: 0, z: 0 }, rotation: 0, ...extra }];
    expect((await publishTrack(at({ bounce: true }))).statusCode).toBe(201);
    const bad = await publishTrack(at({ bounce: "yes" }));
    expect(bad.statusCode).toBe(400);
    expect(bad.body).toMatch(/track\[0\]\.bounce must be true/);

    // One deck, one Surface — the rule now covers every pair, not just the
    // original ice+mud one.
    for (const pair of [{ ice: true, bounce: true }, { mud: true, bounce: true }, { ice: true, mud: true, bounce: true }]) {
      const conflict = await publishTrack(at(pair));
      expect(conflict.statusCode, JSON.stringify(pair)).toBe(400);
      expect(conflict.body).toMatch(/mutually exclusive/);
    }
  });

  it("stores a Start and numbered Checkpoint gates, refusing what breaks the course rules (ADR 0068)", async () => {
    const floor = (extra: Record<string, unknown> = {}) => ({ moduleId: "kaykit_floor_wood_2x2", position: { x: 0, y: 0, z: 0 }, rotation: 0, ...extra });
    const arch = (z: number, extra: Record<string, unknown> = {}) => ({ moduleId: "kaykit_arch_blue", position: { x: 0, y: 0, z }, rotation: 0, ...extra });
    expect((await publishTrack([floor({ start: true }), arch(-3, { checkpoint: { order: 1 } }), arch(-6, { checkpoint: { order: 2, respawn: { x: 0, y: 0, z: 1 } } })])).statusCode).toBe(201);

    const cases: [unknown[], RegExp][] = [
      [[floor({ start: "yes" })], /track\[0\]\.start must be true/],
      [[arch(0, { checkpoint: { order: 0 } })], /track\[0\]\.checkpoint\.order must be a whole number/],
      [[floor({ start: true }), arch(0, { start: true })], /2 Starts/],
      [[floor({ checkpoint: { order: 1 } })], /track\[0\]\.checkpoint is on .+kaykit_floor_wood_2x2.+which is not a hoop or an arch/],
      [[arch(0, { checkpoint: { order: 1 } }), arch(-3, { checkpoint: { order: 1 } })], /both Checkpoint 1/],
      [[floor({ start: true, motion: { slide: { offset: { x: 1, y: 0, z: 0 }, period: 2, easing: "linear" } } })], /Start and moves/],
    ];
    for (const [track, message] of cases) {
      const res = await publishTrack(track);
      expect(res.statusCode, String(message)).toBe(400);
      expect(res.body).toMatch(message);
    }
  });

  it("stores a Segment scale inside its bounds and refuses one outside them (ADR 0062)", async () => {
    const at = (scale: unknown) => [{ moduleId: "start", position: { x: 0, y: 0, z: 0 }, rotation: 0, scale }];
    expect((await publishTrack(at(2))).statusCode).toBe(201);
    expect((await publishTrack(at(0.1))).statusCode).toBe(400);
    expect((await publishTrack(at(50))).statusCode).toBe(400);
    expect((await publishTrack(at("2"))).statusCode).toBe(400);
  });

  it("still accepts every Track shape published before this check existed", async () => {
    expect((await publishTrack(SAMPLE_TRACK)).statusCode).toBe(201);
    expect((await publishTrack(M1_TRACK)).statusCode).toBe(201);
  });
});

describe("Survivor Target on publish (M5 ticket 07, ADR 0041)", () => {
  it("returns the authored Survivor Target alongside the Track", async () => {
    const { id } = (await publish({ track: SAMPLE_TRACK, survivorTarget: 4 })).json() as { id: string };
    const stored = (await app.inject({ method: "GET", url: `/tracks/${id}` })).json() as {
      survivorTarget: number;
      track: Track;
    };
    expect(stored.survivorTarget).toBe(4);
    expect(stored.track).toEqual(SAMPLE_TRACK);
  });

  it("defaults a publish that omits it, so every existing caller keeps working", async () => {
    const { id } = (await publish({ track: SAMPLE_TRACK })).json() as { id: string };
    const stored = (await app.inject({ method: "GET", url: `/tracks/${id}` })).json() as { survivorTarget: number };
    expect(stored.survivorTarget).toBe(DEFAULT_SURVIVOR_TARGET);
  });

  it("rejects a target outside the bounds rather than storing a Revision that can't be survived", async () => {
    const res = await publish({ track: SAMPLE_TRACK, survivorTarget: MIN_SURVIVOR_TARGET - 1 });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toMatch(/survivorTarget/);
    expect((await publish({ track: SAMPLE_TRACK, survivorTarget: MAX_SURVIVOR_TARGET + 1 })).statusCode).toBe(400);
    expect((await publish({ track: SAMPLE_TRACK, survivorTarget: 2.5 })).statusCode).toBe(400);
  });

  it("stores a Track's clock and its Survivor Target together — one publish authors both", async () => {
    const { id } = (await publish({ track: SAMPLE_TRACK, timeLimitMs: 45_000, survivorTarget: 3 })).json() as {
      id: string;
    };
    const stored = (await app.inject({ method: "GET", url: `/tracks/${id}` })).json() as {
      timeLimitMs: number;
      survivorTarget: number;
    };
    expect(stored).toMatchObject({ timeLimitMs: 45_000, survivorTarget: 3 });
  });
});

describe("Discover listing metadata (M9 ticket 16)", () => {
  const FINISH_TRACK: Track = [{ moduleId: "finish", position: { x: 0, y: 0, z: 0 }, rotation: 0 }];

  const played = (id: string, token?: string) =>
    app.inject({
      method: "POST",
      url: `/internal/tracks/${id}/played`,
      ...(token === undefined ? {} : { headers: { "x-service-token": token } }),
    });

  it("lists plays and raceability on every row — zero plays, Zone-derived raceability", async () => {
    const { id: plain } = (await publish({ track: SAMPLE_TRACK })).json() as { id: string };
    const { id: racer } = (await publish({ track: FINISH_TRACK })).json() as { id: string };

    const list = (await app.inject({ method: "GET", url: "/tracks" })).json() as {
      id: string;
      plays: number;
      hasFinishZone: boolean;
    }[];
    expect(list.find((t) => t.id === plain)).toMatchObject({ plays: 0, hasFinishZone: false });
    expect(list.find((t) => t.id === racer)).toMatchObject({ plays: 0, hasFinishZone: true });
  });

  it("counts a reported play — the listing's count ticks per report", async () => {
    const { id } = (await publish({ track: SAMPLE_TRACK })).json() as { id: string };

    expect((await played(id, SERVICE_TOKEN)).statusCode).toBe(200);
    expect((await played(id, SERVICE_TOKEN)).statusCode).toBe(200);

    const list = (await app.inject({ method: "GET", url: "/tracks" })).json() as { id: string; plays: number }[];
    expect(list.find((t) => t.id === id)?.plays).toBe(2);
  });

  it("refuses a play report without the service token — and records nothing", async () => {
    const { id } = (await publish({ track: SAMPLE_TRACK })).json() as { id: string };

    expect((await played(id)).statusCode).toBe(403);
    expect((await played(id, "wrong")).statusCode).toBe(403);

    const list = (await app.inject({ method: "GET", url: "/tracks" })).json() as { id: string; plays: number }[];
    expect(list.find((t) => t.id === id)?.plays).toBe(0);
  });

  it("404s a play report for an unknown trackId, naming the miss", async () => {
    const res = await played("no-such-track", SERVICE_TOKEN);
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: string }).error).toMatch(/no Track with id "no-such-track"/);
  });
});
