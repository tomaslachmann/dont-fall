import type * as THREE from "three";
import { OTHER_PLAYER_GAIN, type SoundSlot } from "../audio/slots.js";
import type { CharacterActions } from "./characterModel.js";

/**
 * Where a foot comes down in each stepping clip, as a fraction of the clip
 * (M14 ticket 04, ADR 0087): the right foot at 0.49, the left at 0.99.
 * Measured from BLIP.glb's `Walk`, `Run`, `Sprint` and `Wobble_Walk` (the
 * frame a foot drops below 15% of its lift) and pinned in
 * `modelBones.test.ts`. The three gaits share one stride (ADR 0081), and
 * `Wobble_Walk` keeps the same one.
 */
export const FOOT_CONTACTS: readonly number[] = [0.49, 0.99];

/** The clips that step: the three gaits and the unsteady walk (ADR 0072, 0082). */
export type SteppingClip = "walk" | "run" | "sprint" | "wobbleWalk";

/** What the foot lands on, from the decks the Stage already knows. */
export type FootSurface = "deck" | "mud" | "ice" | "bounce";

/** Which stepping clip `action` is, if it is one. */
export const steppingClip = (action: THREE.AnimationAction | null, actions: CharacterActions): SteppingClip | null => {
  if (action === null) return null;
  if (action === actions.walk) return "walk";
  if (action === actions.run) return "run";
  if (action === actions.sprint) return "sprint";
  if (action === actions.wobbleWalk) return "wobbleWalk";
  return null;
};

/**
 * How many of `contacts` lie in the stretch of the stride from `previous`
 * (exclusive) to `current` (inclusive), both fractions in [0, 1). A `current`
 * below `previous` means the clip wrapped.
 */
export const contactsCrossed = (previous: number, current: number, contacts: readonly number[] = FOOT_CONTACTS): number =>
  contacts.filter((contact) =>
    current >= previous ? contact > previous && contact <= current : contact > previous || contact <= current,
  ).length;

/**
 * Each Character's feet, keyed by id (M14 ticket 04): how many came down this
 * frame, read off the clip it is stepping in. A change of clip starts
 * counting afresh from where the new clip is, so a crossfade never steps
 * twice.
 */
export class Footsteps {
  private readonly last = new Map<string, { action: THREE.AnimationAction; fraction: number }>();

  /** `stepping` is the action whose feet count this frame, or `null` when nothing steps (air, down, a pose, standing). */
  update(id: string, stepping: THREE.AnimationAction | null): number {
    if (stepping === null) {
      this.last.delete(id);
      return 0;
    }
    const duration = stepping.getClip().duration;
    const fraction = duration > 0 ? ((stepping.time % duration) + duration) % duration / duration : 0;
    const previous = this.last.get(id);
    this.last.set(id, { action: stepping, fraction });
    if (!previous || previous.action !== stepping) return 0;
    return contactsCrossed(previous.fraction, fraction);
  }

  forget(id: string): void {
    this.last.delete(id);
  }
}

/**
 * The sound of one footstep (M14 ticket 04): the surface picks the slot, the
 * clip how hard the foot lands (a Sprint stamps, a walk pads). Another
 * player's steps are quieter than your own, so a crowd doesn't drown you.
 */
export const footstepSound = (
  clip: SteppingClip,
  surface: FootSurface,
  remote: boolean,
): { slot: SoundSlot; gain: number; rate: number } => {
  const slot: SoundSlot =
    surface === "mud" ? "surface.mud" : surface === "ice" ? "surface.ice" : surface === "bounce" ? "surface.bounce" : "character.footstep";
  const stride = clip === "sprint" ? 1 : clip === "run" ? 0.8 : 0.6;
  // The bounce thump is a whole landing's sound; a step only taps it.
  const surfaceGain = surface === "bounce" ? 0.35 : 1;
  return {
    slot,
    gain: stride * surfaceGain * (remote ? OTHER_PLAYER_GAIN : 1),
    rate: clip === "sprint" ? 1.08 : 1,
  };
};
