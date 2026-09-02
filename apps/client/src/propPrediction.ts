/**
 * Pushed-Prop prediction (ADR 0022 — supersedes ADR 0016; ticket 11.8).
 *
 * Every Prop is interpolation-only (ADR 0017) **except the one the local
 * Character is contacting**, for a short grace after last contact. That Prop is
 * a live dynamic body in the client's prediction world — but what is *rendered*
 * is its simulated pose plus a **render-time error offset that decays
 * exponentially toward zero** (Glenn Fiedler, "State Synchronization"). The
 * Rapier body always holds the authoritative state; the visual smoothing never
 * touches the sim (Fiedler: it ruins the extrapolation).
 *
 * Per-Prop client state machine:
 *
 *   PINNED  ── local contact ──▶  PREDICTED
 *   PREDICTED  ── grace lapses ──▶  SERVER-MOVING
 *   SERVER-MOVING  ── server at rest & offset spent ──▶  PINNED
 *   (any) ── local contact ──▶  PREDICTED   (keeps the decaying residual offset)
 *
 * The offset is only ever *added to* — on entry, on hand-back, and on every
 * reconcile while predicted — never used to move the rendered pose directly.
 */

import {
  IDENTITY_QUAT,
  PROP_ERR_FAR_M,
  PROP_ERR_HALFLIFE_FAR_MS,
  PROP_ERR_HALFLIFE_NEAR_MS,
  PROP_ERR_HARDSNAP_M,
  PROP_ERR_NEAR_M,
  PROP_ERR_ROT_DOT_HI,
  PROP_ERR_ROT_DOT_LO,
  PROP_ERR_ROT_HARDSNAP_DOT,
  PROP_ERR_ROT_SETTLED_DOT,
  PROP_ERR_SETTLED_M,
  PROP_PREDICT_GRACE_MAX_TICKS,
  PROP_PREDICT_GRACE_MIN_TICKS,
  PROP_PREDICT_GRACE_TICKS,
  TICK_MS,
  addVec3,
  conjugateQuat,
  lengthVec3,
  mulQuat,
  slerpQuat,
  subVec3,
  type PropSnapshot,
  type Quat,
  type Vec3,
} from "@dont-fall/shared";

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const invLerp = (a: number, b: number, x: number): number => (a === b ? 0 : (x - a) / (b - a));

const ZERO_VEC: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * A predicted Prop's render-time error offset. The rendered pose is
 * `{ position: base.position + position, rotation: rotation ∘ base.rotation }`
 * where `base` is the local sim pose (PREDICTED) or the interpolated server
 * pose (SERVER-MOVING).
 */
export interface PropError {
  position: Vec3;
  rotation: Quat;
}

export const zeroPropError = (): PropError => ({ position: { ...ZERO_VEC }, rotation: { ...IDENTITY_QUAT } });

/** The offset that reproduces pose `a` when applied to pose `b`. */
const poseDelta = (a: PropSnapshot, b: PropSnapshot): PropError => ({
  position: subVec3(a.position, b.position),
  rotation: mulQuat(a.rotation, conjugateQuat(b.rotation)),
});

const applyError = (base: PropSnapshot, error: PropError): PropSnapshot => ({
  ...base,
  position: addVec3(base.position, error.position),
  rotation: mulQuat(error.rotation, base.rotation),
});

/**
 * Decay a render-time error offset one render frame toward zero (Fiedler,
 * "State Synchronization").
 *
 * Position: exponential decay whose half-life is lerped from
 * {@link PROP_ERR_HALFLIFE_NEAR_MS} at a ≤{@link PROP_ERR_NEAR_M} error to
 * {@link PROP_ERR_HALFLIFE_FAR_MS} at ≥{@link PROP_ERR_FAR_M}; past
 * {@link PROP_ERR_HARDSNAP_M} the offset is dropped outright — the Prop visually
 * teleports, because that far apart is a genuine desync, not something to
 * rubber-band across the playground.
 *
 * Rotation: the same exponential decay, its half-life blended by the quaternion
 * dot of the offset against identity (`|w|`) across
 * {@link PROP_ERR_ROT_DOT_LO}–{@link PROP_ERR_ROT_DOT_HI}.
 *
 * Pure — `dtMs` is real elapsed wall-clock, so the decay is frame-rate
 * independent.
 */
export const decayPropError = (error: PropError, dtMs: number): PropError => {
  const posMag = lengthVec3(error.position);
  let position: Vec3;
  if (posMag > PROP_ERR_HARDSNAP_M) {
    position = { ...ZERO_VEC };
  } else {
    const halfLifeMs = lerp(
      PROP_ERR_HALFLIFE_NEAR_MS,
      PROP_ERR_HALFLIFE_FAR_MS,
      clamp01(invLerp(PROP_ERR_NEAR_M, PROP_ERR_FAR_M, posMag)),
    );
    const retain = Math.pow(0.5, dtMs / halfLifeMs);
    position = { x: error.position.x * retain, y: error.position.y * retain, z: error.position.z * retain };
  }

  // |dot(offset, identity)| = |w|: 1 when there is no rotation error, → 0 as it grows.
  const rotDot = Math.abs(error.rotation.w);
  let rotation: Quat;
  if (rotDot < PROP_ERR_ROT_HARDSNAP_DOT) {
    rotation = { ...IDENTITY_QUAT }; // genuine desync — snap the orientation
  } else {
    const rotErr01 = clamp01(invLerp(PROP_ERR_ROT_DOT_HI, PROP_ERR_ROT_DOT_LO, rotDot));
    const rotHalfLifeMs = lerp(PROP_ERR_HALFLIFE_NEAR_MS, PROP_ERR_HALFLIFE_FAR_MS, rotErr01);
    rotation = slerpQuat(IDENTITY_QUAT, error.rotation, Math.pow(0.5, dtMs / rotHalfLifeMs));
  }

  return { position, rotation };
};

/**
 * Ticks a Prop stays predicted after last contact:
 * `clamp(ceil(RTT / TICK_MS), 2, 8)` — long enough that the server's
 * acknowledgement of the push is already in the interpolation buffer by
 * hand-back. Falls back to {@link PROP_PREDICT_GRACE_TICKS} before RTT is known.
 */
export const graceTicksForRtt = (rttMs: number): number => {
  if (!Number.isFinite(rttMs) || rttMs <= 0) return PROP_PREDICT_GRACE_TICKS;
  return Math.max(
    PROP_PREDICT_GRACE_MIN_TICKS,
    Math.min(PROP_PREDICT_GRACE_MAX_TICKS, Math.ceil(rttMs / TICK_MS)),
  );
};

export type PropPredictState = "pinned" | "predicted" | "server-moving";

interface PropEntry {
  state: PropPredictState;
  lastContactTick: number;
  error: PropError;
}

/** True once a handed-back Prop's residual offset (position and rotation) is small enough to re-pin. */
const offsetSettled = (error: PropError): boolean =>
  lengthVec3(error.position) < PROP_ERR_SETTLED_M && Math.abs(error.rotation.w) > PROP_ERR_ROT_SETTLED_DOT;

export interface PropFrameParams {
  /** Prop indices the local capsule contacted since the last frame. */
  contacted: readonly number[];
  /** The client's current prediction tick. */
  predictionTick: number;
  /** `clamp(ceil(RTT / TICK_MS), 2, 8)` — see {@link graceTicksForRtt}. */
  graceTicks: number;
  /** Real elapsed wall-clock since the last frame (ms). */
  dtMs: number;
  /** Local sim pose per Prop index (`localSim.snapshot().props`). */
  simProps: readonly PropSnapshot[];
  /** Interpolated server pose per Prop index (`serverInterp.sample().props`). */
  serverProps: readonly PropSnapshot[];
}

/**
 * Owns the per-Prop state machine and error offsets. Lives in `main.ts` for the
 * lifetime of the session; `localSim` and the renderer are driven from it.
 */
export class PropPredictionController {
  private readonly entries = new Map<number, PropEntry>();

  private entry(i: number): PropEntry {
    let e = this.entries.get(i);
    if (!e) {
      e = { state: "pinned", lastContactTick: Number.NEGATIVE_INFINITY, error: zeroPropError() };
      this.entries.set(i, e);
    }
    return e;
  }

  /** Prop indices to simulate locally this frame — pass to `localSim.setPredictedProps` before the predict loop. */
  get predictedIndices(): number[] {
    const out: number[] = [];
    for (const [i, e] of this.entries) if (e.state === "predicted") out.push(i);
    return out;
  }

  /** For the net-graph overlay. */
  get predictedCount(): number {
    return this.predictedIndices.length;
  }

  stateOf(i: number): PropPredictState {
    return this.entries.get(i)?.state ?? "pinned";
  }

  /**
   * Drop all prediction state — every Prop back to PINNED, no offsets. Called
   * when the interpolated world is briefly unavailable (buffer underrun): the
   * state machine cannot advance without server poses, so rather than freeze
   * it mid-prediction with stale offsets, reset and let it re-acquire on the
   * next contact once snapshots resume.
   */
  reset(): void {
    this.entries.clear();
  }

  /**
   * Advance the state machine and decay every offset one render frame. Call
   * once per frame, after the predict loop (so `contacted` and `simProps`
   * reflect this frame's ticks) and before {@link renderPoses}.
   */
  frame(params: PropFrameParams): void {
    const { contacted, predictionTick, graceTicks, dtMs, simProps, serverProps } = params;

    for (const i of contacted) {
      const e = this.entry(i);
      e.lastContactTick = predictionTick;
      // Enter prediction. Keep the existing offset: it is ~zero coming from
      // PINNED, or a decaying residual coming from SERVER-MOVING — either way
      // the rendered pose stays continuous because the body is right where the
      // interpolated pose had it.
      e.state = "predicted";
    }

    for (const [i, e] of this.entries) {
      if (e.state === "predicted" && predictionTick - e.lastContactTick > graceTicks) {
        // Grace lapsed: hand back to interpolation. Seed the offset from where
        // the predicted body sits vs where the server has it, so the rendered
        // pose does not jump on the switch.
        const sim = simProps[i];
        const srv = serverProps[i];
        if (sim && srv) e.error = poseDelta(applyError(sim, e.error), srv);
        e.state = "server-moving";
      }

      if (e.state === "server-moving" && serverProps[i]?.atRest && offsetSettled(e.error)) {
        e.state = "pinned";
        e.error = zeroPropError();
      }

      if (e.state !== "pinned") e.error = decayPropError(e.error, dtMs);
    }
  }

  /**
   * Final render pose for every Prop: a PREDICTED Prop from the local sim pose
   * plus its offset, everything else from the interpolated server pose (plus
   * any residual decaying offset while SERVER-MOVING).
   */
  renderPoses(simProps: readonly PropSnapshot[], serverProps: readonly PropSnapshot[]): PropSnapshot[] {
    return serverProps.map((srv, i) => {
      const e = this.entries.get(i);
      if (!e || e.state === "pinned") return srv;
      const base = e.state === "predicted" ? (simProps[i] ?? srv) : srv;
      return applyError(base, e.error);
    });
  }

  /**
   * Reconcile hook — call in `reconcile` BEFORE seeding the predicted Props
   * with the server state. Returns each predicted Prop's *rendered* pose, to be
   * handed to {@link reseedAfterReconcile} once the replay has run so the
   * correction is invisible.
   */
  captureBeforeReconcile(simProps: readonly PropSnapshot[]): Map<number, PropSnapshot> {
    const before = new Map<number, PropSnapshot>();
    for (const i of this.predictedIndices) {
      const sim = simProps[i];
      if (sim) before.set(i, applyError(sim, this.entries.get(i)!.error));
    }
    return before;
  }

  /**
   * Reconcile hook — call AFTER the local-input replay. Re-seeds each predicted
   * Prop's offset to `renderedBefore − simPoseAfter` so its rendered pose is
   * exactly where it was before the correction, then lets the decay carry it
   * back to the authoritative pose (Fiedler).
   */
  reseedAfterReconcile(before: Map<number, PropSnapshot>, simPropsAfter: readonly PropSnapshot[]): void {
    for (const [i, renderedBefore] of before) {
      const after = simPropsAfter[i];
      const e = this.entries.get(i);
      if (after && e) e.error = poseDelta(renderedBefore, after);
    }
  }
}
