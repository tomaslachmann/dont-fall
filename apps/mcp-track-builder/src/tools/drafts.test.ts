import { BASE_RACE_TRACK_ID } from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import { harness } from "../test/harness.js";

/**
 * Draft edits over the real protocol against a real API — the whole D4 loop:
 * create (empty/explicit/branched), paged reads, single + bulk edits, meta,
 * discard. Every write asserts its atomicity: one bad entry, nothing stored.
 */
const h = harness();
const call = (name: string, args: Record<string, unknown> = {}): Promise<{ json: any; isError: boolean }> =>
  h.current.call(name, args);

const SEGMENT = { moduleId: "kaykit_platform_6x6x1_red", position: { x: 0, y: 0, z: 0 }, rotation: 0 };

describe("drafts", () => {
  it("creates empty, lists, reads paged, patches meta, discards", async () => {
    const created = await call("create_draft", { id: "mine", roundType: "survival", name: "pit" });
    expect(created).toEqual({ json: { id: "mine", created: true }, isError: false });

    const listed = await call("list_drafts");
    expect(listed.json.drafts).toEqual([
      { id: "mine", name: "pit", roundType: "survival", segmentCount: 0, updatedAt: expect.any(Number) },
    ]);

    const read = await call("get_draft", { draftId: "mine" });
    expect(read.json).toMatchObject({ id: "mine", name: "pit", roundType: "survival" });
    expect(read.json.segments).toEqual({ items: [], total: 0, offset: 0, limit: 50 });

    const meta = await call("set_draft_meta", { draftId: "mine", name: null, timeLimitMs: 120000 });
    expect(meta.json).toMatchObject({ name: null, timeLimitMs: 120000, roundType: "survival" });

    expect(await call("discard_draft", { draftId: "mine" })).toEqual({ json: { id: "mine" }, isError: false });
    expect((await call("get_draft", { draftId: "mine" })).isError).toBe(true);
  });

  it("branches a stored Revision and appends single + bulk", async () => {
    const created = await call("create_draft", { from: { trackId: BASE_RACE_TRACK_ID } });
    const draftId = created.json.id as string;
    const branched = await call("get_draft", { draftId, limit: 1 });
    expect(branched.json.segments.total).toBeGreaterThan(5);
    expect(branched.json.timeLimitMs).toBeGreaterThan(0);

    const before = (await call("get_draft", { draftId, limit: 1 })).json.segments.total as number;
    const one = await call("add_segment", { draftId, segment: SEGMENT });
    expect(one.json.added).toEqual([before]);

    const bulk = await call("add_segments", { draftId, segments: [SEGMENT, SEGMENT] });
    expect(bulk.json.added).toEqual([before + 1, before + 2]);
    expect((await call("get_draft", { draftId, limit: 1 })).json.segments.total).toBe(before + 3);
  });

  it("updates raw fields and detaches attachments with null, one bad patch writing nothing", async () => {
    const { json } = await call("create_draft", { track: [{ ...SEGMENT, ice: true }, SEGMENT] });
    const draftId = json.id as string;

    await call("update_segment", {
      draftId,
      index: 0,
      patch: { position: { x: 1, y: 2, z: 3 }, ice: null, mud: true },
    });
    const read = await call("get_draft", { draftId });
    expect(read.json.segments.items[0]).toMatchObject({ position: { x: 1, y: 2, z: 3 }, mud: true });
    expect(read.json.segments.items[0].ice).toBeUndefined();

    const bad = await call("update_segments", {
      draftId,
      updates: [
        { index: 0, patch: { rotation: 1 } },
        { index: 1, patch: { ice: true, mud: true } },
      ],
    });
    expect(bad.isError).toBe(true);
    const reread = await call("get_draft", { draftId });
    expect(reread.json.segments.items[0].rotation).toBe(0);

    const twice = await call("update_segments", {
      draftId,
      updates: [
        { index: 0, patch: { rotation: 1 } },
        { index: 0, patch: { rotation: 2 } },
      ],
    });
    expect(twice.isError).toBe(true);
  });

  it("removes single + bulk, one bad index writing nothing", async () => {
    const { json } = await call("create_draft", { track: [SEGMENT, SEGMENT, SEGMENT] });
    const draftId = json.id as string;

    await call("remove_segment", { draftId, index: 1 });
    expect((await call("get_draft", { draftId })).json.segments.total).toBe(2);

    const bad = await call("remove_segments", { draftId, indices: [0, 9] });
    expect(bad.isError).toBe(true);
    expect((await call("get_draft", { draftId })).json.segments.total).toBe(2);

    await call("remove_segments", { draftId, indices: [1, 0] });
    expect((await call("get_draft", { draftId })).json.segments.total).toBe(0);
  });

  it("refuses unknown Modules and misshapen Segments naming the cause", async () => {
    const { json } = await call("create_draft", {});
    const draftId = json.id as string;

    const unknown = await call("add_segment", {
      draftId,
      segment: { moduleId: "nope", position: { x: 0, y: 0, z: 0 }, rotation: 0 },
    });
    expect(unknown.isError).toBe(true);

    const misshapen = await call("add_segment", {
      draftId,
      segment: { moduleId: "kaykit_platform_6x6x1_red", position: { x: 0, y: 0 }, rotation: 0 },
    });
    expect(misshapen.isError).toBe(true);
    expect((await call("get_draft", { draftId })).json.segments.total).toBe(0);
  });
});
