import { FIXED_STEP_EPSILON_MS, TICK_MS } from "../tuning/clock.js";
import {
  LEAD_DRAIN_SATURATED_FRACTION,
  LEAD_DRAIN_TIME_FRACTION,
  LEAD_FEEDBACK_FRESH_MS,
  LEAD_INJECT_COOLDOWN_MS,
  MAX_QUEUED_INPUTS,
  QUEUE_DEPTH_HIGH,
  QUEUE_DEPTH_LOW,
  QUEUE_DEPTH_REPORT_WEIGHT,
  QUEUE_DEPTH_START,
} from "../tuning/netcode.js";

/**
 * The client's prediction LEAD (ADR 0021, ADR 0026, ADR 0109): how far ahead
 * of the server's Tick this client predicts, held there by feedback on how
 * many of its inputs the server has queued (`commandQueueDepth`, on every
 * Snapshot).
 *
 * Client netcode math, kept in shared beside `errorOffset` and
 * `reconcileGate` because it is pure and the server's own integration test
 * (`tickAddressedInput.integration.test.ts`) runs it too — the shipped
 * controller, never a copy, and never by a path into `apps/client`.
 */

/** What the LEAD controller remembers between frames and Snapshots — the feedback it acts on, and its own cooldown. */
export interface LeadState {
  /** The server's reported `commandQueueDepth`, averaged over its reports ({@link QUEUE_DEPTH_REPORT_WEIGHT}). */
  smoothedQueueDepth: number;
  /** The newest report as it came, unaveraged — what ends the saturated drain ({@link leadAdjustMs}). */
  latestQueueDepth: number;
  /** Time since the last report arrived — starts past {@link LEAD_FEEDBACK_FRESH_MS}, so nothing is adjusted before the first. */
  msSinceReport: number;
  /** Time since the last injected tick — starts at {@link LEAD_INJECT_COOLDOWN_MS}, so the first inject is free. */
  msSinceInject: number;
}

/**
 * A fresh controller: the average at {@link QUEUE_DEPTH_START}, no report
 * heard yet, and a first inject not held back by a cooldown it never started.
 * A new `PredictionLoop` gets a new one — the old average described the old
 * loop's lead.
 */
export const initialLeadState = (): LeadState => ({
  smoothedQueueDepth: QUEUE_DEPTH_START,
  latestQueueDepth: QUEUE_DEPTH_START,
  msSinceReport: Number.POSITIVE_INFINITY,
  msSinceInject: LEAD_INJECT_COOLDOWN_MS,
});

/**
 * Hear one Snapshot's `commandQueueDepth`: keep it, move the average toward
 * it, and count the feedback as fresh from now ({@link LEAD_FEEDBACK_FRESH_MS}).
 */
export const leadReceiveQueueDepth = (state: LeadState, commandQueueDepth: number): void => {
  state.latestQueueDepth = commandQueueDepth;
  state.smoothedQueueDepth += (commandQueueDepth - state.smoothedQueueDepth) * QUEUE_DEPTH_REPORT_WEIGHT;
  state.msSinceReport = 0;
};

/**
 * How much to stretch or shrink this frame's prediction time, in ms (ADR
 * 0021, gentle drain per ADR 0026, counted in time per ADR 0109) — added to
 * `elapsedMs` before it reaches `PredictionLoop.step`.
 *
 * - The queue is starving (under {@link QUEUE_DEPTH_LOW}): inject one whole
 *   tick, at most once per {@link LEAD_INJECT_COOLDOWN_MS}. Responsive on
 *   purpose — an empty queue means the server is about to repeat a stale
 *   input.
 * - The queue is at the server's cap ({@link MAX_QUEUED_INPUTS} − 1 or more):
 *   give up {@link LEAD_DRAIN_SATURATED_FRACTION} of the time. The server is
 *   shedding the very inputs it was about to run, so getting out fast matters
 *   more than how the owner looks meanwhile. Entered on the average, left on
 *   the newest report: the average trails the queue by some five reports, and
 *   at 150 ms one way the half-speed drain it held on carried the queue from
 *   the cap on into starvation.
 * - The queue is fat (over {@link QUEUE_DEPTH_HIGH}): give up
 *   {@link LEAD_DRAIN_TIME_FRACTION} of the time, for as long as it stays over
 *   the band. Never a whole tick at once (that yanks the render-interpolation
 *   alpha in one frame), and never the whole frame, so the prediction clock
 *   always keeps moving.
 *
 * Both are measured in milliseconds, not frames. When they counted frames, a
 * 144 Hz display drained 72% of every frame and a 240 Hz one stopped its own
 * prediction outright, and the controller hunted until it starved the
 * server's queue: the server repeated the last input, and every other client
 * saw this Character's turn freeze for a tick, then jump.
 *
 * Only on fresh feedback: the time drained is the part of this frame the last
 * report still covers — at most {@link LEAD_FEEDBACK_FRESH_MS} after it
 * arrived — and nothing is injected on a stale one. So a phase whose
 * Snapshots are sent only on change (ADR 0057), a stalled link, or one frame
 * seconds long never moves the lead on a depth the server reported before it.
 * A report that arrived during this frame covers it from the frame's start,
 * however long the frame was: the frame after a hitch acts on the Snapshots
 * that queued up behind it, never on the age the hitch gave the one before.
 * The cooldown keeps counting while nothing is acted on.
 *
 * Self-limiting (the condition stops firing once the queue is healthy), and
 * `PredictionLoop.step` keeps the lead through a stall its clamp cannot catch
 * up on, so there is no tracked counter to drift. Mutates `state`; `ready` is
 * whether the clock sync has converged (nothing is adjusted before it has).
 */
export const leadAdjustMs = (state: LeadState, elapsedMs: number, ready: boolean): number => {
  const reportAgeMs = state.msSinceReport;
  state.msSinceReport += elapsedMs;
  state.msSinceInject += elapsedMs;
  if (!ready || reportAgeMs >= LEAD_FEEDBACK_FRESH_MS) return 0;
  const depth = state.smoothedQueueDepth;
  // The epsilon absorbs float drift, so eighteen 60 Hz frames count as 300 ms.
  if (state.msSinceInject + FIXED_STEP_EPSILON_MS >= LEAD_INJECT_COOLDOWN_MS && depth < QUEUE_DEPTH_LOW) {
    state.msSinceInject = 0;
    return TICK_MS;
  }
  // The part of this frame the report still covers — all of it, in any frame
  // but one that outlasts the report.
  const coveredMs = Math.min(elapsedMs, LEAD_FEEDBACK_FRESH_MS - reportAgeMs);
  const saturated = depth >= MAX_QUEUED_INPUTS - 1 && state.latestQueueDepth >= MAX_QUEUED_INPUTS - 1;
  if (saturated) return -coveredMs * LEAD_DRAIN_SATURATED_FRACTION;
  return depth > QUEUE_DEPTH_HIGH ? -coveredMs * LEAD_DRAIN_TIME_FRACTION : 0;
};
