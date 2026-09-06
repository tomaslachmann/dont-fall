import type { CharacterSnapshot } from "../state/SimState.js";
import { RECONCILE_POSITION_EPSILON } from "../tuning.js";
import { isDownMotionState } from "./CharacterStateMachine.js";

/** The slice of a Character this gate compares — the server's report and our own prediction. */
type Compared = Pick<CharacterSnapshot, "motionState" | "finishTick">;

/**
 * Whether the server's report for our own Character disagrees with what we
 * predicted badly enough to be worth correcting and replaying (ADR 0013).
 *
 * `positionError` is the distance between where we predicted this Character
 * would be at the acknowledged tick and where the server says it was —
 * `Infinity` when we have no prediction on file for that tick.
 *
 * Position alone is not enough to decide this, and every extra term here is a
 * state that can disagree while the two positions sit right on top of each
 * other:
 *
 * - down state, because only the server may start or end a knockdown
 *   (ADR 0015) — a Character we are drawing on its feet and one the server has
 *   face-down occupy nearly the same point;
 * - Qualification, because it latches and locks input (M4 ticket 02, ADR
 *   0039). A wrongly-predicted entry into the Finish Zone stops us dead and
 *   makes us send idle input, at which point the server's Character stops too
 *   and the positions agree to well inside the epsilon — the one disagreement
 *   that actively erases its own evidence, and one that would otherwise leave
 *   the player locked and falsely Qualified for the rest of the Round.
 *
 * The epsilon itself is float noise, not a tolerance (ADR 0026): the
 * simulation corrects on any real disagreement, and the decaying render-time
 * offset is what keeps that invisible.
 */
export const needsCorrection = (server: Compared, local: Compared, positionError: number): boolean =>
  isDownMotionState(server.motionState) || // authority says down — always sync (fresh knock, phase change, or pelvis tracking)
  isDownMotionState(local.motionState) || // we think we're down but the authority doesn't — only the server ends a knockdown
  server.motionState !== local.motionState || // e.g. a Stagger we missed / are holding too long
  server.finishTick !== local.finishTick || // only the server decides who Qualified
  positionError > RECONCILE_POSITION_EPSILON;
