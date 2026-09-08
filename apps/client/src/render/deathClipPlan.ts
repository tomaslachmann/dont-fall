import { isDownMotionState, type CharacterMotionState } from "@dont-fall/shared";

export type DeathClipPlan =
  | { kind: "none" }
  /** Just went down, on a rig that was genuinely tracking it: reset and play the Death clip forward from frame 0. */
  | { kind: "collapse" }
  /**
   * Entering Ragdoll on a rig's very first-ever observation of this Character
   * (code review, M6 ticket 02) — joining a Match already in progress, or any
   * other path that builds a fresh rig for a Character already down. There is
   * no real moment of impact to animate from, so playing the fall from frame
   * 0 would visibly snap the body upright first. The caller snaps straight to
   * the clip's own fully-collapsed end frame instead — already down, no
   * animation to play out.
   */
  | { kind: "snapDown" }
  /** Continuing a GettingUp this same rig already started the collapse for (a real `collapse` or a `snapDown`): reverse from wherever it got to. */
  | { kind: "resumeReverse" }
  /**
   * Entering GettingUp on a rig that never actually started the Death clip at
   * all — built (or rebuilt, e.g. after a fresh connection) while this
   * Character was already mid-GettingUp, so there is no real elapsed fall
   * time to resume from (code review, M6 ticket 02). The caller starts the
   * reverse play cold, from the clip's own fully-collapsed end frame — the
   * same "can't fully re-derive the true history, use the honest fallback"
   * precedent `CharacterController`'s own `activeVolume`/`surfaceBounce`
   * resets already follow on reconcile.
   */
  | { kind: "coldReverse" }
  /** Back to Controlled: stop the Death clip and hand the model back to locomotion. */
  | { kind: "resume" };

/**
 * Pure decision extracted from `remoteCharacterPool.ts`'s Ragdoll/GettingUp
 * driving logic (itself a mirror of `scene.ts`'s local Death-clip handling)
 * — isolated so the exact case a tick falls into is independently testable
 * without a real `THREE.AnimationMixer`/`AnimationAction`, which is what let
 * both `snapDown` and `coldReverse` go unhandled the first time: each reads
 * identically to its "genuine continuation" sibling (`collapse`/
 * `resumeReverse`) purely from `motionState`/`visualState`, with nothing
 * distinguishing a fresh rig joining an *already down* Character from one
 * that watched the whole episode unfold, until this function's own extra
 * flags were threaded through.
 *
 * `isFirstObservation` is true only for a rig's very first ever call (the
 * caller owns this — false forever after). `everEnteredRagdoll` is per-rig
 * state the caller must also own: true from the moment its own `deathAction`
 * was actually started (a `collapse` or `snapDown` plan, so a later
 * `resumeReverse` has something real to reverse from), false again once the
 * Character returns to Controlled (`resume`) — so a *later* down episode on
 * the same rig starts fresh rather than incorrectly treating a brand new
 * collapse as a continuation of a previous one.
 */
export const planDeathClip = (
  motionState: CharacterMotionState,
  visualState: CharacterMotionState,
  isFirstObservation: boolean,
  everEnteredRagdoll: boolean,
): DeathClipPlan => {
  const fallingRagdoll = motionState === "Ragdoll";
  const gettingUp = motionState === "GettingUp";
  const enteringRagdoll = fallingRagdoll && visualState !== "Ragdoll";
  const enteringGettingUp = gettingUp && visualState !== "GettingUp";
  const wasDown = isDownMotionState(visualState);
  const leavingDown = !fallingRagdoll && !gettingUp && wasDown;

  if (enteringRagdoll) return isFirstObservation ? { kind: "snapDown" } : { kind: "collapse" };
  if (enteringGettingUp) return everEnteredRagdoll ? { kind: "resumeReverse" } : { kind: "coldReverse" };
  if (leavingDown) return { kind: "resume" };
  return { kind: "none" };
};
