import { describe, expect, it } from "vitest";
import { TICK_DT } from "../tuning/clock.js";
import { attachmentConflictReason } from "./Attachment.js";
import { bombDefOf, bombPhase, bombTicks, invalidBombReason, type BombDef } from "./Bomb.js";
import type { Module } from "./Module.js";
import { segmentBody } from "./resolveTrack.js";
import type { Segment } from "./Track.js";

const DEF: BombDef = { fuseSeconds: 5, warnSeconds: 1.5, returnSeconds: 8 };

describe("a placed bomb (ADR 0126)", () => {
  const bombModule = {
    id: "bomb_A",
    statics: [],
    sockets: [],
    footprint: { bounds: { center: { x: 0, y: 0.5, z: 0 }, halfExtents: { x: 0.4, y: 0.5, z: 0.4 } }, clearance: 0.5 },
    asset: { meshes: [], solid: [{ shape: { type: "ball", radius: 0.4 }, position: { x: 0, y: 0.4, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, surface: "default" }] },
    bomb: DEF,
  } as Module;
  const placed: Segment = { moduleId: "bomb_A", position: { x: 0, y: 0, z: 0 }, rotation: 0 };

  it("is a Prop without saying so, and even with a Motion", () => {
    expect(segmentBody(placed, bombModule)).toBe("prop");
    expect(segmentBody({ ...placed, motion: { spin: { speed: 1 } } } as unknown as Segment, bombModule)).toBe("prop");
  });

  it("runs its Asset's clock, with what its author retuned on top", () => {
    expect(bombDefOf(DEF, undefined)).toEqual(DEF);
    expect(bombDefOf(DEF, { fuseSeconds: 3 })).toEqual({ ...DEF, fuseSeconds: 3 });
    expect(bombDefOf(DEF, { returnSeconds: 20 })).toEqual({ ...DEF, returnSeconds: 20 });
  });

  it("may carry its timing beside `prop` — a bomb is a Prop", () => {
    expect(attachmentConflictReason({ prop: true, bomb: { fuseSeconds: 3 } })).toBeUndefined();
  });

  it("stores only a positive fuse and return", () => {
    expect(invalidBombReason({ fuseSeconds: 3, returnSeconds: 10 })).toBeUndefined();
    expect(invalidBombReason({})).toBeUndefined();
    expect(invalidBombReason({ fuseSeconds: 0 })).toMatch(/fuseSeconds/);
    expect(invalidBombReason({ returnSeconds: -1 })).toMatch(/returnSeconds/);
    expect(invalidBombReason({ warnSeconds: 1 })).toMatch(/warnSeconds/);
    expect(invalidBombReason(5)).toMatch(/object/);
  });
});

describe("what a bomb is doing, for its drawing (ADR 0126)", () => {
  it("lies there with no row", () => {
    expect(bombPhase(DEF, undefined, 100)).toEqual({ kind: "lying" });
  });

  it("ticks while lit, fast for its last warnSeconds", () => {
    const detonateTick = 1000;
    const early = bombPhase(DEF, { propIndex: 0, detonateTick }, detonateTick - bombTicks(3));
    const late = bombPhase(DEF, { propIndex: 0, detonateTick }, detonateTick - bombTicks(1));

    expect(early).toMatchObject({ kind: "lit", fast: false });
    expect(late).toMatchObject({ kind: "lit", fast: true });
  });

  it("counts from its blast once spent, before it as well — the clip leads the blast", () => {
    const blastTick = 500;
    const row = { propIndex: 0, blastTick, returnTick: blastTick + bombTicks(DEF.returnSeconds), blasted: true };

    const at = bombPhase(DEF, row, blastTick + 3);
    expect(at).toMatchObject({ kind: "spent", blasted: true });
    expect(at.kind === "spent" && at.secondsSince).toBeCloseTo(3 * TICK_DT, 6);
    const before = bombPhase(DEF, row, blastTick - 1);
    expect(before.kind === "spent" && before.secondsSince).toBeLessThan(0);
  });
});
