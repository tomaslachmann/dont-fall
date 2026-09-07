import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { DEFAULT_SURVIVOR_TARGET, DEFAULT_TIME_LIMIT_MS, type Track } from "@dont-fall/shared";
import { openDb, type TrackDb } from "./db.js";
import { getTrackById, listTracks, saveTrack } from "./store.js";
import { tracks } from "./schema.js";

let dir: string;
let db: TrackDb;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "track-service-store-test-"));
  db = openDb(join(dir, "test.sqlite"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const SAMPLE_TRACK: Track = [{ moduleId: "start", position: { x: 0, y: 0, z: 0 }, rotation: 0 }];

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
    const b = saveTrack(db, { track: [{ moduleId: "bridge", position: { x: 0, y: 0, z: 0 }, rotation: 0 }] });
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

    const list = listTracks(db);
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe("v2");
  });

  it("lists one row per trackId even with many Revisions", () => {
    const { id: idA } = saveTrack(db, { name: "a1", track: SAMPLE_TRACK });
    saveTrack(db, { id: idA, name: "a2", track: SAMPLE_TRACK });
    saveTrack(db, { id: idA, name: "a3", track: SAMPLE_TRACK });
    saveTrack(db, { name: "b1", track: SAMPLE_TRACK });

    const list = listTracks(db);
    expect(list).toHaveLength(2);
    expect(list.find((t) => t.id === idA)?.name).toBe("a3");
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
