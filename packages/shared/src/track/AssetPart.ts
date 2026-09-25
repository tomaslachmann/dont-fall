import type { SegmentMotion } from "./Motion.js";
import type { PunchPiece } from "./Punch.js";
import type { TrapDoorCycle } from "./TrapDoor.js";

/**
 * What a Part of an Asset does (ADR 0116):
 *
 * - `still` — it never moves, and is baked into the Track's static colliders
 *   exactly as a whole Asset is;
 * - `moving` — its own kinematic body, posed by a pure function of the Tick,
 *   ridden and hit through the M11 Impact rule (ADR 0061);
 * - `gated` — a body whose collision exists only in its rest pose: a trap
 *   door's leaf is a floor while shut and a hole the moment it moves
 *   (ADR 0117).
 */
export type AssetPartRole = "still" | "moving" | "gated";

/**
 * One named piece of an Asset with a body of its own (CONTEXT.md: Part).
 *
 * An Asset that is one rigid piece — every Asset before 2026-09-21 — declares
 * none of these, and resolves exactly as it always did. An Asset that
 * declares them still places as **one** Segment: the split happens when the
 * world is built (`resolveTrack`), never in a stored Track, in the builder,
 * or in anything an author can take apart.
 *
 * The name is the `part` extra the converter stamps on the Asset's nodes;
 * geometry naming no Part belongs to the Asset's first `still` Part.
 */
export interface AssetPart {
  name: string;
  role: AssetPartRole;
  /**
   * What this Part does when nothing overrides it — the numbers
   * `scripts/convert-df.ts` derived from the authored clip, so placing the
   * Asset and pressing play is enough. A Segment's own `motion` Attachment
   * wins over it (ADR 0116).
   */
  motion?: SegmentMotion;
  /**
   * A `gated` Part's authored swing and hinge (ADR 0117) — the clip's own
   * curve, replayed by the Tick. Its author retunes how often it runs
   * (`Segment.trapdoor`), never its shape: that is keyframed.
   */
  trapDoor?: TrapDoorCycle;
  /**
   * The Part this one hangs from (ADR 0116) — a cannon's barrel inside its
   * carriage. Its Motion is applied before this Part's own, so a nested body
   * is posed where the model has it rather than at the Asset's origin.
   */
  parent?: string;
  /**
   * Which of a Shooter's two aiming axes turns this Part (ADR 0119) — the
   * carriage's yaw or the barrel's pitch. The sweep itself lives in the
   * Shooter's def, because the two axes are independent and a Motion is one
   * movement; this only says which body each one turns.
   */
  aim?: "yaw" | "pitch";
  /**
   * Which piece of a punching glove this Part is (ADR 0121) — the fist, the
   * bellows behind it or the button under it. They share one curve and each
   * reads its own channel of it.
   */
  punch?: PunchPiece;
}

/** Whether `parts` describes an Asset that resolves into more than one body. */
export const hasParts = (parts: readonly AssetPart[] | undefined): parts is readonly AssetPart[] =>
  parts !== undefined && parts.length > 0;

/** The Part named `name`, or the Asset's first `still` Part for geometry that names none. */
export const partFor = (parts: readonly AssetPart[], name: string | undefined): AssetPart | undefined =>
  name === undefined ? parts.find((part) => part.role === "still") : parts.find((part) => part.name === name);
