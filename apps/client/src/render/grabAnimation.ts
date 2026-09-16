import type * as THREE from "three";
import { clipPoseInSequence, lastClipPose, type CharacterActions, type ClipPose } from "./characterModel.js";

/**
 * What a Character is doing about a Grab this frame — the two ends of a hold,
 * plus everybody else.
 *
 * Both fields are already replicated (M6.1): `grabbingId` names whoever this
 * Character is holding, `heldByGrabberId` whoever is holding it. No new state
 * on the wire, the same rule the Spring squash and the bounce sheet follow.
 */
export type GrabRole = "grabbing" | "held" | "free";

export const grabRoleOf = (grabbingId: string | null, heldByGrabberId: string | null): GrabRole =>
  grabbingId ? "grabbing" : heldByGrabberId ? "held" : "free";

const looped = (seconds: number, action: THREE.AnimationAction | null): ClipPose | null =>
  action ? { action, time: seconds % action.getClip().duration } : null;

/**
 * The hold, as the rig authors it (ADR 0071): reach out, pull them in, then
 * hold for as long as it lasts. A pure function of how long the hold has been
 * going, not a state machine anyone has to keep in sync. A rig with no hold
 * loop rests on the last frame of what it has.
 *
 * Replaces the procedural arm-aiming of M6.1, which existed only because the
 * old rig had no Grab clip at all: it pointed the upper arms at the other
 * Character every frame. The authored hold does not aim, and does not need
 * to — the server freezes both Characters' `facing` for the length of a hold
 * (see `modelFacing.ts`'s `facingLocked`), so they are already turned toward
 * each other when it starts.
 */
export const grabHoldPoseAt = (seconds: number, actions: CharacterActions): ClipPose | null => {
  const lead = [actions.grabReach, actions.grabPull];
  const leadSeconds = lead.reduce((sum, action) => sum + (action?.getClip().duration ?? 0), 0);
  return clipPoseInSequence(seconds, lead) ?? looped(seconds - leadSeconds, actions.grabHold) ?? lastClipPose(lead);
};

/** Being held: the struggle loop, its own on the ground and in the air — legs kicking at nothing. */
export const strugglePoseAt = (seconds: number, grounded: boolean, actions: CharacterActions): ClipPose | null =>
  looped(seconds, (grounded ? actions.struggleHeld : actions.struggleAir) ?? actions.struggleHeld);

/**
 * A grab attempt that caught nobody: the reach, then the arms coming back in
 * (`Grab_Reach` → `Grab_DropOut`, the rig's own path out of a reach at arm's
 * length). `null` once it has played.
 */
export const grabAttemptPoseAt = (seconds: number, actions: CharacterActions): ClipPose | null =>
  clipPoseInSequence(seconds, [actions.grabReach, actions.grabDropOut]);

interface GrabClock {
  /** The last `grabEpoch` seen. */
  epoch: number;
  role: GrabRole;
  /** When what is playing now started — `null` when nothing is. */
  startedAtMs: number | null;
}

/**
 * Every grab pose a Character can be in, keyed by id like the renderer's
 * other per-Character bookkeeping (ADR 0071): the hold, the struggle, and the
 * attempt that caught nobody.
 *
 * That last one did not exist at first. The hold was the only thing drawn, so
 * a Grab at empty air showed nothing at all, whether in a match or in
 * free-roam, where there is never anybody to catch (bug report 2026-09-16).
 * `grabEpoch` rises on every attempt, and this is its only reader.
 *
 * All three share one clock per Character because they hand over to one
 * another. The local Character's attempt is predicted and plays at once, but
 * whether it caught anyone is the server's to say, a round trip later. By then
 * the reach is already under way, so a hold that grows out of an attempt keeps
 * that attempt's clock and carries on from the same frame rather than
 * reaching a second time.
 */
export class GrabAnimations {
  private readonly clocks = new Map<string, GrabClock>();

  /**
   * The grab pose to draw for `id` this frame, or `null`. Call it every frame,
   * with `pinClipPose` on whatever it returns. The first call for an id only
   * records its `grabEpoch`: joining a match whose Characters have grabbed
   * before plays nothing.
   */
  pose(
    id: string,
    role: GrabRole,
    grabEpoch: number,
    grounded: boolean,
    nowMs: number,
    actions: CharacterActions,
  ): ClipPose | null {
    let clock = this.clocks.get(id);
    if (!clock) {
      clock = { epoch: grabEpoch, role, startedAtMs: role === "free" ? null : nowMs };
      this.clocks.set(id, clock);
    }
    const attempted = grabEpoch !== clock.epoch;
    clock.epoch = grabEpoch;

    if (role !== clock.role) {
      const reaching = clock.role === "free" && clock.startedAtMs !== null;
      const continues = role === "grabbing" && reaching && !attempted;
      clock.startedAtMs = role === "free" ? null : continues ? clock.startedAtMs : nowMs;
      clock.role = role;
    }
    if (attempted && role === "free") clock.startedAtMs = nowMs;
    if (clock.startedAtMs === null) return null;

    const seconds = (nowMs - clock.startedAtMs) / 1000;
    switch (role) {
      case "grabbing":
        return grabHoldPoseAt(seconds, actions);
      case "held":
        return strugglePoseAt(seconds, grounded, actions);
      case "free": {
        const pose = grabAttemptPoseAt(seconds, actions);
        if (!pose) clock.startedAtMs = null;
        return pose;
      }
    }
  }

  forget(id: string): void {
    this.clocks.delete(id);
  }

  reset(): void {
    this.clocks.clear();
  }
}
