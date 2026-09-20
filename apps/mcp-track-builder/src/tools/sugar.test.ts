import { describe, expect, it } from "vitest";
import { harness } from "../test/harness.js";

/**
 * Sugar over the real protocol against a real API: every attachment kind set
 * and detached over index lists, conflicts refused with the Segment named,
 * and every call atomic.
 */
const h = harness();
const call = (name: string, args: Record<string, unknown> = {}): Promise<{ json: any; isError: boolean }> =>
  h.current.call(name, args);

const PLATFORM = "kaykit_platform_6x6x1_red";
const ARCH = "kaykit_arch_red";
const segment = (moduleId: string, z = 0): Record<string, unknown> => ({
  moduleId,
  position: { x: 0, y: 0, z },
  rotation: 0,
});

const getSegments = async (draftId: string): Promise<any[]> =>
  (await call("get_draft", { draftId, limit: 200 })).json.segments.items as any[];

describe("sugar", () => {
  it("sets and strips every attachment kind over index lists", async () => {
    const draftId = (await call("create_draft", { track: [segment(PLATFORM), segment(PLATFORM), segment(PLATFORM)] })).json
      .id as string;

    expect((await call("set_surface", { draftId, indices: [0, 2], surface: "ice" })).json.touched).toEqual([0, 2]);
    expect((await call("set_motion", { draftId, indices: [1], motion: null })).json.touched).toEqual([1]);
    await call("set_motion", {
      draftId,
      indices: [1],
      motion: { spin: { axis: { x: 0, y: 1, z: 0 }, pivot: { x: 0, y: 0, z: 0 }, speed: 1 } },
    });
    await call("set_conveyor", { draftId, indices: [0], conveyor: { preset: "fast", angle: 0 } });
    await call("set_launch", { draftId, indices: [0], height: 6 });
    await call("set_paint", { draftId, indices: [2], color: "pink" });

    const items = await getSegments(draftId);
    expect(items[0]).toMatchObject({ ice: true, conveyor: { preset: "fast", angle: 0 }, launch: { height: 6 } });
    expect(items[1]).toMatchObject({ motion: { spin: { speed: 1 } } });
    expect(items[2]).toMatchObject({ ice: true, color: "pink" });

    await call("set_surface", { draftId, indices: [0], surface: "none" });
    await call("set_conveyor", { draftId, indices: [0], conveyor: null });
    await call("set_launch", { draftId, indices: [0], height: null });
    await call("set_paint", { draftId, indices: [2], color: null });
    const stripped = await getSegments(draftId);
    expect(stripped[0]).not.toHaveProperty("ice");
    expect(stripped[0]).not.toHaveProperty("conveyor");
    expect(stripped[0]).not.toHaveProperty("launch");
    expect(stripped[2]).not.toHaveProperty("color");
  });

  it("refuses a Prop beside behavior with the Segment named, and writes nothing", async () => {
    const draftId = (await call("create_draft", { track: [segment(PLATFORM), segment(PLATFORM)] })).json.id as string;
    await call("set_surface", { draftId, indices: [1], surface: "mud" });

    const refused = await call("set_prop", { draftId, indices: [0, 1], prop: true });
    expect(refused.isError).toBe(true);
    expect(refused.json.error).toMatch(/track\[1\]/);

    const items = await getSegments(draftId);
    expect(items[0]).not.toHaveProperty("prop");
    expect(items[1]).toMatchObject({ mud: true });

    await call("set_surface", { draftId, indices: [1], surface: "none" });
    await call("set_paint", { draftId, indices: [1], color: "blue" });
    expect((await call("set_prop", { draftId, indices: [1], prop: true })).isError).toBe(false);
    const propped = await getSegments(draftId);
    expect(propped[0]).not.toHaveProperty("prop");
    expect(propped[1]).toMatchObject({ prop: true, color: "blue" });
  });

  it("marks the Start, numbers Checkpoints, moves and clears", async () => {
    const draftId = (
      await call("create_draft", { track: [segment(PLATFORM), segment(ARCH), segment(ARCH)] })
    ).json.id as string;

    await call("set_course", {
      draftId,
      start: 0,
      checkpoints: [
        { index: 1, order: 1 },
        { index: 2, order: 2, respawn: { x: 0, y: 1, z: 0 } },
      ],
    });
    expect(await getSegments(draftId)).toMatchObject([
      { start: true },
      { checkpoint: { order: 1 } },
      { checkpoint: { order: 2, respawn: { x: 0, y: 1, z: 0 } } },
    ]);

    // Marking moves the Start; a duplicate order fails naming both Segments.
    await call("set_course", { draftId, start: 1 });
    const dup = await call("set_course", { draftId, checkpoints: [{ index: 1, order: 2 }] });
    expect(dup.isError).toBe(true);
    expect(dup.json.error).toMatch(/1.*2|2.*1/);

    await call("set_course", { draftId, clearStart: true, clearCourse: [2] });
    const cleared = await getSegments(draftId);
    expect(cleared[1]).toMatchObject({ checkpoint: { order: 1 } });
    expect(cleared[1].start).toBeUndefined();
    expect(cleared[0].start).toBeUndefined();
    expect(cleared[2].checkpoint).toBeUndefined();
  });
});
