import { lerpAngle, wrapAngle, type SimInputs } from "@dont-fall/shared";

/**
 * A tick's own input, asked once per tick `PredictionLoop.step` runs (ADR
 * 0109). `fraction` is where in that call's advance the tick's boundary fell,
 * 0 its start and 1 its end. What an input does with it is the caller's
 * business — the prediction loop never looks inside a {@link SimInputs}.
 */
export type TickInput = (fraction: number) => SimInputs;

/**
 * Each tick's own input (ADR 0109): this frame's sample, with `facing` turned
 * back to where the body stood when that tick's boundary fell — eased from the
 * previous frame's sample by the tick's fraction of this frame's advance.
 *
 * The body turns every frame, but the frame's one sample used to be stamped on
 * every tick the frame stepped, so each tick carried the turn of however many
 * frames happened to land in it: 4 or 5 frames' worth at 144 Hz, none at all
 * for the second of two ticks in one frame. The server applies facing as
 * given, so every other client drew that Character's turn in uneven steps.
 * Only `facing` is eased: it is a continuous angle, where every other field is
 * a key held or not. With no previous sample yet, every tick gets this one.
 *
 * Beside the prediction loop rather than in the frame loop: pure over
 * `@dont-fall/shared`, so the netcode suite that drives it never loads the
 * render graph the frame loop imports.
 */
export const inputPerTick = (input: SimInputs, previousFacing: number | null): TickInput => {
  if (previousFacing === null) return () => input;
  return (fraction) => (fraction >= 1 ? input : { ...input, facing: wrapAngle(lerpAngle(previousFacing, input.facing, fraction)) });
};
