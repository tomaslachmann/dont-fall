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
 * While SERVER-MOVING it decays no faster along the server pose's own motion
 * than that pose advances ({@link decayHandedBackError}), so a Prop handed
 * back still sliding is drawn pausing, never moving backward.
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
  PROP_HANDBACK_MIN_SPEED,
  PROP_PREDICT_GRACE_MAX_TICKS,
  PROP_PREDICT_GRACE_MIN_TICKS,
  PROP_PREDICT_GRACE_TICKS,
  TICK_MS,
  addVec3,
  conjugateQuat,
  decayPositionOffset,
  dotVec3,
  lengthVec3,
  mulQuat,
  scaleVec3,
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
  const halfLifeMs = lerp(
    PROP_ERR_HALFLIFE_NEAR_MS,
    PROP_ERR_HALFLIFE_FAR_MS,
    clamp01(invLerp(PROP_ERR_NEAR_M, PROP_ERR_FAR_M, lengthVec3(error.position))),
  );
  const position = decayPositionOffset(error.position, dtMs, halfLifeMs, PROP_ERR_HARDSNAP_M);

  // |dot(offset, identity)| = |w|: 1 when there is no rotation error, → 0 as it grows.
  const rotDot = Math.abs(error.rotation.w);
  let rotation: Quat;
  if (rotDot < PROP_ERR_ROT_HARDSNAP_DOT) {
    rotation = { ...IDENTITY_QUAT }; // genuine desync — snap the orientation
  } else {
    // The blend's low end is whichever of the Fiedler-cited PROP_ERR_ROT_DOT_LO
    // or the hard-snap threshold is more restrictive: PROP_ERR_ROT_HARDSNAP_DOT
    // (0.26) sits above PROP_ERR_ROT_DOT_LO (0.1), so a plain invLerp against
    // LO would never actually reach it — the hard-snap branch above claims
    // every rotDot below 0.26 first, and the far half-life (fast decay for a
    // big error) was never reached. Clamping the low end up to the hard-snap
    // boundary makes it the worst *reachable* error instead.
    const rotErr01 = clamp01(
      invLerp(PROP_ERR_ROT_DOT_HI, Math.max(PROP_ERR_ROT_DOT_LO, PROP_ERR_ROT_HARDSNAP_DOT), rotDot),
    );
    const rotHalfLifeMs = lerp(PROP_ERR_HALFLIFE_NEAR_MS, PROP_ERR_HALFLIFE_FAR_MS, rotErr01);
    rotation = slerpQuat(IDENTITY_QUAT, error.rotation, Math.pow(0.5, dtMs / rotHalfLifeMs));
  }

  return { position, rotation };
};

/**
 * One render frame of a handed-back Prop's decay (SERVER-MOVING — ADR 0022,
 * amended by ADR 0109): {@link decayPropError}, except that the offset's part
 * along the server Prop's own motion (the direction of its replicated
 * `serverVelocity`) shrinks no faster than the drawn server pose advanced
 * that way this frame (`serverAdvance`).
 *
 * The hand-back seeds the offset at where the prediction has the Prop less
 * where the drawn server world has it, and a Prop still sliding at v puts
 * those ~v × (RTT + ~100 ms) apart ({@link graceTicksForRtt}) — 0.6 m at
 * 3 u/s over RTT 80. Decayed freely, an offset that size shrinks faster than
 * the server pose under it moves, and the Prop was drawn sliding backward: in
 * ADR 0109's harness (RTT 20–120 ms, 2–6 u/s) on half the hand-backs at
 * 60 Hz and two thirds at 144 Hz, at up to −12 u/s. Held to the pose's own
 * advance, it is drawn standing still instead until the decay is slow enough
 * to let it move on, then eases onto the server pose as before — on none of
 * them, for at most ~100 ms longer to converge. A frame the interpolation
 * buffer runs dry advances the pose not at all, so it holds the offset too,
 * rather than drawing the Prop back. Only the component along the motion is
 * held; the rest, and the rotation offset, decay as ever.
 *
 * It holds nothing when the server has the Prop slower than
 * {@link PROP_HANDBACK_MIN_SPEED} — or at rest, which carries no velocity at
 * all — and never past {@link PROP_ERR_HARDSNAP_M}, where the offset is
 * dropped as it always was.
 */
export const decayHandedBackError = (
  error: PropError,
  dtMs: number,
  serverVelocity: Vec3 | undefined,
  serverAdvance: Vec3,
): PropError => {
  const decayed = decayPropError(error, dtMs);
  const speed = serverVelocity ? lengthVec3(serverVelocity) : 0;
  if (!serverVelocity || speed < PROP_HANDBACK_MIN_SPEED) return decayed;
  if (lengthVec3(error.position) > PROP_ERR_HARDSNAP_M) return decayed;
  const along = scaleVec3(serverVelocity, 1 / speed);
  const allowedM = Math.max(0, dotVec3(serverAdvance, along));
  const shrinkM = dotVec3(subVec3(error.position, decayed.position), along);
  if (shrinkM <= allowedM) return decayed;
  return { ...decayed, position: addVec3(decayed.position, scaleVec3(along, shrinkM - allowedM)) };
};

/**
 * Ticks a Prop stays predicted after last contact:
 * `clamp(ceil(RTT / TICK_MS), 2, 8)` — long enough that the server's
 * acknowledgement of the push is already in the interpolation buffer by
 * hand-back. Not yet *drawn*, though: the drawn server pose trails the
 * prediction Tick by the LEAD (one-way latency plus the server's command
 * queue), the one-way latency back and the Interpolation Delay — ADR 0109's
 * playout clock counts that delay from the Snapshot's arrival, so the one-way
 * latency back is on top of it now — ~RTT + 100 ms, 140–250 ms at RTT
 * 20–120 ms. A Prop still sliding is handed back that far ahead of its drawn
 * server pose, and {@link decayHandedBackError} closes the gap without
 * drawing it backward. Falls back to {@link PROP_PREDICT_GRACE_TICKS} before
 * RTT is known.
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
  /** The interpolated server position drawn under this Prop last frame — what {@link decayHandedBackError} measures its advance from. */
  serverPosition: Vec3 | null;
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
  /**
   * Local sim pose per Prop index as it is drawn — the same poses
   * {@link PropPredictionController.renderPoses} draws a PREDICTED Prop from,
   * interpolated to the sub-tick alpha. Not `localSim.snapshot().props`: the
   * hand-back seeds its offset from this, and that newest tick runs up to a
   * tick of motion ahead of what was on screen (ADR 0109).
   */
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
      e = { state: "pinned", lastContactTick: Number.NEGATIVE_INFINITY, error: zeroPropError(), serverPosition: null };
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
      const srv = serverProps[i];
      let handedBack = false;
      if (e.state === "predicted" && predictionTick - e.lastContactTick > graceTicks) {
        // Grace lapsed: hand back to interpolation. Seed the offset from where
        // the predicted body sits vs where the server has it, so the rendered
        // pose does not jump on the switch.
        const sim = simProps[i];
        if (sim && srv) e.error = poseDelta(applyError(sim, e.error), srv);
        e.state = "server-moving";
        handedBack = true;
      }

      if (e.state === "server-moving" && srv?.atRest && offsetSettled(e.error)) {
        e.state = "pinned";
        e.error = zeroPropError();
      }

      if (e.state === "predicted") {
        e.error = decayPropError(e.error, dtMs);
      } else if (e.state === "server-moving" && !handedBack) {
        // The hand-back frame draws exactly the predicted pose the offset was
        // seeded from — decaying it on the same frame drew a Prop that was
        // slowing down behind where the prediction had just drawn it — and
        // the decay starts on the next, held to the server pose's advance
        // since this one (ADR 0109).
        const advance = srv && e.serverPosition ? subVec3(srv.position, e.serverPosition) : ZERO_VEC;
        e.error = decayHandedBackError(e.error, dtMs, srv?.velocity, advance);
      }
      e.serverPosition = srv ? { ...srv.position } : null;
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
