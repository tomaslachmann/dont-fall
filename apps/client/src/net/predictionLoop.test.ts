import {
  DEFAULT_CHARACTER_ID,
  MAX_BUFFERED_INPUT_TICKS,
  MAX_STEPS_PER_FRAME,
  RapierSimulation,
  TICK_MS,
  characterSnapshot,
  initPhysics,
  type CharacterSnapshotFields,
  type SimInputs,
  wrapAngle,
} from "@dont-fall/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { PredictionLoop } from "./predictionLoop.js";
import { PropPredictionController } from "./propPrediction.js";
import { inputPerTick } from "./tickInput.js";

beforeAll(async () => {
  await initPhysics();
});

const GROUND = { center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 20, y: 0.5, z: 20 } };
const SPAWN = { x: 0, y: 1.2, z: 0 };
const IDLE: SimInputs = { moveDirection: { x: 0, y: 0, z: 0 }, jumpHeld: false, dashHeld: false, facing: 0, hitHeld: false, grabHeld: false };
const EAST: SimInputs = { moveDirection: { x: 1, y: 0, z: 0 }, jumpHeld: false, dashHeld: false, facing: 0, hitHeld: false, grabHeld: false };

const newSim = (): RapierSimulation => {
  const sim = new RapierSimulation({ statics: [GROUND], withDefaultCharacter: false, authoritative: false });
  sim.addCharacter(DEFAULT_CHARACTER_ID, SPAWN);
  return sim;
};

/** A minimal, otherwise-neutral server report — override only what a test cares about. */
const serverReport = (overrides: Partial<CharacterSnapshotFields> = {}) =>
  characterSnapshot({ position: SPAWN, grounded: true, lastInputTick: 1, ...overrides });

describe("PredictionLoop — seeding (ADR 0027)", () => {
  it("free-runs the tick counter from 0 until seeded", () => {
    const loop = new PredictionLoop(newSim(), DEFAULT_CHARACTER_ID);
    expect(loop.isSeeded).toBe(false);
    expect(loop.tick).toBe(0);
  });

  it("seeds into the server's own tick space plus the LEAD, once", () => {
    const loop = new PredictionLoop(newSim(), DEFAULT_CHARACTER_ID);
    loop.seed(500, 4);
    expect(loop.isSeeded).toBe(true);
    expect(loop.tick).toBe(504);
  });

  it("ignores a second seed call — it is a one-shot", () => {
    const loop = new PredictionLoop(newSim(), DEFAULT_CHARACTER_ID);
    loop.seed(500, 4);
    loop.seed(999, 10);
    expect(loop.tick).toBe(504);
  });
});

describe("PredictionLoop — step (the fixed-timestep accumulator)", () => {
  it("runs no ticks and just accumulates when advanceMs is under one tick", () => {
    const loop = new PredictionLoop(newSim(), DEFAULT_CHARACTER_ID);
    expect(loop.step(IDLE, TICK_MS / 2)).toBe(0);
    expect(loop.tick).toBe(0);
    expect(loop.accumulatorMs).toBeCloseTo(TICK_MS / 2, 5);
  });

  it("runs exactly the ticks the accumulated time covers, buffering each by tick number", () => {
    const loop = new PredictionLoop(newSim(), DEFAULT_CHARACTER_ID);
    expect(loop.step(EAST, TICK_MS * 3)).toBe(3);
    expect(loop.tick).toBe(3);
    expect(loop.inputBuffer.map((e) => e.tick)).toEqual([1, 2, 3]);
    expect(loop.inputBuffer.every((e) => e.input === EAST)).toBe(true);
  });

  it("calls onBuffered once per tick, immediately after that tick's own input is buffered but before it is simulated", () => {
    const sim = newSim();
    const loop = new PredictionLoop(sim, DEFAULT_CHARACTER_ID);
    const seenAtCall: { bufferLength: number; simTick: number }[] = [];
    loop.step(EAST, TICK_MS * 3, () => {
      seenAtCall.push({ bufferLength: loop.inputBuffer.length, simTick: sim.snapshot().tick });
    });
    expect(seenAtCall).toEqual([
      { bufferLength: 1, simTick: 0 },
      { bufferLength: 2, simTick: 1 },
      { bufferLength: 3, simTick: 2 },
    ]);
  });

  it("clamps a long stall to MAX_STEPS_PER_FRAME rather than spiralling to catch up", () => {
    const loop = new PredictionLoop(newSim(), DEFAULT_CHARACTER_ID);
    expect(loop.step(IDLE, TICK_MS * (MAX_STEPS_PER_FRAME + 50))).toBe(MAX_STEPS_PER_FRAME);
    // Only the simulation is clamped (ADR 0109): the tick still covers the
    // whole stall, the 50 ticks it could not run skipped.
    expect(loop.tick).toBe(MAX_STEPS_PER_FRAME + 50);
  });

  it("advances the tick by the whole elapsed time through a stall, simulating only the ticks after the skip (ADR 0109)", () => {
    const sim = newSim();
    const loop = new PredictionLoop(sim, DEFAULT_CHARACTER_ID);
    loop.seed(1000, 3);
    loop.step(IDLE, TICK_MS * 2);
    // A 30.5-tick stall: 25 skipped, the last 5 run, half a tick banked.
    expect(loop.step(IDLE, TICK_MS * 30.5)).toBe(MAX_STEPS_PER_FRAME);
    expect(loop.tick).toBe(1005 + 30);
    expect(loop.accumulatorMs).toBeCloseTo(TICK_MS / 2, 6);
    expect(loop.inputBuffer.map((e) => e.tick)).toEqual([1004, 1005, 1031, 1032, 1033, 1034, 1035]);
    // The local sim's own Tick follows, so a Moving Segment is posed where the
    // server has it rather than 25 ticks behind.
    expect(sim.snapshot().tick).toBe(loop.tick);
  });

  it(
    "keeps a real sub-tick remainder banked when a frame only grazes the MAX_STEPS_PER_FRAME clamp " +
      "(code review, M7 ticket 01) — a sustained low frame rate must not silently lose accumulated time " +
      "the way a genuine multi-second stall correctly discards it",
    () => {
      const loop = new PredictionLoop(newSim(), DEFAULT_CHARACTER_ID);
      loop.step(IDLE, TICK_MS * (MAX_STEPS_PER_FRAME + 0.5));
      expect(loop.tick).toBe(MAX_STEPS_PER_FRAME);
      expect(loop.accumulatorMs).toBeCloseTo(TICK_MS * 0.5, 5);
    },
  );

  it("discards the backlog rather than banking it once a stall leaves a whole tick or more behind", () => {
    const loop = new PredictionLoop(newSim(), DEFAULT_CHARACTER_ID);
    loop.step(IDLE, TICK_MS * (MAX_STEPS_PER_FRAME + 50));
    expect(loop.accumulatorMs).toBeLessThan(TICK_MS);
  });

  it("bounds the input buffer to MAX_BUFFERED_INPUT_TICKS across repeated frames", () => {
    const loop = new PredictionLoop(newSim(), DEFAULT_CHARACTER_ID);
    for (let i = 0; i < MAX_BUFFERED_INPUT_TICKS + 10; i += 1) loop.step(IDLE, TICK_MS);
    expect(loop.inputBuffer.length).toBeLessThanOrEqual(MAX_BUFFERED_INPUT_TICKS);
  });

  it("defaults phase to RUNNING — a caller that never passes it still predicts movement", () => {
    const sim = newSim();
    const loop = new PredictionLoop(sim, DEFAULT_CHARACTER_ID);
    loop.step(EAST, TICK_MS * 3);
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position.x).toBeGreaterThan(SPAWN.x);
  });

  it("still buffers input while phase-locked, but the shared step refuses to move the Character (M5 ticket 01)", () => {
    const sim = newSim();
    const loop = new PredictionLoop(sim, DEFAULT_CHARACTER_ID);
    loop.step(EAST, TICK_MS * 3, undefined, "COUNTDOWN");
    expect(loop.inputBuffer.map((e) => e.tick)).toEqual([1, 2, 3]);
    expect(loop.inputBuffer.every((e) => e.input === EAST)).toBe(true);
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position.x).toBeCloseTo(SPAWN.x, 5);
  });
});

describe("PredictionLoop — step with each tick's own input (ADR 0109)", () => {
  const facingOf = (loop: PredictionLoop): number[] => loop.inputBuffer.map((e) => e.input.facing);

  it("hands the ticks of one frame increasing fractions, so each carries its own facing", () => {
    const loop = new PredictionLoop(newSim(), DEFAULT_CHARACTER_ID);
    const fractions: number[] = [];
    const perTick = inputPerTick({ ...IDLE, facing: 0.7 }, 0);
    loop.step((fraction) => {
      fractions.push(fraction);
      return perTick(fraction);
    }, TICK_MS * 3.5);
    // Boundaries at 1, 2 and 3 ticks into a 3.5-tick advance.
    expect(fractions.map((f) => f * 3.5)).toEqual([1, 2, 3].map((k) => expect.closeTo(k, 9)));
    expect(facingOf(loop)).toEqual([0.2, 0.4, 0.6].map((f) => expect.closeTo(f, 9)));
  });

  it("puts a tick where the accumulator crossed its boundary, carrying time from the frame before", () => {
    const loop = new PredictionLoop(newSim(), DEFAULT_CHARACTER_ID);
    loop.step(IDLE, TICK_MS * 0.75);
    const fractions: number[] = [];
    loop.step((fraction) => {
      fractions.push(fraction);
      return IDLE;
    }, TICK_MS);
    expect(fractions).toEqual([expect.closeTo(0.25, 9)]);
  });

  it("drops a clamped stall's backlog from the start of the advance, so its last tick meets the next frame", () => {
    const loop = new PredictionLoop(newSim(), DEFAULT_CHARACTER_ID);
    const advanceMs = TICK_MS * (MAX_STEPS_PER_FRAME + 50.25);
    const fractions: number[] = [];
    loop.step((fraction) => {
      fractions.push(fraction);
      return IDLE;
    }, advanceMs);
    expect(fractions).toHaveLength(MAX_STEPS_PER_FRAME);
    expect(fractions.at(-1)! * advanceMs + loop.accumulatorMs).toBeCloseTo(advanceMs, 6);
    for (let i = 1; i < fractions.length; i += 1) expect((fractions[i]! - fractions[i - 1]!) * advanceMs).toBeCloseTo(TICK_MS, 6);
  });

  it("gives every tick the current facing on the first frame, before there is a previous one", () => {
    const loop = new PredictionLoop(newSim(), DEFAULT_CHARACTER_ID);
    loop.step(inputPerTick({ ...IDLE, facing: 0.7 }, null), TICK_MS * 3);
    expect(facingOf(loop)).toEqual([0.7, 0.7, 0.7]);
  });

  it("eases the facing across the ±π seam the short way", () => {
    const loop = new PredictionLoop(newSim(), DEFAULT_CHARACTER_ID);
    loop.step(inputPerTick({ ...IDLE, facing: -Math.PI + 0.1 }, Math.PI - 0.1), TICK_MS * 2);
    expect(facingOf(loop)).toEqual([expect.closeTo(Math.PI, 9), expect.closeTo(-Math.PI + 0.1, 9)]);
  });

  /**
   * A steady turn, sampled the way the frame loop samples it: once per frame,
   * the body's yaw as the previous frame left it, on rAF timestamps with half a
   * millisecond of noise and a dropped frame every couple of seconds.
   */
  const steadyTurnIncrements = (hz: number, perTick: boolean): number[] => {
    const loop = new PredictionLoop(newSim(), DEFAULT_CHARACTER_ID);
    const RAD_PER_S = 3;
    let seed = 7;
    const noise = (): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296 - 0.5;
    };
    const period = 1000 / hz;
    let nominal = 0;
    let lastMs = 0;
    let drawnFacing = 0;
    let previousFacing: number | null = null;
    const sent: number[] = [];
    for (let frame = 0; frame < hz * 5; frame += 1) {
      nominal += frame % 300 === 299 ? 2 * period : period;
      const nowMs = nominal + noise();
      const input = { ...IDLE, facing: drawnFacing };
      loop.step(perTick ? inputPerTick(input, previousFacing) : input, nowMs - lastMs, () => {
        sent.push(loop.inputBuffer.at(-1)!.input.facing);
      });
      previousFacing = input.facing;
      drawnFacing = wrapAngle((RAD_PER_S * nowMs) / 1000);
      lastMs = nowMs;
    }
    return sent.slice(5).map((facing, i) => wrapAngle(facing - sent[i + 4]!));
  };
  const cv = (xs: number[]): number => {
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length) / mean;
  };

  it("turns a steady turn sampled at 144 Hz into even per-tick steps", () => {
    // One sample stamped on every tick of its frame: each tick carries 4 or 5
    // frames' worth of turn. Eased per tick, the steps stay within a few %.
    expect(cv(steadyTurnIncrements(144, false))).toBeGreaterThan(0.05);
    expect(cv(steadyTurnIncrements(144, true))).toBeLessThan(0.05);
  });
});

describe("PredictionLoop — reconcile (the correction gate, ADR 0013/0026)", () => {
  it("does nothing when the server's report already matches the prediction", () => {
    const sim = newSim();
    const loop = new PredictionLoop(sim, DEFAULT_CHARACTER_ID);
    loop.step(IDLE, TICK_MS);
    // The real settled position, not the raw spawn constant — gravity moves
    // the capsule a hair even standing still, and this test is about the
    // gate agreeing with itself, not about zero physics drift.
    const settled = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position;
    const result = loop.reconcile(serverReport({ position: settled }), 1, [], new PropPredictionController());
    expect(result).toEqual({ corrected: false, positionError: null, replayedTicks: 0 });
  });

  it("corrects and replays when the server disagrees on position past the epsilon", () => {
    const loop = new PredictionLoop(newSim(), DEFAULT_CHARACTER_ID);
    loop.step(EAST, TICK_MS * 3);
    const result = loop.reconcile(serverReport({ position: { x: 5, y: 1.2, z: 0 } }), 1, [], new PropPredictionController());
    expect(result.corrected).toBe(true);
    expect(result.positionError).toBeGreaterThan(1);
    // Acked at 1 of 3 predicted: ticks 2 and 3 are simulated again.
    expect(result.replayedTicks).toBe(2);
  });

  it("corrects on a Qualification disagreement even when positions agree (ADR 0039)", () => {
    const loop = new PredictionLoop(newSim(), DEFAULT_CHARACTER_ID);
    loop.step(IDLE, TICK_MS);
    const result = loop.reconcile(serverReport({ finishTick: 999 }), 1, [], new PropPredictionController());
    expect(result.corrected).toBe(true);
  });

  it("honors a custom reconcileEpsilon instead of the real needsCorrection gate", () => {
    const loop = new PredictionLoop(newSim(), DEFAULT_CHARACTER_ID, { reconcileEpsilon: 10 });
    loop.step(EAST, TICK_MS);
    // A real disagreement, but well under the widened 10m epsilon.
    const result = loop.reconcile(serverReport({ position: { x: 0.05, y: 1.2, z: 0 } }), 1, [], new PropPredictionController());
    expect(result.corrected).toBe(false);
  });

  it("keepAckedInHistory: false does not seed a baseline for the acked tick, unlike the production default", () => {
    const withHistory = new PredictionLoop(newSim(), DEFAULT_CHARACTER_ID, { keepAckedInHistory: true });
    withHistory.step(EAST, TICK_MS);
    withHistory.reconcile(serverReport({ position: { x: 3, y: 1.2, z: 0 } }), 1, [], new PropPredictionController());
    // Repeating the same ack (a duplicate/starved snapshot) finds a baseline
    // and reports no correction rather than an infinite error.
    const repeat = withHistory.reconcile(serverReport({ position: { x: 3, y: 1.2, z: 0 } }), 1, [], new PropPredictionController());
    expect(repeat.corrected).toBe(false);

    const withoutHistory = new PredictionLoop(newSim(), DEFAULT_CHARACTER_ID, { keepAckedInHistory: false });
    withoutHistory.step(EAST, TICK_MS);
    withoutHistory.reconcile(serverReport({ position: { x: 3, y: 1.2, z: 0 } }), 1, [], new PropPredictionController());
    // No baseline for the repeated ack — every subsequent reconcile at the
    // same tick sees an infinite error and corrects again.
    const repeatNoHistory = withoutHistory.reconcile(
      serverReport({ position: { x: 3, y: 1.2, z: 0 } }),
      1,
      [],
      new PropPredictionController(),
    );
    expect(repeatNoHistory.corrected).toBe(true);
  });

  it("replays unacked ticks locked when the reconcile itself says the phase is locked (M5 ticket 01)", () => {
    const sim = newSim();
    const loop = new PredictionLoop(sim, DEFAULT_CHARACTER_ID);
    // Predicted forward while (incorrectly) believing input was live — the
    // server's own report below disagrees hard enough to force a replay.
    loop.step(EAST, TICK_MS * 3);
    const result = loop.reconcile(
      serverReport({ position: { x: 5, y: 1.2, z: 0 } }),
      1,
      [],
      new PropPredictionController(),
      "COUNTDOWN",
    );
    expect(result.corrected).toBe(true);
    // The replayed (unacked) ticks 2 and 3 ran locked — the Character stayed
    // put at the server's corrected position rather than continuing east (a
    // tick of walking is ~0.2). Reported grounded 0.34 above the floor, it
    // snaps down onto it (ADR 0084), and a sweep along the floor moves it a
    // few micrometres sideways — hence 4 places, not 5.
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position.x).toBeCloseTo(5, 4);
  });
});

describe("PredictionLoop — decayCapsuleOffset (ADR 0026)", () => {
  it("decays a nonzero offset toward zero", () => {
    const loop = new PredictionLoop(newSim(), DEFAULT_CHARACTER_ID);
    loop.capsuleErrorOffset = { x: 1, y: 0, z: 0 };
    loop.decayCapsuleOffset(100, "Controlled", false);
    expect(loop.capsuleErrorOffset.x).toBeGreaterThan(0);
    expect(loop.capsuleErrorOffset.x).toBeLessThan(1);
  });

  it("drops the offset immediately on a motionState change", () => {
    const loop = new PredictionLoop(newSim(), DEFAULT_CHARACTER_ID);
    loop.capsuleErrorOffset = { x: 1, y: 0, z: 0 };
    loop.decayCapsuleOffset(1, "Stagger", false);
    expect(loop.capsuleErrorOffset).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("drops the offset while down", () => {
    const loop = new PredictionLoop(newSim(), DEFAULT_CHARACTER_ID);
    loop.capsuleErrorOffset = { x: 1, y: 0, z: 0 };
    loop.decayCapsuleOffset(1, "Controlled", true);
    expect(loop.capsuleErrorOffset).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("honors a custom half-life — a shorter one decays faster", () => {
    const fast = new PredictionLoop(newSim(), DEFAULT_CHARACTER_ID, { capsuleHalfLifeMs: 10 });
    const slow = new PredictionLoop(newSim(), DEFAULT_CHARACTER_ID, { capsuleHalfLifeMs: 1000 });
    fast.capsuleErrorOffset = { x: 1, y: 0, z: 0 };
    slow.capsuleErrorOffset = { x: 1, y: 0, z: 0 };
    fast.decayCapsuleOffset(50, "Controlled", false);
    slow.decayCapsuleOffset(50, "Controlled", false);
    expect(fast.capsuleErrorOffset.x).toBeLessThan(slow.capsuleErrorOffset.x);
  });
});
