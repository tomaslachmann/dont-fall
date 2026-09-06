import {
  CAPSULE_ERR_FLAT_EPSILON_M,
  CAPSULE_ERR_HALFLIFE_MS,
  MAX_BUFFERED_INPUT_TICKS,
  MAX_STEPS_PER_FRAME,
  RECONCILE_HARDSNAP_M,
  RECONCILE_POSITION_EPSILON,
  RapierSimulation,
  TICK_MS,
  addVec3,
  decayPositionOffset,
  isDownMotionState,
  needsCorrection,
  subVec3,
  type CharacterMotionState,
  type CharacterSnapshot,
  type PropSnapshot,
  type SimInputs,
  type SimState,
  type Vec3,
} from "@dont-fall/shared";
import type { PropPredictionController } from "./propPrediction.js";

/** Absorbs float drift so an exact multiple of `TICK_MS` doesn't lose its last tick (mirrors `advanceFixed`'s own guard). */
const EPSILON_MS = 1e-6;

/**
 * Tuning this class defaults to the real shipped values for (M4.5 ticket
 * 02) — `game.ts` never overrides any of these, so production always gets
 * exactly `needsCorrection`'s own real gate. The overrides exist for
 * `predictionRegression.harness.test.ts`'s own historical/comparison
 * scenarios (a retired threshold, a tuning sweep) to construct this same
 * real class instead of porting it, without teaching production code to
 * vary values nothing in the shipped game ever varies.
 */
export interface PredictionLoopConfig {
  /** Overrides the correction gate's position-error threshold. Non-default means this is deliberately NOT `needsCorrection`'s own real gate — see {@link PredictionLoop.reconcile}. */
  reconcileEpsilon?: number;
  /** Overrides the hard-snap distance past which the capsule render offset drops instead of decaying. */
  hardSnapM?: number;
  /** Overrides the capsule render-time offset's decay half-life. */
  capsuleHalfLifeMs?: number;
  /**
   * Whether a reconcile seeds `positionHistory` at the acked tick before
   * replaying (ADR 0013 ticket 05c) — always `true` in production; `false`
   * reproduces the pre-fix behavior for the harness's own regression check
   * that the fix is what it says it is.
   */
  keepAckedInHistory?: boolean;
}

/** What a `reconcile()` call did, for the caller's own metrics/HUD — a display concern this class doesn't own. */
export interface ReconcileResult {
  corrected: boolean;
  /** The distance between the predicted and reported position at the acked tick, or `null` when nothing was comparable (e.g. down). */
  positionError: number | null;
}

/**
 * The client's predict/reconcile core (M4.5 ticket 02) — ADR 0013's
 * client-side prediction loop, extracted so `predictionRegression.harness.test.ts`
 * can drive PRODUCTION code instead of a hand-maintained port of it (its own
 * header used to say so). Deterministic; no DOM, no socket, no
 * `requestAnimationFrame` — those stay in `game.ts`'s frame.
 *
 * Owns: the fixed-timestep accumulator (ADR 0004), input buffering by tick
 * (ADR 0021), the reconciliation correction gate and replay (ADR 0013 /
 * 0015 / 0023 / 0026), and the local Character's own decaying render-time
 * error offset (ADR 0026).
 *
 * Deliberately does NOT own: LEAD feedback's own algorithm — the caller
 * computes how much extra or less time to accumulate this frame and hands it
 * in as part of `advanceMs`, the same boundary `game.ts`'s own frame loop
 * already drew between "decide the LEAD step" and "run the accumulator." Nor
 * PropPrediction (a separate, already-extracted concern, passed in only where
 * `reconcile` needs to coordinate with it), nor anything about
 * rendering/HUD/sockets/metrics.
 */
export class PredictionLoop {
  private readonly sim: RapierSimulation;
  private readonly myId: string;
  private readonly reconcileEpsilon: number;
  private readonly hardSnapM: number;
  private readonly capsuleHalfLifeMs: number;
  private readonly keepAckedInHistory: boolean;

  /** This client's own monotonic sim-tick counter (ADR 0027). */
  tick = 0;
  private seeded = false;
  accumulatorMs = 0;
  /** State one tick behind `sim`'s current snapshot, for render interpolation. */
  previousSnapshot: SimState | undefined;
  /** Every input sent but not yet acked, oldest first — the tail of this is what `game.ts` sends over the socket. */
  readonly inputBuffer: { tick: number; input: SimInputs }[] = [];
  private readonly positionHistory = new Map<number, Vec3>();
  // The prediction tick this Character first went down on, or null while up
  // (ADR 0023 prediction-tick guard) — a server report of "not down" for an
  // input tick before this one hasn't seen the knockdown yet, and must not
  // revert the just-started ragdoll.
  private predictedDownAtTick: number | null = null;
  /** The local Character's decaying render-time reconciliation offset (ADR 0026) — added to the drawn pose, never the sim. */
  capsuleErrorOffset: Vec3 = { x: 0, y: 0, z: 0 };
  private offsetMotionState: CharacterMotionState = "Controlled";

  constructor(sim: RapierSimulation, myId: string, config: PredictionLoopConfig = {}) {
    this.sim = sim;
    this.myId = myId;
    this.reconcileEpsilon = config.reconcileEpsilon ?? RECONCILE_POSITION_EPSILON;
    this.hardSnapM = config.hardSnapM ?? RECONCILE_HARDSNAP_M;
    this.capsuleHalfLifeMs = config.capsuleHalfLifeMs ?? CAPSULE_ERR_HALFLIFE_MS;
    this.keepAckedInHistory = config.keepAckedInHistory ?? true;
  }

  /** Whether {@link seed} has already run — the caller free-runs the tick counter from 0 until this is true (ADR 0027). */
  get isSeeded(): boolean {
    return this.seeded;
  }

  /** How many predicted positions are still buffered for a future reconcile — a diagnostic read, not something gameplay logic needs. */
  get positionHistorySize(): number {
    return this.positionHistory.size;
  }

  /**
   * Seed {@link tick} into the server's own tick space, once — required so
   * the server can apply `input[serverTick]` instead of FIFO next-in-queue
   * (ADR 0027). A no-op after the first call.
   */
  seed(estimatedServerTick: number, leadTicks: number): void {
    if (this.seeded) return;
    this.tick = Math.round(estimatedServerTick) + leadTicks;
    this.inputBuffer.length = 0;
    this.positionHistory.clear();
    this.seeded = true;
  }

  /**
   * Advance the accumulator by `advanceMs` (elapsed wall-clock time, already
   * combined with this frame's own LEAD adjustment by the caller) and run the
   * fixed-timestep prediction to catch up, buffering each tick's `input` by
   * tick number for reconciliation and resend. A stall longer than
   * {@link MAX_STEPS_PER_FRAME} ticks' worth drops its backlog rather than
   * spiralling trying to catch up.
   *
   * `onBuffered`, if given, runs immediately after each tick's input is
   * pushed to {@link inputBuffer} but *before* that tick is simulated —
   * `game.ts` sends the buffer's redundant tail (ADR 0021) from exactly this
   * point, once per tick, the same interleaving the frame loop used before
   * this class existed. A single call after the whole loop would instead
   * send every backlogged tick's own packet with the *final* buffer
   * contents, changing what ADR 0021 actually puts on the wire during a
   * multi-tick catch-up frame — moved code must not move that.
   */
  step(input: SimInputs, advanceMs: number, onBuffered?: () => void): void {
    this.accumulatorMs = Math.min(this.accumulatorMs + advanceMs, TICK_MS * MAX_STEPS_PER_FRAME);
    let steps = 0;
    while (this.accumulatorMs + EPSILON_MS >= TICK_MS && steps < MAX_STEPS_PER_FRAME) {
      this.recordTick(this.tick + 1, input, onBuffered);
      this.accumulatorMs -= TICK_MS;
      steps += 1;
    }
    if (this.accumulatorMs < 0) this.accumulatorMs = 0;
    this.trimBuffers();
  }

  /**
   * Advance by exactly `tick` (which must be {@link tick} + 1 for an
   * ordinary caller): buffer `input`, simulate it, and record the resulting
   * position for {@link reconcile}'s replay baseline. `onBuffered`, if
   * given, runs immediately after `input` is pushed to {@link inputBuffer}
   * but *before* it is simulated — see {@link step}'s own doc for why that
   * exact ordering matters (ADR 0021).
   *
   * {@link step} is this called in a loop from its own accumulator; exposed
   * separately for a caller with its own tick numbering instead of an
   * elapsed-time accumulator (`predictionRegression.harness.test.ts`'s own
   * tick-addressed research mode, which chases the server's tick estimate
   * directly rather than accumulating wall-clock time — ADR 0027 calls this
   * "not yet validated" outside a real client/server integration test, so it
   * is not something production or this class's own `step` need to model).
   */
  recordTick(tick: number, input: SimInputs, onBuffered?: () => void): void {
    this.tick = tick;
    this.inputBuffer.push({ tick, input });
    onBuffered?.();

    this.previousSnapshot = this.sim.snapshot();
    this.sim.tick({ [this.myId]: input });
    const predicted = this.sim.snapshot().characters[this.myId]!;
    this.positionHistory.set(tick, predicted.position);
    this.predictedDownAtTick = isDownMotionState(predicted.motionState) ? (this.predictedDownAtTick ?? tick) : null;
    this.trimBuffers();
  }

  /** Bound the buffers if snapshots stop arriving (a stalled connection). */
  private trimBuffers(): void {
    while (this.inputBuffer.length > MAX_BUFFERED_INPUT_TICKS) this.inputBuffer.shift();
    for (const t of [...this.positionHistory.keys()]) {
      if (t <= this.tick - MAX_BUFFERED_INPUT_TICKS) this.positionHistory.delete(t);
    }
  }

  private static distance(a: Vec3, b: Vec3): number {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  }

  /**
   * The correction gate — `needsCorrection` itself whenever `reconcileEpsilon`
   * is the real default, which is always true in production (`game.ts` never
   * overrides it): there is exactly one gate shipping. A non-default epsilon
   * means this instance was constructed for a scenario deliberately comparing
   * against a *different* threshold than what `needsCorrection` hardcodes
   * (`predictionRegression.harness.test.ts`'s own reason for
   * {@link PredictionLoopConfig.reconcileEpsilon} existing) — `needsCorrection`
   * structurally cannot express that, so this falls back to the same
   * conditions with the configured epsilon in its place.
   */
  private needsCorrectionFor(
    server: Pick<CharacterSnapshot, "motionState" | "finishTick">,
    local: Pick<CharacterSnapshot, "motionState" | "finishTick">,
    positionError: number,
  ): boolean {
    if (this.reconcileEpsilon === RECONCILE_POSITION_EPSILON) return needsCorrection(server, local, positionError);
    return (
      isDownMotionState(server.motionState) ||
      isDownMotionState(local.motionState) ||
      server.motionState !== local.motionState ||
      server.finishTick !== local.finishTick ||
      positionError > this.reconcileEpsilon
    );
  }

  /**
   * Reconcile the local prediction against the server's authoritative
   * snapshot for our own Character (ticket 05, ADR 0015). The server echoes
   * the last input tick it applied (`lastInputTick`); everything predicted
   * past that point is replayed forward from the corrected base.
   *
   * A server-reported down state (`Ragdoll`/`GettingUp`) is always synced,
   * unconditionally — safe because `sim` is non-`authoritative` (see
   * `game.ts`'s own construction of it): it never decides on its own when a
   * knockdown ends, so it can only ever be at or behind the server's
   * down-state, never ahead of it, and there is no "stale vs. live" report
   * left to tell apart (ADR 0015 supersedes ADR 0014's `bumpSeq` gate).
   *
   * `propPrediction` is coordinated with, not owned: the caller passes in
   * whichever instance is currently live (recreated on a Track reload, same
   * as this class itself), since a Prop's own predicted/pinned state has to
   * stay interleaved with exactly when the Character's own replay runs.
   */
  reconcile(
    server: CharacterSnapshot,
    serverTick: number,
    serverProps: readonly PropSnapshot[],
    propPrediction: PropPredictionController,
  ): ReconcileResult {
    const acked = server.lastInputTick;
    // Keep the entry AT `acked` — that's the tick the server's report is for,
    // and the baseline the same-tick position check compares against.
    for (const t of [...this.positionHistory.keys()]) if (t < acked) this.positionHistory.delete(t);
    const unacked = this.inputBuffer.filter((entry) => entry.tick > acked);
    this.inputBuffer.splice(0, this.inputBuffer.length, ...unacked);

    const localChar = this.sim.snapshot().characters[this.myId]!;
    const serverDown = isDownMotionState(server.motionState);
    const localDown = isDownMotionState(localChar.motionState);

    // Prediction-tick guard (ADR 0023): the server can't have seen a
    // knockdown it hasn't yet processed the input for. A "not down" report
    // for an input tick before we predicted going down is stale — leave the
    // ragdoll alone.
    if (localDown && !serverDown && this.predictedDownAtTick !== null && acked < this.predictedDownAtTick) {
      return { corrected: false, positionError: null };
    }

    const predictedAtAck = this.positionHistory.get(acked);
    const positionError = predictedAtAck ? PredictionLoop.distance(predictedAtAck, server.position) : Infinity;
    const motionChanged = server.motionState !== localChar.motionState;

    // ADR 0026: the *simulation* reconciles on any real disagreement — a
    // float-noise epsilon, not the old one-walk-step "correct or ignore" gate
    // that let an ordinary phase slip park exactly on the threshold. The
    // render-time offset below is what keeps that invisible.
    if (!this.needsCorrectionFor(server, localChar, positionError)) return { corrected: false, positionError: null };

    const simBefore = localChar.position;
    this.sim.reconcileCharacter(this.myId, server);
    // The state right after this correction — captured once and reused below
    // (for the Prop offset reseed, the capsule offset, and the render-interp
    // baseline) instead of re-reading the whole sim from Rapier each time.
    let afterCorrection: SimState;
    if (!serverDown) {
      // Realign the tick counter so replayed ticks see the right Spinner phase,
      // pin every Prop to the fresh authoritative pose so replayed ticks slide
      // against obstacles where the server has them, then re-run every
      // unacknowledged input forward from the corrected base.
      this.sim.syncTick(serverTick);
      this.sim.syncPropsToSnapshot(serverProps);
      // Predicted Props (ADR 0022): snap each one's body to the server's tick-T
      // state, remember where it was *rendered*, replay, then re-seed the error
      // offset so the correction eases in rather than popping.
      const renderedBefore = propPrediction.captureBeforeReconcile(this.sim.snapshot().props);
      for (const i of propPrediction.predictedIndices) {
        const sp = serverProps[i];
        if (sp) this.sim.applyAuthoritativePropState(i, sp);
      }
      const replayed = this.sim.replayLocalCharacter(this.myId, unacked.map((entry) => entry.input));
      afterCorrection = this.sim.snapshot();
      propPrediction.reseedAfterReconcile(renderedBefore, afterCorrection.props);
      this.positionHistory.clear();
      // Keep the acked tick itself in history: a snapshot that repeats the
      // same ack (a starved server tick, a duplicate, a reorder) then finds a
      // baseline and computes error 0 instead of Infinity — not a spurious
      // full replay (ADR 0013 ticket 05c; always on in production — see
      // {@link PredictionLoopConfig.keepAckedInHistory}).
      if (this.keepAckedInHistory) this.positionHistory.set(acked, { ...server.position });
      unacked.forEach((entry, i) => {
        const p = replayed[i];
        if (p) this.positionHistory.set(entry.tick, p);
      });

      // ADR 0026: re-seed the local Character's own render-time error offset
      // exactly like `PropPredictionController.reseedAfterReconcile` — capture
      // how far the replay moved the sim pose, then let the offset (not the
      // sim) carry that delta and decay it out. A genuine desync (past the
      // hard-snap distance) or a motionState change drops the offset instead.
      if (!localDown) {
        if (motionChanged || positionError > this.hardSnapM) {
          this.capsuleErrorOffset = { x: 0, y: 0, z: 0 };
        } else {
          const after = afterCorrection.characters[this.myId]!.position;
          this.capsuleErrorOffset = addVec3(this.capsuleErrorOffset, subVec3(simBefore, after));
          if (Math.hypot(this.capsuleErrorOffset.x, this.capsuleErrorOffset.y, this.capsuleErrorOffset.z) > this.hardSnapM) {
            this.capsuleErrorOffset = { x: 0, y: 0, z: 0 };
          }
        }
      }
    } else {
      this.positionHistory.clear();
      afterCorrection = this.sim.snapshot();
    }
    // Don't let render interpolation blend a frame through the correction —
    // the error offset above carries the local Character's own visual delta.
    this.previousSnapshot = afterCorrection;

    return { corrected: true, positionError: Number.isFinite(positionError) ? positionError : null };
  }

  /**
   * Decay the local Character's own render-time correction offset one frame
   * (ADR 0026), same as a pushed Prop's (ADR 0022). Never carried across a
   * motionState change or while down — the offset only smooths corrections
   * against the interpolated Controlled/Stagger pose. Call once per render
   * frame, after reading `motionState` off the frame's own drawn snapshot.
   */
  decayCapsuleOffset(elapsedMs: number, motionState: CharacterMotionState, isDown: boolean): void {
    if (motionState !== this.offsetMotionState || isDown) {
      this.capsuleErrorOffset = { x: 0, y: 0, z: 0 };
      this.offsetMotionState = motionState;
    } else {
      this.capsuleErrorOffset = decayPositionOffset(
        this.capsuleErrorOffset,
        elapsedMs,
        this.capsuleHalfLifeMs,
        this.hardSnapM,
        CAPSULE_ERR_FLAT_EPSILON_M,
      );
    }
  }
}
