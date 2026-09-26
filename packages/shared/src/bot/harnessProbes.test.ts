import { beforeAll, describe, expect, it } from "vitest";
import type { Module } from "../track/Module.js";
import { CharacterController } from "../simulation/CharacterController.js";
import { RapierSimulation } from "../simulation/RapierSimulation.js";
import { BASE_RACE_TRACK } from "../track/baseRace.js";
import { SLIP_STREAM_TRACK } from "../track/slipStream.js";
import { DeckRider } from "./deckRider.js";
import { formatImpactLog, formatStepOffTraces } from "./harnessProbes.js";
import { loadTestLibrary, playSection } from "./sectionHarness.js";
import { SweeperHold } from "./sweeperHold.js";

/*
 * The section harness's instruments (ticket 14's measuring tool, committed):
 * off by default and leaving nothing wrapped, and when on, recording what
 * they say they record.
 */

let library: Record<string, Module>;
beforeAll(async () => {
  library = await loadTestLibrary();
}, 120_000);

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const wrapped = (): unknown[] => [
  SweeperHold.prototype.hold,
  DeckRider.prototype.steer,
  CharacterController.prototype.applyImpact,
  (RapierSimulation.prototype as Any).resolveBump,
  (RapierSimulation.prototype as Any).resolveMovingSegmentContacts,
];

describe("the section harness's instruments (M17 ticket 14's tool)", () => {
  it("are off by default: no fields on the outcome, nothing wrapped during or after", async () => {
    const before = wrapped();
    let during: unknown[] = [];
    const hold = SweeperHold.prototype.hold;
    // Look at the prototypes from inside a run, through the one hook every Bot calls.
    SweeperHold.prototype.hold = function (this: SweeperHold, ...args: Parameters<typeof hold>) {
      during = wrapped();
      return hold.apply(this, args);
    };
    try {
      const outcome = await playSection({ track: SLIP_STREAM_TRACK, library, leg: 2, level: "hard", seed: "probes:off", capSeconds: 5, bots: 4 });
      expect(outcome.impacts).toBeUndefined();
      expect(outcome.stepOffs).toBeUndefined();
    } finally {
      SweeperHold.prototype.hold = hold;
    }
    expect(during.slice(1)).toEqual(before.slice(1));
    expect(wrapped()).toEqual(before);
  }, 120_000);

  it("log a spin bar's Impacts with the Segment, the speeds and the hook, and put every wrapper back", async () => {
    const before = wrapped();
    const outcome = await playSection({ track: SLIP_STREAM_TRACK, library, leg: 2, level: "hard", seed: "holds:07m:2:hard:0", capSeconds: 40, impactLog: true });
    expect(wrapped()).toEqual(before);
    const impacts = outcome.impacts!;
    expect(impacts.length).toBeGreaterThan(0);
    const bar = impacts.filter((i) => i.source.kind === "segment" && i.source.segmentIndex === 97);
    expect(bar.length).toBeGreaterThan(0);
    for (const i of impacts) {
      expect(i.magnitude).toBeGreaterThanOrEqual(4);
      expect(i.closing).toBeGreaterThan(0);
      expect(["Controlled", "Sliding"]).toContain(i.motionState);
      expect(i.hook).not.toBe("");
    }
    expect(outcome.bumps).toBeGreaterThanOrEqual(impacts.filter((i) => i.source.kind === "character").length);
    // A Stagger Fall the harness counted is joined to an Impact before it.
    const staggerFalls = outcome.where.filter((w) => / Stagger at /.test(w)).length;
    expect(impacts.filter((i) => i.fall?.cause === "Stagger").length).toBeGreaterThanOrEqual(Math.min(1, staggerFalls));
    expect(formatImpactLog(impacts, outcome.bumps!)).toContain("seg 97");
  }, 300_000);

  it("trace every step-off with the ground it left and the Ticks before it", async () => {
    // The base race's whole-Race seed at HARD: ticket 14 traced a step-off on the moving rows at Tick 1589.
    // Asserted as "one trace per step-off", so it holds when ticket 15 takes that step-off away.
    const outcome = await playSection({ track: BASE_RACE_TRACK, library, leg: 0, whole: true, level: "hard", seed: "races:base race:hard", capSeconds: 60, stepOffTrace: true });
    const stepOffs = outcome.where.filter((w) => / step-off at /.test(w)).length;
    expect(outcome.stepOffs!.length).toBe(stepOffs);
    for (const t of outcome.stepOffs!) {
      expect(t.rows.length).toBeGreaterThan(0);
      expect(t.rows[t.rows.length - 1]!.tick).toBeLessThanOrEqual(t.fallTick);
      expect(t.rows.some((r) => r.tick === t.tick)).toBe(true);
      expect(Number.isFinite(t.ground.position.y)).toBe(true);
    }
    if (stepOffs > 0) expect(formatStepOffTraces(outcome.stepOffs!)).toContain("step-off: last stood");
  }, 600_000);
});
