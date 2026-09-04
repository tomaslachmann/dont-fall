import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Track } from "@dont-fall/shared";
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
