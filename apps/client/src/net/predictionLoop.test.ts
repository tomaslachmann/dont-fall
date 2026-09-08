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
} from "@dont-fall/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { PredictionLoop } from "./predictionLoop.js";
import { PropPredictionController } from "./propPrediction.js";

beforeAll(async () => {
  await initPhysics();
});

const GROUND = { center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 20, y: 0.5, z: 20 } };
const SPAWN = { x: 0, y: 1.2, z: 0 };
const IDLE: SimInputs = { moveDirection: { x: 0, y: 0, z: 0 }, jumpHeld: false, dashHeld: false, facing: 0, hitHeld: false };
const EAST: SimInputs = { moveDirection: { x: 1, y: 0, z: 0 }, jumpHeld: false, dashHeld: false, facing: 0, hitHeld: false };

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
    loop.step(IDLE, TICK_MS / 2);
    expect(loop.tick).toBe(0);
    expect(loop.accumulatorMs).toBeCloseTo(TICK_MS / 2, 5);
  });

  it("runs exactly the ticks the accumulated time covers, buffering each by tick number", () => {
    const loop = new PredictionLoop(newSim(), DEFAULT_CHARACTER_ID);
    loop.step(EAST, TICK_MS * 3);
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
    loop.step(IDLE, TICK_MS * (MAX_STEPS_PER_FRAME + 50));
    expect(loop.tick).toBe(MAX_STEPS_PER_FRAME);
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
    expect(result).toEqual({ corrected: false, positionError: null });
  });

  it("corrects and replays when the server disagrees on position past the epsilon", () => {
    const loop = new PredictionLoop(newSim(), DEFAULT_CHARACTER_ID);
    loop.step(EAST, TICK_MS * 3);
    const result = loop.reconcile(serverReport({ position: { x: 5, y: 1.2, z: 0 } }), 1, [], new PropPredictionController());
    expect(result.corrected).toBe(true);
    expect(result.positionError).toBeGreaterThan(1);
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
    // put at the server's corrected position rather than continuing east.
    expect(sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.position.x).toBeCloseTo(5, 5);
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
