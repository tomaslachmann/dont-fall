import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import {
  DEFAULT_ENVIRONMENT_ID,
  DEFAULT_SURVIVOR_TARGET,
  DEFAULT_TIME_LIMIT_MS,
  MODULE_LIBRARY,
  TRACK_THUMBNAIL_DATA_URL_PREFIX,
  type Track,
} from "@dont-fall/shared";
import { openDb, type ApiDb } from "../db/db.js";
import {
  getTrackById,
  getTrackPlays,
  getTrackThumbnail,
  listTracks,
  recordTrackPlay,
  saveTrack,
  syncSeedTrack,
} from "./tracks.dao.js";
import { tracks } from "../db/schema.js";

let dir: string;
let db: ApiDb;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "track-service-store-test-"));
  db = openDb(join(dir, "test.sqlite"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const SAMPLE_TRACK: Track = [{ moduleId: "start", position: { x: 0, y: 0, z: 0 }, rotation: 0 }];

describe("syncSeedTrack (ADR 0073)", () => {
  const OTHER_TRACK: Track = [
    { moduleId: "start", position: { x: 0, y: 0, z: 0 }, rotation: 0 },
    { moduleId: "finish", position: { x: 0, y: -0.5, z: -6 }, rotation: 0 },
  ];

  it("seeds the id when absent — retrievable with its name and Segments", () => {
    syncSeedTrack(db, { id: "seed", name: "Seed", track: SAMPLE_TRACK });

    const stored = getTrackById(db, "seed")!;
    expect(stored.track).toEqual(SAMPLE_TRACK);
    expect(stored.revision).toBe(1);
    expect(listTracks(db, MODULE_LIBRARY).map((t) => t.id)).toContain("seed");
  });

  it("leaves current content alone — a synced boot writes nothing", () => {
    syncSeedTrack(db, { id: "seed", name: "Seed", track: SAMPLE_TRACK });
    syncSeedTrack(db, { id: "seed", name: "Seed", track: SAMPLE_TRACK });

    const rows = db.select().from(tracks).where(eq(tracks.trackId, "seed")).all();
    expect(rows).toHaveLength(1);
    expect(getTrackById(db, "seed")!.revision).toBe(1);
  });

  it("heals drift forward — a new Revision with the code's content, the old one intact", () => {
    saveTrack(db, { id: "seed", name: "Seed", track: SAMPLE_TRACK });

    syncSeedTrack(db, { id: "seed", name: "Seed", track: OTHER_TRACK });

    expect(getTrackById(db, "seed")!.revision).toBe(2);
    expect(getTrackById(db, "seed")!.track).toEqual(OTHER_TRACK);
    // Immutable history: revision 1 still serves exactly what it always did.
    expect(getTrackById(db, "seed", 1)!.track).toEqual(SAMPLE_TRACK);
  });

  it("publishes the seed's own screenshot with it (ADR 0085/0089)", () => {
    const thumbnail = `${TRACK_THUMBNAIL_DATA_URL_PREFIX}aGVsbG8=`;
    syncSeedTrack(db, { id: "seed", name: "Seed", track: SAMPLE_TRACK, thumbnail });

    expect(getTrackById(db, "seed")!.hasThumbnail).toBe(true);
    expect(getTrackThumbnail(db, "seed")).toBe(thumbnail);
  });

  it("heals a seed that gained a screenshot — a Revision with the picture, without waiting for other drift", () => {
    syncSeedTrack(db, { id: "seed", name: "Seed", track: SAMPLE_TRACK });
    expect(getTrackById(db, "seed")!.hasThumbnail).toBe(false);

    const thumbnail = `${TRACK_THUMBNAIL_DATA_URL_PREFIX}aGVsbG8=`;
    syncSeedTrack(db, { id: "seed", name: "Seed", track: SAMPLE_TRACK, thumbnail });
    expect(getTrackById(db, "seed")!.revision).toBe(2);
    expect(getTrackById(db, "seed")!.hasThumbnail).toBe(true);

    // And then settles: a synced boot with the same picture writes nothing.
    syncSeedTrack(db, { id: "seed", name: "Seed", track: SAMPLE_TRACK, thumbnail });
    expect(getTrackById(db, "seed")!.revision).toBe(2);
  });

  it("heals a drifted clock the same way — the seed's Time Limit is code-owned too", () => {
    syncSeedTrack(db, { id: "seed", name: "Seed", track: SAMPLE_TRACK });
    expect(getTrackById(db, "seed")!.timeLimitMs).toBe(DEFAULT_TIME_LIMIT_MS);

    syncSeedTrack(db, { id: "seed", name: "Seed", track: SAMPLE_TRACK, timeLimitMs: 300_000 });
    syncSeedTrack(db, { id: "seed", name: "Seed", track: SAMPLE_TRACK, timeLimitMs: 300_000 });

    expect(getTrackById(db, "seed")!.revision).toBe(2);
    expect(getTrackById(db, "seed")!.timeLimitMs).toBe(300_000);
  });

  it("seeds alongside unrelated Tracks without touching them", () => {
    const { id } = saveTrack(db, { track: SAMPLE_TRACK });

    syncSeedTrack(db, { id: "seed", name: "Seed", track: SAMPLE_TRACK });

    expect(getTrackById(db, id)!.track).toEqual(SAMPLE_TRACK);
    expect(getTrackById(db, "seed")!.track).toEqual(SAMPLE_TRACK);
  });
});

describe("saveTrack — content hash (code review, ticket 10)", () => {
  it("hashes identical Track content the same regardless of object key order", () => {
    const inOrder: Track = [{ moduleId: "start", position: { x: 1, y: 2, z: 3 }, rotation: 0 }];
    // Same content, but each object's keys are declared in a different order
    // — JS preserves literal insertion order, so plain JSON.stringify would
    // produce a different string (and thus a different hash) for this.
    const reordered: Track = [{ rotation: 0, position: { z: 3, y: 2, x: 1 }, moduleId: "start" }];

    const a = saveTrack(db, { track: inOrder });
    const b = saveTrack(db, { track: reordered });

    const storedA = getTrackById(db, a.id)!;
    const storedB = getTrackById(db, b.id)!;
    expect(storedA.contentHash).toBe(storedB.contentHash);
  });

  it("hashes different content differently", () => {
    const a = saveTrack(db, { track: SAMPLE_TRACK });
    const b = saveTrack(db, { track: [{ moduleId: "finish", position: { x: 0, y: 0, z: 0 }, rotation: 0 }] });
    expect(getTrackById(db, a.id)!.contentHash).not.toBe(getTrackById(db, b.id)!.contentHash);
  });
});

describe("saveTrack — empty id (code review, ticket 10)", () => {
  it("treats an empty string id the same as absent — never saves an unfetchable empty trackId", () => {
    const saved = saveTrack(db, { id: "", track: SAMPLE_TRACK });
    expect(saved.id).not.toBe("");
    expect(saved.id.length).toBeGreaterThan(0);
    expect(getTrackById(db, saved.id)).toBeDefined();
  });
});

describe("listTracks — latest-per-trackId ordering (code review, ticket 10)", () => {
  it("reports the highest revision, not whichever row has the latest createdAt, on a createdAt tie", () => {
    const { id } = saveTrack(db, { name: "v1", track: SAMPLE_TRACK });
    saveTrack(db, { id, name: "v2", track: SAMPLE_TRACK });

    // Force both rows to the exact same createdAt, simulating a millisecond
    // collision — `listTracks` must still prefer revision 2 ("v2"), not
    // whichever row a createdAt-only sort happens to place first.
    db.update(tracks).set({ createdAt: 1000 }).run();

    const list = listTracks(db, MODULE_LIBRARY);
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe("v2");
  });

  it("lists one row per trackId even with many Revisions", () => {
    const { id: idA } = saveTrack(db, { name: "a1", track: SAMPLE_TRACK });
    saveTrack(db, { id: idA, name: "a2", track: SAMPLE_TRACK });
    saveTrack(db, { id: idA, name: "a3", track: SAMPLE_TRACK });
    saveTrack(db, { name: "b1", track: SAMPLE_TRACK });

    const list = listTracks(db, MODULE_LIBRARY);
    expect(list).toHaveLength(2);
    expect(list.find((t) => t.id === idA)?.name).toBe("a3");
  });
});

describe("listTracks — Discover metadata (M9 ticket 16)", () => {
  const FINISH_TRACK: Track = [{ moduleId: "finish", position: { x: 0, y: 0, z: 0 }, rotation: 0 }];

  it("reports zero plays for a never-played Track, and raceability per Track", () => {
    const { id: plain } = saveTrack(db, { name: "plain", track: SAMPLE_TRACK });
    const { id: racer } = saveTrack(db, { name: "racer", track: FINISH_TRACK });

    const list = listTracks(db, MODULE_LIBRARY);
    expect(list.find((t) => t.id === plain)).toMatchObject({ plays: 0, hasFinishZone: false });
    expect(list.find((t) => t.id === racer)).toMatchObject({ plays: 0, hasFinishZone: true });
  });

  it("keys plays by trackId, not Revision — republishing keeps the count", () => {
    const { id } = saveTrack(db, { name: "v1", track: SAMPLE_TRACK });
    recordTrackPlay(db, id);
    recordTrackPlay(db, id);
    saveTrack(db, { id, name: "v2", track: SAMPLE_TRACK });

    const list = listTracks(db, MODULE_LIBRARY);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id, name: "v2", plays: 2 });
  });

  it("reads raceability off the latest Revision — a republish can gain or lose the Zone", () => {
    const { id } = saveTrack(db, { name: "v1", track: SAMPLE_TRACK });
    expect(listTracks(db, MODULE_LIBRARY).find((t) => t.id === id)?.hasFinishZone).toBe(false);

    saveTrack(db, { id, name: "v2", track: FINISH_TRACK });
    expect(listTracks(db, MODULE_LIBRARY).find((t) => t.id === id)?.hasFinishZone).toBe(true);
  });

  it("never fails the whole listing over one Track referencing an unknown Module", () => {
    saveTrack(db, { name: "broken", track: [{ moduleId: "nope", position: { x: 0, y: 0, z: 0 }, rotation: 0 }] });
    const { id } = saveTrack(db, { name: "racer", track: FINISH_TRACK });

    const list = listTracks(db, MODULE_LIBRARY);
    expect(list.find((t) => t.name === "broken")).toMatchObject({ plays: 0, hasFinishZone: false });
    expect(list.find((t) => t.id === id)?.hasFinishZone).toBe(true);
  });
});

describe("recordTrackPlay (M9 ticket 16)", () => {
  it("counts one play per call, starting from nothing", () => {
    const { id } = saveTrack(db, { track: SAMPLE_TRACK });
    expect(getTrackPlays(db, id)).toBe(0);

    expect(recordTrackPlay(db, id)).toBe(true);
    expect(recordTrackPlay(db, id)).toBe(true);

    expect(getTrackPlays(db, id)).toBe(2);
    expect(listTracks(db, MODULE_LIBRARY).find((t) => t.id === id)?.plays).toBe(2);
  });

  it("returns false for an unknown trackId and records nothing", () => {
    expect(recordTrackPlay(db, "no-such-track")).toBe(false);
    expect(listTracks(db, MODULE_LIBRARY)).toHaveLength(0);
  });
});

describe("Time Limit per Revision (M4 ticket 03, ADR 0038)", () => {
  it("defaults a Revision published without one to the backfill default", () => {
    const { id } = saveTrack(db, { track: SAMPLE_TRACK });

    expect(getTrackById(db, id)!.timeLimitMs).toBe(DEFAULT_TIME_LIMIT_MS);
  });

  it("stores an authored Time Limit and reads it back", () => {
    const { id } = saveTrack(db, { track: SAMPLE_TRACK, timeLimitMs: 45_000 });

    expect(getTrackById(db, id)!.timeLimitMs).toBe(45_000);
  });

  it("keys it per Revision — republishing changes the clock only for the new one", () => {
    const { id } = saveTrack(db, { track: SAMPLE_TRACK, timeLimitMs: 45_000 });
    saveTrack(db, { id, track: SAMPLE_TRACK, timeLimitMs: 90_000 });

    expect(getTrackById(db, id, 1)!.timeLimitMs).toBe(45_000);
    expect(getTrackById(db, id, 2)!.timeLimitMs).toBe(90_000);
    expect(getTrackById(db, id)!.timeLimitMs).toBe(90_000); // latest
  });

  it("leaves the published Segment[] contract untouched — the clock is a row attribute", () => {
    const { id } = saveTrack(db, { track: SAMPLE_TRACK, timeLimitMs: 45_000 });

    // ADR 0038's whole point: `data` is still exactly the Segment[] every
    // existing consumer parses, with nothing wrapped around it.
    const row = db.select().from(tracks).where(eq(tracks.trackId, id)).get()!;
    expect(JSON.parse(row.data)).toEqual(SAMPLE_TRACK);
  });

  it("hashes content independently of the Time Limit — the same Segments are the same content", () => {
    const { id: a } = saveTrack(db, { track: SAMPLE_TRACK, timeLimitMs: 45_000 });
    const { id: b } = saveTrack(db, { track: SAMPLE_TRACK, timeLimitMs: 90_000 });

    expect(getTrackById(db, a)!.contentHash).toBe(getTrackById(db, b)!.contentHash);
  });
});

describe("migration onto a pre-M4 database (ADR 0038)", () => {
  it("backfills the default Time Limit onto Revisions published before the column existed", () => {
    // Rebuild the exact pre-M4 table and put a row in it, then reopen: an
    // already-published Revision has to keep loading and playing unchanged,
    // which for M4 means arriving with a clock it never authored.
    const legacyPath = join(dir, "legacy.sqlite");
    const legacy = new Database(legacyPath);
    legacy.exec(`
      CREATE TABLE tracks (
        track_id TEXT NOT NULL, revision INTEGER NOT NULL, name TEXT,
        author_id TEXT NOT NULL, content_hash TEXT NOT NULL, data TEXT NOT NULL,
        created_at INTEGER NOT NULL, PRIMARY KEY (track_id, revision)
      )
    `);
    legacy
      .prepare("INSERT INTO tracks VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("old-track", 1, "pre-M4", "local-author", "hash", JSON.stringify(SAMPLE_TRACK), Date.now());
    legacy.close();

    const migrated = openDb(legacyPath);

    const stored = getTrackById(migrated, "old-track")!;
    expect(stored.timeLimitMs).toBe(DEFAULT_TIME_LIMIT_MS);
    expect(stored.track).toEqual(SAMPLE_TRACK); // and the Track itself is untouched
  });
});

describe("the Survivor Target a Revision carries (M5 ticket 07, ADR 0041)", () => {
  it("stores and returns the authored target", () => {
    const { id } = saveTrack(db, { track: SAMPLE_TRACK, survivorTarget: 4 });

    expect(getTrackById(db, id)!.survivorTarget).toBe(4);
  });

  it("defaults a publish that omits it, so every pre-M5 caller keeps working", () => {
    const { id } = saveTrack(db, { track: SAMPLE_TRACK });

    expect(getTrackById(db, id)!.survivorTarget).toBe(DEFAULT_SURVIVOR_TARGET);
  });

  it("is not part of the content hash — two Revisions differing only in it are the same Segments", () => {
    const { id } = saveTrack(db, { track: SAMPLE_TRACK, survivorTarget: 1 });
    saveTrack(db, { id, track: SAMPLE_TRACK, survivorTarget: 6 });

    const rows = db.select().from(tracks).where(eq(tracks.trackId, id)).all();
    expect(rows).toHaveLength(2);
    expect(rows[0]!.contentHash).toBe(rows[1]!.contentHash);
    expect(getTrackById(db, id)!.survivorTarget).toBe(6);
  });

  it("backfills the default onto a Revision published before the column existed", () => {
    // The pre-M5 table: everything M4 had, and no survivor_target.
    const legacyPath = join(dir, "pre-m5.sqlite");
    const legacy = new Database(legacyPath);
    legacy.exec(`
      CREATE TABLE tracks (
        track_id TEXT NOT NULL, revision INTEGER NOT NULL, name TEXT,
        author_id TEXT NOT NULL, content_hash TEXT NOT NULL, data TEXT NOT NULL,
        created_at INTEGER NOT NULL, time_limit_ms INTEGER NOT NULL,
        PRIMARY KEY (track_id, revision)
      )
    `);
    legacy
      .prepare("INSERT INTO tracks VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("old-track", 1, "pre-M5", "local-author", "hash", JSON.stringify(SAMPLE_TRACK), Date.now(), 90_000);
    legacy.close();

    const migrated = openDb(legacyPath);

    const stored = getTrackById(migrated, "old-track")!;
    expect(stored.survivorTarget).toBe(DEFAULT_SURVIVOR_TARGET);
    expect(stored.timeLimitMs).toBe(90_000); // and what it did author is untouched
    expect(stored.track).toEqual(SAMPLE_TRACK);
  });
});

describe("the Environment a Revision is drawn inside (M12 ticket 09, ADR 0074)", () => {
  it("stores and returns the authored preset", () => {
    const { id } = saveTrack(db, { track: SAMPLE_TRACK, environment: "night" });

    expect(getTrackById(db, id)!.environment).toBe("night");
  });

  it("defaults a publish that omits it, so every existing caller keeps working", () => {
    const { id } = saveTrack(db, { track: SAMPLE_TRACK });

    expect(getTrackById(db, id)!.environment).toBe(DEFAULT_ENVIRONMENT_ID);
  });

  it("is not part of the content hash — the same Segments under another sky are the same Track", () => {
    const { id } = saveTrack(db, { track: SAMPLE_TRACK, environment: "day" });
    saveTrack(db, { id, track: SAMPLE_TRACK, environment: "sunset" });

    const rows = db.select().from(tracks).where(eq(tracks.trackId, id)).all();
    expect(rows[0]!.contentHash).toBe(rows[1]!.contentHash);
    expect(getTrackById(db, id)!.environment).toBe("sunset");
  });

  it("reads back a preset this build does not know as the default, never as a bad id", () => {
    const { id } = saveTrack(db, { track: SAMPLE_TRACK });
    db.update(tracks).set({ environment: "aurora" }).where(eq(tracks.trackId, id)).run();

    expect(getTrackById(db, id)!.environment).toBe(DEFAULT_ENVIRONMENT_ID);
  });

  it("backfills the default onto a Revision published before the column existed", () => {
    // The pre-M12 table: everything M5 had, and no environment.
    const legacyPath = join(dir, "pre-m12.sqlite");
    const legacy = new Database(legacyPath);
    legacy.exec(`
      CREATE TABLE tracks (
        track_id TEXT NOT NULL, revision INTEGER NOT NULL, name TEXT,
        author_id TEXT NOT NULL, content_hash TEXT NOT NULL, data TEXT NOT NULL,
        created_at INTEGER NOT NULL, time_limit_ms INTEGER NOT NULL, survivor_target INTEGER NOT NULL,
        PRIMARY KEY (track_id, revision)
      )
    `);
    legacy
      .prepare("INSERT INTO tracks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run("old-track", 1, "pre-M12", "local-author", "hash", JSON.stringify(SAMPLE_TRACK), Date.now(), 90_000, 3);
    legacy.close();

    const migrated = openDb(legacyPath);

    const stored = getTrackById(migrated, "old-track")!;
    expect(stored.environment).toBe(DEFAULT_ENVIRONMENT_ID);
    expect(stored.timeLimitMs).toBe(90_000); // and what it did author is untouched
    expect(stored.survivorTarget).toBe(3);
    expect(stored.track).toEqual(SAMPLE_TRACK);
  });
});

describe("a Revision's Thumbnail (ADR 0085)", () => {
  const THUMB = `${TRACK_THUMBNAIL_DATA_URL_PREFIX}aGVsbG8=`;

  it("stores and returns the captured data URL, and flags the Revision", () => {
    const { id } = saveTrack(db, { track: SAMPLE_TRACK, thumbnail: THUMB });

    expect(getTrackById(db, id)!.hasThumbnail).toBe(true);
    expect(getTrackThumbnail(db, id)).toBe(THUMB);
  });

  it("reads a Revision published without one as thumbnail-less, not missing — null, not undefined", () => {
    const { id } = saveTrack(db, { track: SAMPLE_TRACK });

    expect(getTrackById(db, id)!.hasThumbnail).toBe(false);
    expect(getTrackThumbnail(db, id)).toBeNull();
    expect(getTrackThumbnail(db, "no-such-track")).toBeUndefined();
  });

  it("pins to the exact Revision — a thumbnail-less republish doesn't erase Revision 1's", () => {
    const { id } = saveTrack(db, { id: "revised", track: SAMPLE_TRACK, thumbnail: THUMB });
    saveTrack(db, { id: "revised", track: SAMPLE_TRACK });

    expect(getTrackById(db, id)!.hasThumbnail).toBe(false); // latest is bare
    expect(getTrackThumbnail(db, id)).toBeNull();
    expect(getTrackThumbnail(db, id, 1)).toBe(THUMB); // Revision 1 keeps its own
    const listed = listTracks(db, MODULE_LIBRARY).find((t) => t.id === id)!;
    expect(listed.hasThumbnail).toBe(false); // the listing follows the latest
  });

  it("flags a Revision published with one on the listing too", () => {
    const { id } = saveTrack(db, { track: SAMPLE_TRACK, thumbnail: THUMB });

    expect(listTracks(db, MODULE_LIBRARY).find((t) => t.id === id)).toMatchObject({ hasThumbnail: true });
  });

  it("names the latest Revision on the listing, so a client can pin the picture's URL (ADR 0105)", () => {
    saveTrack(db, { id: "pinned", track: SAMPLE_TRACK, thumbnail: THUMB });
    saveTrack(db, { id: "pinned", track: SAMPLE_TRACK, thumbnail: THUMB });

    expect(listTracks(db, MODULE_LIBRARY).find((t) => t.id === "pinned")).toMatchObject({ revision: 2 });
  });

  it("migrates a table from before the column — old rows read thumbnail-less and keep everything", () => {
    const legacyPath = join(dir, "pre-thumbnail.sqlite");
    const legacy = new Database(legacyPath);
    legacy.exec(`
      CREATE TABLE tracks (
        track_id TEXT NOT NULL, revision INTEGER NOT NULL, name TEXT,
        author_id TEXT NOT NULL, content_hash TEXT NOT NULL, data TEXT NOT NULL,
        created_at INTEGER NOT NULL, time_limit_ms INTEGER NOT NULL, survivor_target INTEGER NOT NULL,
        environment TEXT NOT NULL,
        PRIMARY KEY (track_id, revision)
      )
    `);
    legacy
      .prepare("INSERT INTO tracks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run("old-track", 1, "pre-thumbnail", "local-author", "hash", JSON.stringify(SAMPLE_TRACK), Date.now(), 90_000, 3, "night");
    legacy.close();

    const migrated = openDb(legacyPath);

    const stored = getTrackById(migrated, "old-track")!;
    expect(stored.hasThumbnail).toBe(false);
    expect(getTrackThumbnail(migrated, "old-track")).toBeNull();
    expect(stored.environment).toBe("night"); // and what it did author is untouched
    expect(listTracks(migrated, MODULE_LIBRARY).find((t) => t.id === "old-track")).toMatchObject({
      hasThumbnail: false,
    });
  });
});
