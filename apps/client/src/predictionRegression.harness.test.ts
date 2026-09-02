/**
 * DIAGNOSTIC HARNESS (throwaway — /diagnosing-bugs Phase 1) for the 2026-09
 * playtest report: "walking straight, the character slightly snaps roughly once
 * a second; and after a collision it doesn't settle exactly at the impact spot."
 *
 * `main.ts`'s frame loop is a DOM/WebSocket closure with no seam, so this file
 * ports the deterministic core of it — the predict loop, `reconcile`, the LEAD
 * feedback, `TimeSync`, `SnapshotInterpolator`, `PropPredictionController` — and
 * runs it against a real authoritative `RapierSimulation` over a virtual clock
 * with a realistic (deterministic, no RNG) network model.
 *
 * The signal: record the *rendered* local-character position every frame while
 * walking at a constant speed, and look for periodic backward/overshoot spikes.
 *
 * Line references to `apps/client/src/main.ts` are as of commit 85d91d7.
 */

import {
  CAPSULE_ERR_FLAT_EPSILON_M,
  CAPSULE_ERR_HALFLIFE_MS,
  LEAD_DRAIN_FRACTION,
  MAX_BUFFERED_INPUT_TICKS,
  MAX_STEPS_PER_FRAME,
  PLAYGROUND_CHECKPOINTS,
  PLAYGROUND_PROPS,
  PLAYGROUND_SPINNERS,
  PLAYGROUND_STATICS,
  RECONCILE_HARDSNAP_M,
  RECONCILE_POSITION_EPSILON,
  RapierSimulation,
  TICK_MS,
  decayPositionOffset,
  type CharacterSnapshot,
  type PropSnapshot,
  type SimInputs,
  type SimState,
  initPhysics,
  interpolateState,
  playgroundSpawn,
} from "@dont-fall/shared";

/**
 * The pre-ADR-0026 "correct or ignore" threshold, kept here only so the
 * baseline/differential scenarios below can still reproduce the original
 * reported bug for comparison. It is not a tuning constant any more —
 * `RECONCILE_POSITION_ERROR` no longer exists in `packages/shared`.
 */
const LEGACY_RECONCILE_THRESHOLD = 0.2;
import { beforeAll, describe, expect, it } from "vitest";
import { NetMetrics } from "./netMetrics.js";
import { PropPredictionController, graceTicksForRtt } from "./propPrediction.js";
import { SnapshotInterpolator } from "./snapshotInterpolation.js";
import { TimeSync } from "./timeSync.js";

beforeAll(async () => {
  await initPhysics();
});

const NORTH: SimInputs = { moveDirection: { x: 0, y: 0, z: -1 }, jumpHeld: false, dashHeld: false };
const EAST: SimInputs = { moveDirection: { x: 1, y: 0, z: 0 }, jumpHeld: false, dashHeld: false };
const IDLE: SimInputs = { moveDirection: { x: 0, y: 0, z: 0 }, jumpHeld: false, dashHeld: false };
const SERVER_CLOCK_OFFSET = 5000; // server performance.now() leads the client's by this

interface HarnessOpts {
  /** One-way base latency (ms). RTT ≈ 2× this. */
  owdMs: number;
  /** Peak extra one-way jitter (ms), applied as a deterministic sine. */
  jitterMs: number;
  /** Frames per second of the client render loop. */
  fps: number;
  /** Toggle the LEAD tick inject/drop feedback (ADR 0021). */
  lead: boolean;
  /** Toggle client↔server clock sync; when off, the interpolator uses its ease-anchor fallback. */
  timeSync: boolean;
  /** Candidate fix: after a reconcile, also store the authoritative position for the acked tick itself. */
  keepAckedInHistory: boolean;
  /** Walk into the wall on the start platform instead of down the course. */
  walkIntoWall: boolean;
  /** Spawn both Characters here instead of the playground spawn (e.g. the open sandbox, clear of the Spinner). */
  spawnOverride?: { x: number; y: number; z: number };
  /** Bypass every ticket-11.8 code path (prop prediction) — the differential for "did 11.8 regress this?". */
  disable118: boolean;
  /** LEAD feedback band [injectBelow, dropAbove] on smoothed commandQueueDepth. Current code: [1, 2.5]. */
  leadBand: [number, number];
  /** Override the (harness-local) legacy correct-or-ignore threshold. */
  reconcileThreshold: number;
  /** Use the pre-code-review LEAD algorithm (maintained appliedLead→targetLead, RTT-seeded) instead of the current queue-feedback one. */
  legacyLead: boolean;
  /** Fractional frame-time jitter (0 = perfectly even frames; 0.15 = ±15%). A hard fps cap on a capable machine is ~0.02–0.05; a struggling one, higher. */
  frameJitter: number;
  /** Every Nth frame, a GC-pause-style hitch of this many ms (0 = none). Real browsers do this even at a fixed cap. */
  hitchEveryFrames: number;
  hitchMs: number;
  /** Which way to walk (default east — the open sandbox has the most clear x-room). */
  walkDir: "north" | "east";

  // ---- proposal knobs (docs/research/m2-prediction-reconciliation-loop.md) ----
  /** 5a: server applies input[serverTick] (else newest tick<serverTick) instead of FIFO shift(). */
  serverInputModel: "fifo" | "tick-addressed";
  /** 5d: reconcile the sim on any error past this (a float-noise epsilon), replacing the 0.2 correct-or-ignore threshold. Set to `reconcileThreshold` when unused. */
  reconcileEpsilon: number;
  /** 5d/5e: render error past this → drop the offset and hard-snap. */
  hardSnapM: number;
  /** 5e: smooth the local-player correction through a decaying render-time capsule error offset instead of an instant baseline reset. */
  capsuleErrorOffset: boolean;
  /** 5e: position half-life (ms) of that offset. */
  capsuleHalfLifeMs: number;
  /** 5f: inject a LEAD tick the moment smoothedQueueDepth < 1, not once per LEAD_ADJUST_FRAMES. */
  immediateLeadInject: boolean;
  /** 5f: generate + send an input every render frame (stamped for the next tick) even on a 0-step frame. */
  sendInputEveryFrame: boolean;
  /** 5f: drain a fat command queue by a small fraction of a tick per frame (continuous), instead of −1 tick per 12 frames (which yanks the render alpha). */
  gentleLeadDrain: boolean;
}

const DEFAULTS: HarnessOpts = {
  owdMs: 25,
  jitterMs: 4,
  fps: 60,
  lead: true,
  timeSync: true,
  keepAckedInHistory: false,
  walkIntoWall: false,
  disable118: false,
  leadBand: [1, 2.5],
  reconcileThreshold: LEGACY_RECONCILE_THRESHOLD,
  legacyLead: false,
  serverInputModel: "fifo",
  reconcileEpsilon: LEGACY_RECONCILE_THRESHOLD,
  hardSnapM: RECONCILE_HARDSNAP_M,
  capsuleErrorOffset: false,
  capsuleHalfLifeMs: CAPSULE_ERR_HALFLIFE_MS,
  immediateLeadInject: false,
  sendInputEveryFrame: false,
  gentleLeadDrain: false,
  frameJitter: 0.15,
  hitchEveryFrames: 0,
  hitchMs: 0,
  walkDir: "north",
};

/**
 * The proposal's capsule error offset — delegates to the real shipped
 * `decayPositionOffset` (ADR 0026) so this harness can't silently drift from
 * what `main.ts` actually runs.
 */
const decayOffset = (
  o: { x: number; y: number; z: number },
  dtMs: number,
  halfLifeMs: number,
  hardSnapM: number,
): { x: number; y: number; z: number } =>
  decayPositionOffset(o, dtMs, halfLifeMs, hardSnapM, CAPSULE_ERR_FLAT_EPSILON_M);

interface Delivered<T> {
  at: number;
  msg: T;
}

type ClientBound =
  | { type: "welcome"; spawn: { x: number; y: number; z: number } }
  | { type: "pong"; clientTimeMs: number; serverTimeMs: number }
  | { type: "snapshot"; state: SimState; serverTimeMs: number; commandQueueDepth: number };
type ServerBound =
  | { type: "ping"; clientTimeMs: number }
  | { type: "input"; inputs: { tick: number; input: SimInputs }[] };

class Harness {
  readonly o: HarnessOpts;
  now = 0;
  readonly myId = "p1";

  // server
  private readonly server: RapierSimulation;
  private serverTickAccMs = 0;
  private serverTick = 0;
  private readonly queue: { tick: number; input: SimInputs }[] = [];
  private lastApplied: SimInputs = IDLE;
  private lastInputTick = 0;
  private readonly MAX_QUEUED = 6;

  // client
  private readonly client: RapierSimulation;
  private readonly timeSync = new TimeSync();
  private readonly serverInterp = new SnapshotInterpolator();
  private readonly propPrediction = new PropPredictionController();
  private readonly netMetrics = new NetMetrics();
  private predictionTick = 0;
  private predictionAccumulatorMs = 0;
  private renderAlpha = 0;
  private renderPreviousSnapshot: SimState | undefined;
  private readonly inputBuffer: { tick: number; input: SimInputs }[] = [];
  private readonly positionHistory = new Map<number, { x: number; y: number; z: number }>();
  private latestServerSnapshot: SimState | null = null;
  private lastSnapshotArrivedAt = 0;
  private predictedDownAtTick: number | null = null;
  private readonly LEAD_ADJUST_FRAMES = 12;
  private smoothedQueueDepth = 1.5;
  private framesSinceLeadAdjust = 12;
  private lastPingAt = -1000;
  // legacy LEAD state (pre-code-review)
  private targetLead = 2;
  private appliedLead = 0;
  private leadSeeded = false;
  // proposal: capsule render-time error offset (5e)
  private capsuleOffset = { x: 0, y: 0, z: 0 };
  private offsetMotionState = "Controlled";
  private lastRenderedPos: { x: number; y: number; z: number } | null = null;
  // proposal: tick-addressed server input buffer (5a) + server-tick estimate (5f)
  private readonly inputByTick = new Map<number, SimInputs>();
  private estServerTickAtArrival = 0;
  private estServerTickArrivedAt = 0;
  private predictionTickSeeded = false;

  // network in flight
  private readonly toClient: Delivered<ClientBound>[] = [];
  private readonly toServer: Delivered<ServerBound>[] = [];

  // recording
  readonly rendered: {
    t: number;
    pos: { x: number; y: number; z: number };
    motion: string;
    corrected: boolean;
    offMag: number;
    simPos: { x: number; y: number; z: number };
  }[] = [];
  readonly corrections: {
    t: number;
    err: number;
    acked: number;
    predTick: number;
    qDepth: number;
    starve: number;
    unackedLen: number;
    histSize: number;
    reason: string;
    snapsThisFrame: number;
  }[] = [];
  private snapsThisFrame = 0;
  /** positionError observed on every snapshot where a same-tick baseline existed (below OR above threshold). */
  readonly observedErrors: number[] = [];
  private correctedThisFrame = false;
  serverStarveCount = 0;

  constructor(opts: Partial<HarnessOpts> = {}) {
    this.o = { ...DEFAULTS, ...opts };
    const cfg = {
      statics: PLAYGROUND_STATICS,
      checkpoints: PLAYGROUND_CHECKPOINTS,
      spinners: PLAYGROUND_SPINNERS,
      props: PLAYGROUND_PROPS,
      withDefaultCharacter: false,
    } as const;
    this.server = new RapierSimulation(cfg);
    this.client = new RapierSimulation({ ...cfg, authoritative: false });
    const spawn = this.o.spawnOverride ?? playgroundSpawn(0);
    this.server.addCharacter(this.myId, spawn);
    this.client.addCharacter(this.myId, spawn);
  }

  private owd(t: number): number {
    return this.o.owdMs + this.o.jitterMs * Math.abs(Math.sin(t * 0.019));
  }

  private sendToServer(msg: ServerBound): void {
    this.toServer.push({ at: this.now + this.owd(this.now), msg });
  }
  private sendToClient(msg: ClientBound): void {
    this.toClient.push({ at: this.now + this.owd(this.now), msg });
  }

  // ---- server ----------------------------------------------------------------
  private pumpServer(): void {
    for (let i = this.toServer.length - 1; i >= 0; i -= 1) {
      const d = this.toServer[i]!;
      if (d.at > this.now) continue;
      this.toServer.splice(i, 1);
      const m = d.msg;
      if (m.type === "ping") {
        this.sendToClient({ type: "pong", clientTimeMs: m.clientTimeMs, serverTimeMs: this.now + SERVER_CLOCK_OFFSET });
      } else if (this.o.serverInputModel === "tick-addressed") {
        for (const entry of m.inputs) {
          if (entry.tick <= this.lastInputTick) continue;
          if (!this.inputByTick.has(entry.tick)) this.inputByTick.set(entry.tick, entry.input);
        }
      } else {
        for (const entry of m.inputs) {
          if (entry.tick <= this.lastInputTick) continue;
          if (this.queue.some((q) => q.tick === entry.tick)) continue;
          this.queue.push({ tick: entry.tick, input: entry.input });
        }
        this.queue.sort((a, b) => a.tick - b.tick);
        while (this.queue.length > this.MAX_QUEUED) this.queue.shift();
      }
    }
  }

  private stepServer(): void {
    this.pumpServer();
    let queueDepth: number;
    if (this.o.serverInputModel === "tick-addressed") {
      // Simulate the input STAMPED FOR THIS TICK. If it never arrived, repeat
      // the last applied one — but the tick still advances, so step-count stays
      // equal to serverTick by construction (research §2.3).
      const wanted = this.serverTick + 1;
      const exact = this.inputByTick.get(wanted);
      if (exact) this.lastApplied = exact;
      else this.serverStarveCount += 1; // input for this tick never arrived — repeat last
      this.lastInputTick = wanted; // honest ack: the last tick the server actually simulated (research §5b)
      for (const t of this.inputByTick.keys()) if (t <= wanted) this.inputByTick.delete(t);
      queueDepth = this.inputByTick.size; // inputs buffered ahead of the tick just simulated
    } else {
      const next = this.queue.shift();
      if (next) {
        this.lastApplied = next.input;
        this.lastInputTick = next.tick;
      } else {
        this.serverStarveCount += 1;
      }
      queueDepth = this.queue.length;
    }
    this.server.tick({ [this.myId]: this.lastApplied });
    this.serverTick += 1;
    const state = this.server.snapshot();
    const mine = state.characters[this.myId]!;
    mine.lastInputTick = this.lastInputTick;
    this.sendToClient({
      type: "snapshot",
      state,
      serverTimeMs: this.now + SERVER_CLOCK_OFFSET,
      commandQueueDepth: queueDepth,
    });
  }

  // ---- client ---------------------------------------------------------------
  private isDown(s: CharacterSnapshot["motionState"]): boolean {
    return s === "Ragdoll" || s === "GettingUp";
  }

  private reconcile(server: CharacterSnapshot, serverTick: number, serverProps: readonly PropSnapshot[]): void {
    const acked = server.lastInputTick;
    for (const t of [...this.positionHistory.keys()]) if (t < acked) this.positionHistory.delete(t);
    const unacked = this.inputBuffer.filter((e) => e.tick > acked);
    this.inputBuffer.splice(0, this.inputBuffer.length, ...unacked);

    const localChar = this.client.snapshot().characters[this.myId]!;
    const serverDown = this.isDown(server.motionState);
    const localDown = this.isDown(localChar.motionState);
    if (localDown && !serverDown && this.predictedDownAtTick !== null && acked < this.predictedDownAtTick) return;

    const predictedAtAck = this.positionHistory.get(acked);
    const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
      Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    const positionError = predictedAtAck ? dist(predictedAtAck, server.position) : Infinity;
    if (predictedAtAck && !serverDown && !localDown) this.observedErrors.push(positionError);
    const reason =
      serverDown || localDown
        ? "down"
        : server.motionState !== localChar.motionState
          ? `motion:${localChar.motionState}->${server.motionState}`
          : !predictedAtAck
            ? "no-history-for-acked"
            : positionError > this.o.hardSnapM
              ? "hard-snap"
              : positionError > this.o.reconcileEpsilon
                ? "pos-error"
                : "";
    const needsCorrection = reason !== "";
    if (!needsCorrection) return;

    this.correctedThisFrame = true;
    this.corrections.push({
      t: this.now,
      err: Number.isFinite(positionError) ? positionError : -1,
      acked,
      predTick: this.predictionTick,
      qDepth: this.smoothedQueueDepth,
      starve: this.serverStarveCount,
      unackedLen: unacked.length,
      histSize: this.positionHistory.size,
      reason,
      snapsThisFrame: this.snapsThisFrame,
    });
    if (Number.isFinite(positionError)) this.netMetrics.recordCorrection(positionError);
    const simBefore = { ...this.client.snapshot().characters[this.myId]!.position };
    const motionChanged = server.motionState !== localChar.motionState;
    this.client.reconcileCharacter(this.myId, server);
    if (!serverDown) {
      this.client.syncTick(serverTick);
      this.client.syncPropsToSnapshot(serverProps);
      const renderedBefore = this.o.disable118
        ? null
        : this.propPrediction.captureBeforeReconcile(this.client.snapshot().props);
      if (!this.o.disable118) {
        for (const i of this.propPrediction.predictedIndices) {
          const sp = serverProps[i];
          if (sp) this.client.applyAuthoritativePropState(i, sp);
        }
      }
      const replayed = this.client.replayLocalCharacter(
        this.myId,
        unacked.map((e) => e.input),
      );
      if (renderedBefore) this.propPrediction.reseedAfterReconcile(renderedBefore, this.client.snapshot().props);
      this.positionHistory.clear();
      // The acked tick's authoritative position is exactly `server.position` —
      // keep it so a snapshot that repeats the same ack (server starved / a
      // duplicate / a reorder) still finds a baseline and computes error 0
      // instead of Infinity → spurious full replay.
      if (this.o.keepAckedInHistory) this.positionHistory.set(acked, { ...server.position });
      unacked.forEach((e, i) => {
        const p = replayed[i];
        if (p) this.positionHistory.set(e.tick, p);
      });

      // 5e: reseed the render-time offset so the rendered pose is unchanged by
      // the correction (same as PropPredictionController.reseedAfterReconcile):
      // offset += simPoseBefore − simPoseAfterReplay, then it decays to zero.
      if (this.o.capsuleErrorOffset && !localDown) {
        const after = this.client.snapshot().characters[this.myId]!.position;
        if (reason === "hard-snap" || motionChanged) {
          this.capsuleOffset = { x: 0, y: 0, z: 0 }; // snap: state change or genuine desync
        } else {
          this.capsuleOffset = {
            x: this.capsuleOffset.x + simBefore.x - after.x,
            y: this.capsuleOffset.y + simBefore.y - after.y,
            z: this.capsuleOffset.z + simBefore.z - after.z,
          };
          const mag = Math.hypot(this.capsuleOffset.x, this.capsuleOffset.y, this.capsuleOffset.z);
          if (mag > this.o.hardSnapM) this.capsuleOffset = { x: 0, y: 0, z: 0 };
        }
      }
    } else {
      this.positionHistory.clear();
    }
    // Always reset the interp baseline on a correction (the offset, not the
    // interpolation, carries the visual delta in 5e mode).
    this.renderPreviousSnapshot = this.client.snapshot();
  }

  private pumpClient(): void {
    for (let i = this.toClient.length - 1; i >= 0; i -= 1) {
      const d = this.toClient[i]!;
      if (d.at > this.now) continue;
      this.toClient.splice(i, 1);
      const m = d.msg;
      if (m.type === "pong") {
        if (this.o.timeSync) this.timeSync.receivePong(m, this.now);
      } else if (m.type === "snapshot") {
        this.snapsThisFrame += 1;
        this.latestServerSnapshot = m.state;
        this.lastSnapshotArrivedAt = this.now;
        this.estServerTickAtArrival = m.state.tick;
        this.estServerTickArrivedAt = this.now;
        this.serverInterp.receive(m.state, this.now, m.serverTimeMs);
        this.netMetrics.commandQueueDepth = m.commandQueueDepth;
        if (this.o.legacyLead) {
          this.smoothedQueueDepth += (m.commandQueueDepth - this.smoothedQueueDepth) * 0.25;
          const nudge = this.smoothedQueueDepth < 1 ? 0.08 : this.smoothedQueueDepth > 2 ? -0.08 : 0;
          this.targetLead = Math.max(1, Math.min(3, this.targetLead + nudge));
        } else {
          this.smoothedQueueDepth += (m.commandQueueDepth - this.smoothedQueueDepth) * 0.2;
        }
        const sc = m.state.characters[this.myId];
        if (sc) this.reconcile(sc, m.state.tick, m.state.props);
      }
    }
  }

  private frame(elapsedMs: number): void {
    this.now += elapsedMs;
    this.correctedThisFrame = false;
    this.snapsThisFrame = 0;

    // server runs on the same virtual timeline
    this.serverTickAccMs += elapsedMs;
    while (this.serverTickAccMs >= TICK_MS) {
      this.serverTickAccMs -= TICK_MS;
      this.stepServer();
    }

    this.pumpClient();

    if (this.o.timeSync) {
      this.timeSync.tick(elapsedMs);
      if (this.timeSync.ready) {
        this.serverInterp.setServerClockOffsetMs(this.timeSync.serverClockOffsetMs);
        if (this.o.legacyLead && !this.leadSeeded) {
          this.targetLead = Math.max(1, Math.min(3, Math.ceil(this.timeSync.rttMs / 2 / TICK_MS) + 1));
          this.leadSeeded = true;
        }
      }
    }

    if (this.now - this.lastPingAt >= 1000) {
      this.lastPingAt = this.now;
      this.sendToServer({ type: "ping", clientTimeMs: this.now });
    }

    const input = this.currentInput;
    const serverRender = this.serverInterp.ready ? this.serverInterp.sample(this.now) : null;

    if (!this.o.disable118) this.client.setPredictedProps(serverRender ? this.propPrediction.predictedIndices : []);

    const EPSILON_MS = 1e-6;
    this.framesSinceLeadAdjust += 1;

    // ---- 5a: tick-addressed prediction — predict in SERVER-TICK SPACE ----
    // The client stamps input for the exact tick the server will simulate it on,
    // so predictionTick must chase `estServerTick + LEAD` (Overwatch's "½RTT + 1
    // command frame"), not a free-running accumulator.
    //
    // NOTE: this harness couples the client and server on one virtual clock and
    // fakes the tick epoch, so the alignment this needs (real TimeSync-driven
    // estServerTick + a shared tick-0 epoch) is only roughly modelled. Treat the
    // tick-addressed numbers as INDICATIVE — §5a needs a real integration test
    // against `apps/server` before it is committed. See the research doc's open
    // questions.
    if (this.o.serverInputModel === "tick-addressed" && this.timeSync.ready) {
      const estServerTick =
        this.estServerTickAtArrival +
        (this.now - this.estServerTickArrivedAt) / TICK_MS +
        this.timeSync.rttMs / 2 / TICK_MS;
      const leadTicks = Math.max(2, Math.min(6, Math.ceil(this.timeSync.rttMs / 2 / TICK_MS) + 2));
      const targetTick = Math.ceil(estServerTick + leadTicks);
      this.renderAlpha = Math.max(0, Math.min(1, 1 - (targetTick - (estServerTick + leadTicks))));
      if (!this.predictionTickSeeded) {
        this.predictionTick = Math.max(this.predictionTick, targetTick - 1);
        this.predictionTickSeeded = true;
      }
      let n = 0;
      while (this.predictionTick < targetTick && n < MAX_STEPS_PER_FRAME) {
        this.predictionTick += 1;
        this.inputBuffer.push({ tick: this.predictionTick, input });
        this.sendToServer({ type: "input", inputs: this.inputBuffer.slice(-3).map((e) => ({ ...e })) });
        this.renderPreviousSnapshot = this.client.snapshot();
        this.client.tick({ [this.myId]: input });
        const predicted = this.client.snapshot().characters[this.myId]!;
        this.positionHistory.set(this.predictionTick, { ...predicted.position });
        this.predictedDownAtTick = this.isDown(predicted.motionState)
          ? (this.predictedDownAtTick ?? this.predictionTick)
          : null;
        n += 1;
      }
      if (n === 0 && this.o.sendInputEveryFrame && this.inputBuffer.length > 0) {
        this.sendToServer({ type: "input", inputs: this.inputBuffer.slice(-3).map((e) => ({ ...e })) });
      }
      this.finishFrame(elapsedMs, serverRender, n);
      return;
    }

    let leadStepMs = 0;
    if (this.o.legacyLead) {
      // pre-code-review: catch appliedLead up to the maintained targetLead, one tick/frame
      if (this.timeSync.ready && this.appliedLead < Math.round(this.targetLead)) {
        leadStepMs = TICK_MS;
        this.appliedLead += 1;
      } else if (this.timeSync.ready && this.appliedLead > Math.round(this.targetLead)) {
        leadStepMs = -TICK_MS;
        this.appliedLead -= 1;
      }
    } else if (this.o.lead && this.timeSync.ready) {
      // 5f: inject immediately when the queue is starving; rate-limit only the drop side.
      const injectNow = this.o.immediateLeadInject
        ? this.smoothedQueueDepth < this.o.leadBand[0]
        : this.framesSinceLeadAdjust >= this.LEAD_ADJUST_FRAMES && this.smoothedQueueDepth < this.o.leadBand[0];
      if (injectNow) {
        leadStepMs = TICK_MS;
        this.framesSinceLeadAdjust = 0;
      } else if (this.o.gentleLeadDrain) {
        // drain a fat queue continuously by a small slice — never a full-tick
        // jump that yanks the render alpha (the bad-connection backward pop).
        if (this.smoothedQueueDepth > this.o.leadBand[1]) leadStepMs = -TICK_MS * LEAD_DRAIN_FRACTION;
      } else if (
        this.framesSinceLeadAdjust >= this.LEAD_ADJUST_FRAMES &&
        this.smoothedQueueDepth > this.o.leadBand[1]
      ) {
        leadStepMs = -TICK_MS;
        this.framesSinceLeadAdjust = 0;
      }
    }
    this.predictionAccumulatorMs = Math.min(
      this.predictionAccumulatorMs + elapsedMs + leadStepMs,
      TICK_MS * MAX_STEPS_PER_FRAME,
    );
    let steps = 0;
    while (this.predictionAccumulatorMs + EPSILON_MS >= TICK_MS && steps < MAX_STEPS_PER_FRAME) {
      this.predictionTick += 1;
      this.inputBuffer.push({ tick: this.predictionTick, input });
      const tail = this.inputBuffer.slice(-3);
      this.sendToServer({ type: "input", inputs: tail.map((e) => ({ ...e })) });
      this.renderPreviousSnapshot = this.client.snapshot();
      this.client.tick({ [this.myId]: input });
      const predicted = this.client.snapshot().characters[this.myId]!;
      this.positionHistory.set(this.predictionTick, { ...predicted.position });
      this.predictedDownAtTick = this.isDown(predicted.motionState)
        ? (this.predictedDownAtTick ?? this.predictionTick)
        : null;
      this.predictionAccumulatorMs -= TICK_MS;
      steps += 1;
    }
    if (this.predictionAccumulatorMs < 0) this.predictionAccumulatorMs = 0;
    this.renderAlpha = this.predictionAccumulatorMs / TICK_MS;
    // 5f: fps-independent cl_cmdrate — re-emit the redundant tail on a 0-step frame
    // so a slow render frame doesn't create a gap in the server's tick buffer.
    if (steps === 0 && this.o.sendInputEveryFrame && this.inputBuffer.length > 0) {
      this.sendToServer({ type: "input", inputs: this.inputBuffer.slice(-3).map((e) => ({ ...e })) });
    }
    this.finishFrame(elapsedMs, serverRender, steps);
  }

  private finishFrame(elapsedMs: number, serverRender: ReturnType<SnapshotInterpolator["sample"]> | null, steps: number): void {
    void steps;
    while (this.inputBuffer.length > MAX_BUFFERED_INPUT_TICKS) this.inputBuffer.shift();
    for (const t of [...this.positionHistory.keys()]) {
      if (t <= this.predictionTick - MAX_BUFFERED_INPUT_TICKS) this.positionHistory.delete(t);
    }

    const snapshot = this.client.snapshot();
    if (!this.o.disable118) {
      const contacted = this.client.consumeContactedProps();
      if (serverRender) {
        this.propPrediction.frame({
          contacted,
          predictionTick: this.predictionTick,
          graceTicks: graceTicksForRtt(this.timeSync.rttMs),
          dtMs: Math.min(elapsedMs, 100),
          simProps: snapshot.props,
          serverProps: serverRender.props,
        });
      } else {
        this.propPrediction.reset();
      }
    }

    const previous = this.renderPreviousSnapshot ?? snapshot;
    const localAlpha = Math.max(0, Math.min(1, this.renderAlpha));
    const render = interpolateState(previous, snapshot, localAlpha);
    const c = snapshot.characters[this.myId]!;
    const localDown = this.isDown(c.motionState);
    const serverOwn = serverRender?.characters[this.myId];

    // 5e: decay the capsule error offset, and never carry it across a motionState change.
    if (this.o.capsuleErrorOffset) {
      if (c.motionState !== this.offsetMotionState || localDown) {
        this.capsuleOffset = { x: 0, y: 0, z: 0 };
        this.offsetMotionState = c.motionState;
      } else {
        this.capsuleOffset = decayOffset(
          this.capsuleOffset,
          Math.min(elapsedMs, 100),
          this.o.capsuleHalfLifeMs,
          this.o.hardSnapM,
        );
      }
    }

    const renderChar =
      localDown && serverOwn && serverOwn.bones.length > 0 ? serverOwn : render.characters[this.myId]!;
    const renderPos = this.o.capsuleErrorOffset
      ? {
          x: renderChar.position.x + this.capsuleOffset.x,
          y: renderChar.position.y + this.capsuleOffset.y,
          z: renderChar.position.z + this.capsuleOffset.z,
        }
      : { ...renderChar.position };

    this.lastRenderedPos = renderPos;
    this.rendered.push({
      t: this.now,
      pos: renderPos,
      motion: c.motionState,
      corrected: this.correctedThisFrame,
      offMag: Math.hypot(this.capsuleOffset.x, this.capsuleOffset.y, this.capsuleOffset.z),
      simPos: { ...renderChar.position },
    });
  }

  /** Optional per-frame input override, for scripted scenarios (direction changes). */
  inputForNow: ((nowMs: number) => SimInputs) | null = null;

  get currentInput(): SimInputs {
    if (this.inputForNow) return this.inputForNow(this.now);
    if (this.o.walkIntoWall) return { moveDirection: { x: -1, y: 0, z: 0 }, jumpHeld: false, dashHeld: false };
    return this.o.walkDir === "east" ? EAST : NORTH;
  }

  run(seconds: number): void {
    const dt = 1000 / this.o.fps;
    const frames = Math.round((seconds * 1000) / dt);
    for (let i = 0; i < frames; i += 1) {
      // deterministic frame-time jitter + an occasional GC-style hitch
      const j = 1 + this.o.frameJitter * Math.sin(i * 0.7);
      const hitch = this.o.hitchEveryFrames > 0 && i % this.o.hitchEveryFrames === 0 ? this.o.hitchMs : 0;
      this.frame(dt * j + hitch);
    }
  }
}

/**
 * Per-frame progress along the overall travel direction (works for any walk
 * heading). `d` > 0 is forward, `d` < 0 is a backward pop. `sinceMs` skips the
 * join/settle transient.
 */
const forwardDeltas = (
  h: Harness,
  sinceMs = 1200,
): { d: number; t: number; corrected: boolean; motion: string }[] => {
  const r = h.rendered.filter((p) => p.t >= sinceMs);
  if (r.length < 3) return [];
  // travel direction = net horizontal displacement over the window
  const first = r[0]!.pos;
  const last = r.at(-1)!.pos;
  let dx = last.x - first.x;
  let dz = last.z - first.z;
  const len = Math.hypot(dx, dz) || 1;
  dx /= len;
  dz /= len;
  const out: { d: number; t: number; corrected: boolean; motion: string }[] = [];
  for (let i = 1; i < r.length; i += 1) {
    const d = (r[i]!.pos.x - r[i - 1]!.pos.x) * dx + (r[i]!.pos.z - r[i - 1]!.pos.z) * dz;
    out.push({ d, t: r[i]!.t, corrected: r[i]!.corrected, motion: r[i]!.motion });
  }
  const start = out.findIndex((x) => Math.abs(x.d) > 1e-4);
  return start < 0 ? [] : out.slice(start);
};

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

const report = (label: string, h: Harness): void => {
  const all = forwardDeltas(h);
  const d = all.filter((x) => x.motion === "Controlled");
  const steadyStarves = h.corrections.filter((c) => c.t > 1200).length; // corrections in steady state
  const med = median(d.map((x) => x.d));
  const back = d.filter((x) => x.d < -1e-3).length;
  const worstBack = Math.min(0, ...d.map((x) => x.d)); // biggest single-frame backward pop (units)
  const bigPops = d.filter((x) => x.d < -0.02 || x.d > Math.abs(med) * 2 + 0.05).length; // > ~2cm visible
  const overshoot = d.filter((x) => x.d > Math.abs(med) * 2 + 0.02).length;
  const maxErr = h.corrections.reduce((m, c) => Math.max(m, c.err), 0);
  const byReason = new Map<string, number>();
  for (const c of h.corrections) byReason.set(c.reason, (byReason.get(c.reason) ?? 0) + 1);
  const reasons = [...byReason.entries()].map(([r, n]) => `${r}=${n}`).join(" ");
  const multiSnap = h.corrections.filter((c) => c.snapsThisFrame > 1).length;
  console.log(
    `\n[${label}] (steady-state, t>1.2s) medianΔ=${med.toFixed(4)} bigPops(>2cm)=${bigPops} worstBack=${worstBack.toFixed(3)} back=${back} overshoot=${overshoot} ` +
      `| corrections=${h.corrections.length} (steady ${steadyStarves}) maxErr=${maxErr.toFixed(3)} serverStarves=${h.serverStarveCount} multiSnapFrames=${multiSnap}`,
  );
  console.log(`  reasons: ${reasons}`);
  const e = [...h.observedErrors].sort((a, b) => a - b);
  if (e.length) {
    const pct = (p: number) => e[Math.min(e.length - 1, Math.floor(p * e.length))]!.toFixed(3);
    console.log(
      `  same-tick positionError over ${e.length} snapshots: p50=${pct(0.5)} p90=${pct(0.9)} p99=${pct(0.99)} max=${e.at(-1)!.toFixed(3)} (legacy threshold ${LEGACY_RECONCILE_THRESHOLD})`,
    );
  }
};

const dumpCorrections = (h: Harness, n = 30): void => {
  console.log(
    h.corrections
      .slice(0, n)
      .map(
        (c) =>
          `  t=${c.t.toFixed(0)} ${c.reason} err=${c.err.toFixed(3)} acked=${c.acked} pred=${c.predTick} ` +
          `lead=${c.predTick - c.acked} unacked=${c.unackedLen} hist=${c.histSize} q=${c.qDepth.toFixed(2)} snaps/frame=${c.snapsThisFrame}`,
      )
      .join("\n"),
  );
};

// Open sandbox platform (playground.ts): center z=-32, halfExtent 15, top y≈-2.1.
// Clear of the Spinner (z=1) and every wall — pure straight-walk ground.
const OPEN: { x: number; y: number; z: number } = { x: 0, y: -1.5, z: -30 };

describe("prediction regression harness — walking straight (Phase 1 diagnostic)", () => {
  it("clean open ground, straight walk, 60 fps", () => {
    const h = new Harness({ spawnOverride: OPEN, owdMs: 25, jitterMs: 4 });
    h.run(2.5);
    report("clean/open", h);
    dumpCorrections(h, 40);
    expect(h.rendered.length).toBeGreaterThan(100);
  });

  it("wifi open ground, straight walk", () => {
    const h = new Harness({ spawnOverride: OPEN, owdMs: 45, jitterMs: 20 });
    h.run(2.5);
    report("wifi/open", h);
    dumpCorrections(h, 40);
    expect(h.rendered.length).toBeGreaterThan(100);
  });

  it("DIFFERENTIAL — 11.8 enabled vs disabled (wifi/open, straight walk)", () => {
    for (const disable118 of [false, true]) {
      const h = new Harness({ spawnOverride: OPEN, owdMs: 45, jitterMs: 20, disable118 });
      h.run(2.5);
      report(`118=${!disable118}`, h);
    }
  });

  it("DIFFERENTIAL — fps 144 / 60 / 30 (wifi/open)", () => {
    for (const fps of [144, 60, 30]) {
      const h = new Harness({ spawnOverride: OPEN, owdMs: 45, jitterMs: 20, fps });
      h.run(2.5);
      report(`fps=${fps}`, h);
    }
  });

  it("DIFFERENTIAL — LEAD / timeSync on vs off (wifi/open)", () => {
    for (const lead of [true, false]) report(`lead=${lead}`, run(new Harness({ spawnOverride: OPEN, owdMs: 45, jitterMs: 20, lead }), 2.5));
    for (const timeSync of [true, false]) report(`timeSync=${timeSync}`, run(new Harness({ spawnOverride: OPEN, owdMs: 45, jitterMs: 20, timeSync }), 2.5));
  });

  it("CANDIDATE FIX — keep acked tick in positionHistory (wifi/open)", () => {
    for (const keepAckedInHistory of [false, true]) {
      report(`keepAcked=${keepAckedInHistory}`, run(new Harness({ spawnOverride: OPEN, owdMs: 45, jitterMs: 20, keepAckedInHistory }), 2.5));
    }
  });

  it("CANDIDATE FIX — wider LEAD band (fatter command queue) at 30/60 fps", () => {
    for (const fps of [30, 60]) {
      for (const leadBand of [[1, 2.5] as [number, number], [2.5, 4] as [number, number]]) {
        report(
          `fps=${fps} band=[${leadBand}]`,
          run(new Harness({ spawnOverride: OPEN, owdMs: 45, jitterMs: 20, fps, leadBand }), 3),
        );
      }
    }
  });

  it("CANDIDATE FIX — reconcile threshold 0.2 vs 0.25 (just past one walk-step) at 30 fps", () => {
    for (const reconcileThreshold of [0.2, 0.25]) {
      report(
        `thr=${reconcileThreshold}`,
        run(new Harness({ spawnOverride: OPEN, owdMs: 45, jitterMs: 20, fps: 30, reconcileThreshold }), 3),
      );
    }
  });

  it("DIFFERENTIAL — current queue-feedback LEAD vs the pre-code-review maintained LEAD", () => {
    for (const fps of [60, 30]) {
      for (const legacyLead of [false, true]) {
        report(
          `fps=${fps} legacyLead=${legacyLead}`,
          run(new Harness({ spawnOverride: OPEN, owdMs: 45, jitterMs: 20, fps, legacyLead }), 4),
        );
      }
    }
  });

  it("symptom B — dash into the start-platform wall, does it settle at the contact point?", () => {
    for (const keepAckedInHistory of [false, true]) {
      const h = new Harness({ owdMs: 45, jitterMs: 20, walkIntoWall: true, keepAckedInHistory });
      h.run(6);
      const r = h.rendered.filter((p) => p.motion === "Controlled");
      const finalX = r.at(-1)?.pos.x ?? NaN;
      const leftwardJerks = r.filter((p, i) => i > 0 && p.pos.x - r[i - 1]!.pos.x < -0.05).length;
      report(`wall keepAcked=${keepAckedInHistory}`, h);
      console.log(`  wall: finalX=${finalX.toFixed(3)} leftward-jerks(>5cm)=${leftwardJerks}`);
    }
  });
});

// The proposal from docs/research/m2-prediction-reconciliation-loop.md.
// §5a (tick-addressed server consumption) is NOT included here — this harness
// fakes the client/server tick epoch and cannot validate it; it needs a real
// integration test against apps/server. Everything below is harness-validatable.
const PROPOSAL: Partial<HarnessOpts> = {
  keepAckedInHistory: true, // §5c
  reconcileEpsilon: RECONCILE_POSITION_EPSILON, // §5d — retires the 0.2 correct-or-ignore threshold
  hardSnapM: RECONCILE_HARDSNAP_M, // §5d
  capsuleErrorOffset: true, // §5e — the decaying render-time offset (ADR 0022 machinery)
  capsuleHalfLifeMs: CAPSULE_ERR_HALFLIFE_MS, // §5e
  gentleLeadDrain: true, // 5f (partial) — continuous queue drain, no full-tick alpha yank
};
// §5f (immediate LEAD inject / send-every-frame) tested separately — as prototyped
// it over-injects at high fps; needs a per-snapshot rate limit before it helps.
const PROPOSAL_WITH_5F: Partial<HarnessOpts> = {
  ...PROPOSAL,
  immediateLeadInject: true,
  sendInputEveryFrame: true,
};

describe("PROPOSAL — tested against the baseline (research §5)", () => {
  it("open ground, straight walk — baseline vs proposal at 144 / 60 / 30 fps", () => {
    for (const fps of [144, 60, 30]) {
      report(`baseline fps=${fps}`, run(new Harness({ spawnOverride: OPEN, owdMs: 45, jitterMs: 20, fps }), 4));
      report(`PROPOSAL fps=${fps}`, run(new Harness({ spawnOverride: OPEN, owdMs: 45, jitterMs: 20, fps, ...PROPOSAL }), 4));
      report(`PROPOSAL+5f fps=${fps}`, run(new Harness({ spawnOverride: OPEN, owdMs: 45, jitterMs: 20, fps, ...PROPOSAL_WITH_5F }), 4));
    }
  });

  it("knob isolation (wifi/open, 30 fps — the hardest case)", () => {
    const base = { spawnOverride: OPEN, owdMs: 45, jitterMs: 20, fps: 30 } as const;
    report("baseline", run(new Harness(base), 4));
    report("+keepAcked (§5c)", run(new Harness({ ...base, keepAckedInHistory: true }), 4));
    report("+immediateLead+sendEveryFrame (§5f)", run(new Harness({ ...base, keepAckedInHistory: true, immediateLeadInject: true, sendInputEveryFrame: true }), 4));
    report("+epsilon 0.02, no offset (§5d)", run(new Harness({ ...base, keepAckedInHistory: true, immediateLeadInject: true, sendInputEveryFrame: true, reconcileEpsilon: 0.02 }), 4));
    report("+capsuleOffset (§5e) = FULL PROPOSAL", run(new Harness({ ...base, ...PROPOSAL }), 4));
    report("EXPERIMENTAL +tick-addressed (§5a, harness can't validate)", run(new Harness({ ...base, ...PROPOSAL, serverInputModel: "tick-addressed" }), 4));
  });

  it("capsule half-life sweep (full proposal, 30 fps)", () => {
    for (const capsuleHalfLifeMs of [50, 100, 150, 200]) {
      report(`hl=${capsuleHalfLifeMs}`, run(new Harness({ spawnOverride: OPEN, owdMs: 45, jitterMs: 20, fps: 30, ...PROPOSAL, capsuleHalfLifeMs }), 4));
    }
  });

  it("does the capsule offset add lag on a direction change? (open ground, N→W turn at t=2s)", () => {
    const N: SimInputs = { moveDirection: { x: 0, y: 0, z: -1 }, jumpHeld: false, dashHeld: false };
    const W: SimInputs = { moveDirection: { x: -1, y: 0, z: 0 }, jumpHeld: false, dashHeld: false };
    for (const [label, opts] of [
      ["baseline", {}],
      ["PROPOSAL", PROPOSAL],
    ] as const) {
      const h = new Harness({ spawnOverride: OPEN, owdMs: 45, jitterMs: 20, fps: 60, ...opts });
      h.inputForNow = (t) => (t < 2000 ? N : W);
      h.run(4);
      // How fast does render X start moving west after the turn?
      const r = h.rendered;
      const turnIdx = r.findIndex((p) => p.t >= 2000);
      const xAtTurn = r[turnIdx]!.pos.x;
      const west10 = r.find((p, i) => i > turnIdx && p.pos.x < xAtTurn - 0.1);
      const latencyMs = west10 ? west10.t - 2000 : -1;
      report(`turn ${label}`, h);
      console.log(`  turn: render started moving west ${latencyMs} ms after the input change`);
    }
  });

  it("symptom B — wall dash, baseline vs proposal", () => {
    for (const [label, opts] of [
      ["baseline", {}],
      ["PROPOSAL", PROPOSAL],
    ] as const) {
      const h = new Harness({ owdMs: 45, jitterMs: 20, walkIntoWall: true, ...opts });
      h.run(6);
      const r = h.rendered.filter((p) => p.motion === "Controlled");
      const finalX = r.at(-1)?.pos.x ?? NaN;
      const leftwardJerks = r.filter((p, i) => i > 0 && p.pos.x - r[i - 1]!.pos.x < -0.05).length;
      report(`wall ${label}`, h);
      console.log(`  wall: finalX=${finalX.toFixed(3)} leftward-jerks(>5cm)=${leftwardJerks}`);
    }
  });
});

function run(h: Harness, seconds: number): Harness {
  h.run(seconds);
  return h;
}

/** Steady-state (t>1.2s) rendered-motion metrics for a straight walk. */
const metrics = (
  h: Harness,
): { worstBackCm: number; backPops: number; fwdSpikes: number; steadyCorrections: number } => {
  const d = forwardDeltas(h).filter((x) => x.motion === "Controlled");
  const med = median(d.map((x) => x.d));
  const worstBackCm = Math.abs(Math.min(0, ...d.map((x) => x.d))) * 100;
  const backPops = d.filter((x) => x.d < -0.02).length; // rendered went backward > 2 cm in a frame
  const fwdSpikes = d.filter((x) => x.d > Math.abs(med) * 2.5 + 0.05).length; // forward lurch
  return { worstBackCm, backPops, fwdSpikes, steadyCorrections: h.corrections.filter((c) => c.t > 1200).length };
};

// ---------------------------------------------------------------------------
// The shipping target: render capped at 60 fps (the user's decision, 2026-09).
// These are the assertions the fix must satisfy AT THAT CAP, across the frame
// pacing a real rAF-capped browser produces (near-even on a capable machine,
// jittery + occasional GC hitch on a weak one) and across network conditions.
// ---------------------------------------------------------------------------
describe("60 fps render cap — proposal must hold here", () => {
  // spawn far west on the sandbox, walk east — ~27 units of clear x-room (4.5 s at walk speed)
  const OPEN_W = { x: -14, y: -1.5, z: -32 };
  const at60 = (over: Partial<HarnessOpts>): Partial<HarnessOpts> => ({
    spawnOverride: OPEN_W,
    walkDir: "east",
    fps: 60,
    ...over,
  });
  // frame pacing profiles at a 60 fps cap
  const CAPABLE = { frameJitter: 0.03 }; // machine comfortably hits 60
  const WEAK = { frameJitter: 0.12, hitchEveryFrames: 45, hitchMs: 12 }; // struggles: jitter + ~1 GC hitch / 0.75 s
  // network profiles
  const NETS = [
    { name: "lan", owdMs: 15, jitterMs: 3 },
    { name: "wifi", owdMs: 45, jitterMs: 20 },
    { name: "bad", owdMs: 90, jitterMs: 45 },
  ] as const;

  const NET_PACING = NETS.flatMap((net) => [
    { label: `${net.name}/capable`, opts: { ...CAPABLE, ...net } },
    { label: `${net.name}/weak`, opts: { ...WEAK, ...net } },
  ]);

  it("baseline @60 fps — the cap alone does NOT remove the pop", () => {
    let worst = 0;
    for (const { label, opts } of NET_PACING) {
      const m = metrics(run(new Harness(at60(opts)), 4));
      worst = Math.max(worst, m.worstBackCm);
      console.log(`  baseline ${label}: worstBack=${m.worstBackCm.toFixed(1)}cm backPops=${m.backPops} corrections=${m.steadyCorrections}`);
    }
    // At least one realistic condition at a 60 fps cap still throws a big pop.
    expect(worst).toBeGreaterThan(8);
  });

  it("PROPOSAL @60 fps — no visible pop in any network / machine condition", () => {
    for (const { label, opts } of NET_PACING) {
      const m = metrics(run(new Harness(at60({ ...opts, ...PROPOSAL })), 4));
      console.log(`  PROPOSAL ${label}: worstBack=${m.worstBackCm.toFixed(1)}cm backPops=${m.backPops} fwdSpikes=${m.fwdSpikes}`);
      expect(m.worstBackCm).toBeLessThan(2.5); // a GC hitch may leak ~1 cm; never the 20 cm baseline pop
      expect(m.backPops).toBeLessThanOrEqual(2);
    }
  });

  it("PROPOSAL @60 fps — corrections still fire; the offset just hides them (needs §5a to make them rare)", () => {
    // 30 fps + bad net = the churn is loudest here.
    const base = metrics(run(new Harness({ spawnOverride: OPEN_W, walkDir: "east", fps: 30, ...WEAK, owdMs: 90, jitterMs: 45 }), 4));
    const prop = metrics(run(new Harness({ spawnOverride: OPEN_W, walkDir: "east", fps: 30, ...WEAK, owdMs: 90, jitterMs: 45, ...PROPOSAL }), 4));
    console.log(`  corrections/4s: baseline ${base.steadyCorrections} · proposal ${prop.steadyCorrections}`);
    console.log(`  worstBack: baseline ${base.worstBackCm.toFixed(1)}cm · proposal ${prop.worstBackCm.toFixed(1)}cm`);
    // The proposal does NOT reduce how often the sim reconciles — that's §5a's job.
    expect(prop.steadyCorrections).toBeGreaterThan(base.steadyCorrections * 0.6);
    // It just makes the correction invisible.
    expect(prop.worstBackCm).toBeLessThan(Math.max(3, base.worstBackCm / 3));
  });

  it("PROPOSAL @60 fps — a direction change adds no input lag", () => {
    const N: SimInputs = { moveDirection: { x: 0, y: 0, z: -1 }, jumpHeld: false, dashHeld: false };
    const W: SimInputs = { moveDirection: { x: -1, y: 0, z: 0 }, jumpHeld: false, dashHeld: false };
    const lag = (opts: Partial<HarnessOpts>): number => {
      const h = new Harness(at60({ ...CAPABLE, owdMs: 45, jitterMs: 20, ...opts }));
      h.inputForNow = (t) => (t < 2500 ? N : W);
      h.run(5);
      const r = h.rendered;
      const turn = r.findIndex((p) => p.t >= 2500);
      const x0 = r[turn]!.pos.x;
      const moved = r.find((p, i) => i > turn && p.pos.x < x0 - 0.1);
      return moved ? moved.t - 2500 : Infinity;
    };
    const base = lag({});
    const prop = lag(PROPOSAL);
    console.log(`  turn latency: baseline ${base.toFixed(0)}ms · proposal ${prop.toFixed(0)}ms`);
    expect(prop).toBeLessThanOrEqual(base + 5);
  });

  it("PROPOSAL @60 fps — wall impact settles still at the contact point", () => {
    const settle = (opts: Partial<HarnessOpts>): { finalX: number; jitterCm: number } => {
      const h = new Harness({ owdMs: 45, jitterMs: 20, fps: 60, ...CAPABLE, walkIntoWall: true, ...opts });
      h.run(6);
      const tail = h.rendered.filter((p) => p.motion === "Controlled" && p.t > 4000).map((p) => p.pos.x); // last ~2 s, settled
      const mean = tail.reduce((s, x) => s + x, 0) / tail.length;
      const jitterCm = Math.sqrt(tail.reduce((s, x) => s + (x - mean) ** 2, 0) / tail.length) * 100;
      return { finalX: mean, jitterCm };
    };
    const base = settle({});
    const prop = settle(PROPOSAL);
    console.log(`  wall settle — baseline: x=${base.finalX.toFixed(3)} ±${base.jitterCm.toFixed(2)}cm · proposal: x=${prop.finalX.toFixed(3)} ±${prop.jitterCm.toFixed(2)}cm`);
    expect(prop.finalX).toBeGreaterThan(-2.6); // rest ≈ -2.44; not buried in the wall
    expect(prop.finalX).toBeLessThan(-2.3);
    expect(prop.jitterCm).toBeLessThan(1.5); // sits still, doesn't buzz
  });

  it("PROPOSAL @60 fps — capsule half-life sweep: 75–150 ms all clean", () => {
    for (const capsuleHalfLifeMs of [50, 75, 100, 150, 200]) {
      const m = metrics(run(new Harness(at60({ ...WEAK, owdMs: 90, jitterMs: 45, ...PROPOSAL, capsuleHalfLifeMs })), 4));
      console.log(`  hl=${capsuleHalfLifeMs}ms: worstBack=${m.worstBackCm.toFixed(1)}cm backPops=${m.backPops}`);
      if (capsuleHalfLifeMs >= 75) expect(m.worstBackCm).toBeLessThan(2.5);
    }
  });

  // 2026-09 playtest follow-up: the mesh pop was fixed (above), but the
  // camera was STILL reported jerking — during plain walking, not just a
  // dash, with or without ever touching a Prop. Root cause: `main.ts`'s
  // `stage.updateCamera(...)` call was fed `renderCharacter.position` — the
  // RAW, un-offset sim pose — never `visualCharacter.position` (raw +
  // capsuleErrorOffset). ADR 0026 said "camera-follow ... use the raw pose
  // (Fiedler: never smooth into the sim)" — but Fiedler's rule is about not
  // feeding a smoothed value BACK INTO the simulation (collision,
  // obstacle/mirror sync, gameplay logic); the camera is a pure rendering
  // leaf with zero downstream physics consequence, so grouping it with
  // "gameplay reads" was an over-generalization, not a reasoned
  // camera-specific requirement. Fixed: `main.ts` now feeds the camera
  // `visualCharacter.position`, same as the mesh.
  //
  // This harness has no seam into `main.ts` itself (a DOM/WebSocket
  // closure), so it cannot assert the fixed wiring directly — what it CAN,
  // and does, prove is *why* the fix is necessary: the raw stream
  // (`h.rendered[].simPos`, what the camera used to follow) still carries
  // the same ~20 cm pop the offset stream (`.pos`, what the mesh — and now
  // the camera too — follows) was built to eliminate.
  it("PROPOSAL @60 fps — the raw stream (what the camera used to follow) still pops even where the mesh is clean", () => {
    const results: { label: string; mesh: number; camera: number; backPops: number }[] = [];
    for (const { label, opts } of NET_PACING) {
      const h = run(new Harness(at60({ ...opts, ...PROPOSAL })), 4);
      const rawStream = h.rendered.map((p) => ({ ...p, pos: p.simPos })); // what the camera today follows
      const meshMetrics = metrics(h); // what the mesh follows (already fixed)
      const cameraMetrics = metrics({ ...h, rendered: rawStream } as typeof h);
      results.push({ label, mesh: meshMetrics.worstBackCm, camera: cameraMetrics.worstBackCm, backPops: cameraMetrics.backPops });
      console.log(
        `  ${label}: mesh worstBack=${meshMetrics.worstBackCm.toFixed(1)}cm · ` +
          `camera(raw) worstBack=${cameraMetrics.worstBackCm.toFixed(1)}cm backPops=${cameraMetrics.backPops}`,
      );
    }
    // The mesh stays clean everywhere (already asserted elsewhere: < 2.5cm on
    // every profile). The camera — following the raw, un-offset stream — does
    // NOT get that guarantee at all: at least the harder network profiles
    // must show it visibly exceeding the mesh's clean bound, proving the
    // offset fix never reached the camera.
    const worstCamera = Math.max(...results.map((r) => r.camera));
    expect(worstCamera).toBeGreaterThan(2.5);
  });
});
