/**
 * Where the rest of your Party stands on the menu's hero (M15 ticket 16, ADR
 * 0112: "the menu's hero draws every member's bean"). Pure, and in bean
 * heights, so the stage that draws it (`characterPreviewStage.ts`) owns the
 * metres and this owns only the arrangement.
 *
 * Yours stands at the origin, in front and in the middle — the hero is still
 * your bean. The others fan out behind it, alternating right then left, each
 * pair one rank further out and further back, turned a little toward the
 * middle so the group reads as a group and not as a queue. The order is the
 * Party's own (host first, then by joining), so a bean keeps its place while
 * someone behind it comes and goes.
 */

/** One companion's spot: `x` to the right and `z` toward the camera, in bean heights; `yaw` in radians. */
export interface FormationSlot {
  x: number;
  z: number;
  yaw: number;
}

/** How far each rank stands out to the side, in bean heights — far enough that shoulders only just overlap. */
const SIDE_STEP = 0.72;
/** How far each rank stands back, in bean heights — enough that yours is plainly in front. */
const BACK_STEP = 0.42;
/** How far a companion turns toward the middle, in radians. */
const TURN_IN = 0.3;

/** The spots of `companions` beans beside yours, in the order they were given. */
export const partyFormation = (companions: number): FormationSlot[] =>
  Array.from({ length: Math.max(0, companions) }, (_, i) => {
    // Right, then left, then one rank further out: a party of two always leans the same way.
    const side = i % 2 === 0 ? 1 : -1;
    const rank = Math.floor(i / 2) + 1;
    // A rig faces +z (the camera) at yaw 0; a negative yaw turns a bean on the right toward the middle.
    return { x: side * rank * SIDE_STEP, z: -rank * BACK_STEP, yaw: -side * TURN_IN };
  });

/** How far the formation reaches either side of yours, in bean heights — what the camera must fit. */
export const formationHalfSpan = (slots: readonly FormationSlot[]): number =>
  slots.reduce((widest, slot) => Math.max(widest, Math.abs(slot.x)), 0);
