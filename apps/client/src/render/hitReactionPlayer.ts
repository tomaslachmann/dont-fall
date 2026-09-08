import type * as THREE from "three";
import { isOneShotFinished, type CharacterActions } from "./characterModel.js";

/**
 * Drives the Punch/HitReact one-shot overlays (M6 ticket 03) from a
 * Character's `hitEpoch`/`hitReactEpoch` — one instance per rig (local and
 * every real remote one, ADR 0046), mirroring how each rig already tracks
 * its own Ragdoll/GettingUp state independently.
 *
 * Deliberately ignores the epochs it sees on its own first `update` call,
 * seeding them as a baseline instead of reacting — the same cold-start class
 * of bug `deathClipPlan.ts`'s `snapDown`/`coldReverse` cases exist to fix
 * (code review, M6 ticket 02): a rig built for a Character that already has
 * a nonzero `hitEpoch`/`hitReactEpoch` (joining a Match in progress) must
 * never treat that as "a fresh swing just happened."
 */
export class HitReactionPlayer {
  private lastHitEpoch: number | null = null;
  private lastHitReactEpoch: number | null = null;
  private active: THREE.AnimationAction | null = null;

  /**
   * Call once per frame, before deciding ordinary locomotion. Returns the
   * reaction currently playing, or `null` if none is active (or it just
   * finished) — the caller treats a non-null return as "skip locomotion
   * selection this frame, this overlay owns the model."
   */
  /**
   * Cut any reaction dead (M6.1 ticket 02). Used when a knockdown takes the
   * rig over: from then on the ragdoll's bones own the pose and the mixer is
   * not advanced at all, so a reaction left merely faded would stay bound and
   * never finish — and, worse, would be the thing the mixer restores the rig
   * to if it ever ran again.
   */
  stop(actions: CharacterActions): void {
    this.active?.stop();
    this.active = null;
    actions.punch?.stop();
    actions.hitReact?.stop();
  }

  /**
   * Keep the baseline current without starting or continuing any reaction
   * (code review, M6.1) — call this every frame something else (the
   * down-state bone pose) owns the model outright and `update` is never
   * called. Without it, an epoch that changes while down (a Character can
   * still be Hit again while already Ragdolling — Hit's targeting doesn't
   * exclude a down target) leaves the baseline stale for the whole knockdown,
   * so the very next real `update` call once Controlled resumes reads it as
   * a brand new reaction and plays Punch/HitReact right as the Character
   * should be resuming idle/walk.
   */
  observeBaseline(hitEpoch: number, hitReactEpoch: number): void {
    this.lastHitEpoch = hitEpoch;
    this.lastHitReactEpoch = hitReactEpoch;
  }

  /**
   * `currentLocomotionAction` is whatever the caller's own ordinary
   * locomotion crossfade currently has active — passed in so a *fresh*
   * reaction (none was already playing) can fade it out too. Without this,
   * a reaction starting while a locomotion clip was mid-crossfade (most
   * visibly Dash's own run) left that clip at full weight, still playing,
   * underneath the reaction overlay — visible as the locomotion pose never
   * releasing while Punch/HitReact plays on top of it (bug report: "hit
   * locks the dash animation"). A *continuing* reaction (Punch → HitReact
   * the same tick, or the same reaction still playing) never re-fades it —
   * by then it was already faded on the tick the first reaction started.
   */
  update(
    hitEpoch: number,
    hitReactEpoch: number,
    actions: CharacterActions,
    crossfadeSeconds: number,
    currentLocomotionAction: THREE.AnimationAction | null,
  ): THREE.AnimationAction | null {
    if (this.lastHitEpoch === null || this.lastHitReactEpoch === null) {
      this.lastHitEpoch = hitEpoch;
      this.lastHitReactEpoch = hitReactEpoch;
    } else {
      const hitChanged = hitEpoch !== this.lastHitEpoch;
      const hitReactChanged = hitReactEpoch !== this.lastHitReactEpoch;
      this.lastHitEpoch = hitEpoch;
      this.lastHitReactEpoch = hitReactEpoch;
      // Code review, M6 ticket 03: starting both in the same call (a mutual
      // exchange — this Character's own swing lands on someone the same
      // tick it's also hit) used to start Punch, then immediately fade it
      // back out again to start HitReact, before Punch ever played a frame
      // — correct by accident of check order, not by design. Being hit is
      // the more urgent, forced reaction; a voluntary swing's effect on the
      // target already landed regardless of whether this Character's own
      // Punch clip gets to play, so HitReact wins outright and Punch is
      // never started at all when both happen together.
      if (hitReactChanged && actions.hitReact) {
        this.start(actions.hitReact, crossfadeSeconds, currentLocomotionAction);
      } else if (hitChanged && actions.punch) {
        this.start(actions.punch, crossfadeSeconds, currentLocomotionAction);
      }
    }

    if (this.active && isOneShotFinished(this.active)) this.active = null;
    return this.active;
  }

  private start(action: THREE.AnimationAction, crossfadeSeconds: number, currentLocomotionAction: THREE.AnimationAction | null): void {
    if (this.active === action) return; // already playing this exact reaction — don't restart it
    const wasAlreadyReacting = this.active !== null;
    action.reset().fadeIn(crossfadeSeconds).play();
    this.active?.fadeOut(crossfadeSeconds);
    // Only on a FRESH entry into reaction — a reaction already faded out
    // whatever locomotion action preceded it the tick it first started.
    if (!wasAlreadyReacting) currentLocomotionAction?.fadeOut(crossfadeSeconds);
    this.active = action;
  }
}
