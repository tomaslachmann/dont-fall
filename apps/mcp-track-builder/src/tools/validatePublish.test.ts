import { BASE_RACE_TRACK_ID } from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import { harness } from "../test/harness.js";

/**
 * The gate over the real protocol against a real API: round-type-aware
 * verdicts without publishing, then publish — new ids and new revisions —
 * refusing invalid drafts with validate's own errors.
 */
const h = harness();
const call = (name: string, args: Record<string, unknown> = {}): Promise<{ json: any; isError: boolean }> =>
  h.current.call(name, args);

const PLATFORM = "kaykit_platform_6x6x1_red";
const FINISH = "kaykit_signage_finish";
const segment = (moduleId: string, z = 0): Record<string, unknown> => ({
  moduleId,
  position: { x: 0, y: 0, z },
  rotation: 0,
});

describe("validate + publish", () => {
  it("judges by Round type: a Race needs a finish, Survival needs nothing", async () => {
    const race = (await call("create_draft", { roundType: "race", track: [segment(PLATFORM)] })).json.id as string;
    const refused = await call("validate_draft", { draftId: race });
    expect(refused.json).toMatchObject({ valid: false });
    expect(refused.json.errors.join("\n")).toMatch(/no Finish Zone/);

    const survival = (await call("create_draft", { roundType: "survival", track: [segment(PLATFORM)] })).json
      .id as string;
    expect(await call("validate_draft", { draftId: survival })).toMatchObject({
      json: { valid: true, errors: [] },
      isError: false,
    });

    await call("add_segment", { draftId: race, segment: segment(FINISH, -8) });
    const passed = await call("validate_draft", { draftId: race });
    expect(passed.json.valid).toBe(true);
    expect(passed.json.warnings.join("\n")).toMatch(/no Checkpoints/);
  });

  it("warns where a launch stands on no Spring", async () => {
    const draftId = (await call("create_draft", { roundType: "survival", track: [segment(PLATFORM)] })).json
      .id as string;
    await call("set_launch", { draftId, indices: [0], height: 6 });
    const verdict = await call("validate_draft", { draftId });
    expect(verdict.json.valid).toBe(true);
    expect(verdict.json.warnings.join("\n")).toMatch(/no Spring/);
  });

  it("publishes new ids, revises existing ones, and refuses invalid drafts", async () => {
    const draftId = (
      await call("create_draft", { roundType: "race", name: "first", track: [segment(PLATFORM), segment(FINISH, -8)] })
    ).json.id as string;

    const published = await call("publish_draft", { draftId });
    expect(published.json).toMatchObject({ trackId: draftId, revision: 1, name: "first" });
    expect((await call("get_track", { id: draftId, limit: 1 })).json.segments.total).toBe(2);

    // A second publish of the same draft revises rather than duplicates.
    expect((await call("publish_draft", { draftId })).json.revision).toBe(2);

    // And a draft branches a stored Track into a new Revision of it.
    const branch = (await call("create_draft", { from: { trackId: BASE_RACE_TRACK_ID } })).json.id as string;
    const revised = await call("publish_draft", { draftId: branch, trackId: BASE_RACE_TRACK_ID });
    expect(revised.json).toMatchObject({ trackId: BASE_RACE_TRACK_ID, revision: 2 });

    const bad = (await call("create_draft", { roundType: "race", track: [segment(PLATFORM)] })).json.id as string;
    const refused = await call("publish_draft", { draftId: bad });
    expect(refused.isError).toBe(true);
    expect(refused.json.error).toMatch(/not publishable/);
    expect((await call("list_tracks", {})).json.tracks.map((t: { id: string }) => t.id)).not.toContain(bad);
  });
});
