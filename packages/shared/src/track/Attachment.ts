import { BOUNCE_SURFACE_ID, invalidBounceReason } from "./BounceOverlay.js";
import { invalidConveyorReason } from "./Conveyor.js";
import { invalidCheckpointReason, invalidStartReason } from "./Course.js";
import { ICE_SURFACE_ID, invalidIceReason } from "./IceOverlay.js";
import { invalidLaunchReason } from "./Launch.js";
import { invalidMotionReason } from "./Motion.js";
import { invalidMudReason, MUD_SURFACE_ID } from "./MudOverlay.js";
import { invalidSegmentColorReason } from "./SegmentColor.js";
import type { SurfaceId } from "./Surface.js";
import type { SegmentAttachments } from "./Track.js";

/** One kind of Attachment (CONTEXT.md) — the field of that name on a Segment. */
export type AttachmentKey = keyof SegmentAttachments;

/** What every Attachment has to say about itself, whatever it does in a Round. */
interface AttachmentDef {
  /**
   * Why `value` is not a storable one, or `undefined` when it is — the
   * reason a refused publish reports (a Revision is immutable, ADR 0032).
   */
  invalidReason: (value: unknown) => string | undefined;
  /** How a refusal names it in a sentence: "a Conveyor", "ice", "the Start". */
  noun: string;
}

/**
 * Why `value` is not a storable Prop (ADR 0095), or `undefined` when it is —
 * exactly `true` (detaching removes the key), the shape ice, mud and bounce
 * established.
 */
export const invalidPropReason = (value: unknown): string | undefined =>
  value === true ? undefined : "prop must be true when present — omit it to leave the Asset where it stands";

/**
 * Every Attachment, keyed by its field (ADR 0099). A mapped type over
 * {@link SegmentAttachments}, so a field added there does not compile until it
 * is described here — which is what stops the next one being validated at
 * publish but forgotten by a re-chain. Listed in the order a refusal names
 * them.
 */
export const ATTACHMENTS: { readonly [K in AttachmentKey]-?: AttachmentDef } = {
  motion: { invalidReason: invalidMotionReason, noun: "a Motion" },
  conveyor: { invalidReason: invalidConveyorReason, noun: "a Conveyor" },
  ice: { invalidReason: invalidIceReason, noun: "ice" },
  mud: { invalidReason: invalidMudReason, noun: "mud" },
  bounce: { invalidReason: invalidBounceReason, noun: "bounce" },
  launch: { invalidReason: invalidLaunchReason, noun: "a launch height" },
  prop: { invalidReason: invalidPropReason, noun: "a Prop" },
  start: { invalidReason: invalidStartReason, noun: "the Start" },
  checkpoint: { invalidReason: invalidCheckpointReason, noun: "a Checkpoint" },
  color: { invalidReason: invalidSegmentColorReason, noun: "a color" },
};

/**
 * Attachments a Prop may still carry: the visual-only ones. Paint changes no
 * physics, so a shovable cone keeps its hue — everything behavioral stays
 * refused beside a body physics owns.
 */
const PROP_COMPATIBLE: ReadonlySet<AttachmentKey> = new Set<AttachmentKey>(["color"]);

/** Every Attachment's key, in {@link ATTACHMENTS}' order. */
export const ATTACHMENT_KEYS = Object.keys(ATTACHMENTS) as AttachmentKey[];

/**
 * The Attachments that choose what a whole deck is made of (ADR 0066/0067/
 * 0070) — one deck, one Surface, so a Segment carries one of them at most.
 * Bottom sheet first: should a Track that skipped publish arrive with two, the
 * one drawn on top is the one physics honours, so the deck plays the way it
 * looks.
 */
export const SURFACE_ATTACHMENTS = [
  { key: "ice", surface: ICE_SURFACE_ID },
  { key: "mud", surface: MUD_SURFACE_ID },
  { key: "bounce", surface: BOUNCE_SURFACE_ID },
] as const satisfies readonly { key: AttachmentKey; surface: SurfaceId }[];

/** One of {@link SURFACE_ATTACHMENTS}' keys. */
export type SurfaceAttachmentKey = (typeof SURFACE_ATTACHMENTS)[number]["key"];

/** The Surface Attachment `segment`'s deck wears, if any — the top sheet of any stack. */
export const surfaceAttachmentOf = (
  segment: SegmentAttachments,
): (typeof SURFACE_ATTACHMENTS)[number] | undefined => {
  for (let i = SURFACE_ATTACHMENTS.length - 1; i >= 0; i -= 1) {
    if (segment[SURFACE_ATTACHMENTS[i]!.key] === true) return SURFACE_ATTACHMENTS[i];
  }
  return undefined;
};

/** Only the Attachments `segment` carries — what re-placing or copying a Segment must keep. */
export const attachmentsOf = (segment: SegmentAttachments): SegmentAttachments => {
  const carried: Record<string, unknown> = {};
  for (const key of ATTACHMENT_KEYS) {
    if (segment[key] !== undefined) carried[key] = segment[key];
  }
  return carried as SegmentAttachments;
};

/**
 * The first Attachment on `segment` whose value is not storable, as its own
 * reason (`"ice must be true…"`), or `undefined`. Reads any object, since what
 * a publish receives is not a Segment until this and the rest say so.
 */
export const invalidAttachmentReason = (segment: object): string | undefined => {
  for (const key of ATTACHMENT_KEYS) {
    const value = (segment as Record<string, unknown>)[key];
    if (value === undefined) continue;
    const reason = ATTACHMENTS[key].invalidReason(value);
    if (reason) return reason;
  }
  return undefined;
};

/**
 * Why `segment` may not carry the Attachments it carries together, or
 * `undefined`. Two rules:
 *
 * - **A Prop is nothing else** (ADR 0095): a body physics owns is not a deck,
 *   not authored movement and not a piece of the course. Every other
 *   Attachment is refused beside it — including one added later, until
 *   someone decides it may ride on a Prop — except the visual-only ones in
 *   {@link PROP_COMPATIBLE}. Refusing is the side a mistake can be undone
 *   from; a stored Revision is not.
 * - **One deck, one Surface** (ADR 0066/0067/0070): at most one of
 *   {@link SURFACE_ATTACHMENTS}.
 */
export const attachmentConflictReason = (segment: SegmentAttachments): string | undefined => {
  if (segment.prop === true) {
    const clashes = ATTACHMENT_KEYS.filter(
      (key) => key !== "prop" && !PROP_COMPATIBLE.has(key) && segment[key] !== undefined,
    );
    if (clashes.length > 0) {
      const named = clashes.map((key) => ATTACHMENTS[key].noun).join(", ");
      return `prop cannot be combined with ${named} — a Prop is a body physics owns, not a deck or a piece of the course`;
    }
  }
  const surfaces = SURFACE_ATTACHMENTS.filter(({ key }) => segment[key] === true).map(({ key }) => key);
  if (surfaces.length > 1) {
    return `${surfaces.join(" and ")} are mutually exclusive — one deck, one Surface, so detach all but one`;
  }
  return undefined;
};
