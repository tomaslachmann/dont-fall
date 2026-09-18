# 0099 — A Segment's Attachments are one registry

## Context

Ticket 7 of `docs/research/codebase-audit-2026-09.md`, taken up by the user on
2026-09-18.

A Segment has carried more and more authored, optional fields since M11: a
Motion (ADR 0061), a Conveyor (0064), ice (0066), mud (0067), a Start and
Checkpoints (0068), a Spring's height (0069), bounce (0070), being a Prop
(0095). Each one arrived the same way: a field on `Segment`, a validator beside
its concept, a clause in the API's `isSegment`, its own
`invalidTrackXReason` loop and its own two lines in `publishTrack`, its own
`setSegmentX` in the builder, its own line in `duplicateSegment` and its own
line in the re-chain's `chainOnto`. Seven lists, kept in step by hand. The
conflict rules enumerated them a second time: `propConflictReason` named all
eight others, and the Surface rule named ice, mud and bounce.

## Decision

**A Segment is its placement plus its Attachments, and every Attachment is
described once, in `packages/shared/src/track/Attachment.ts`.**

- `Segment extends SegmentAttachments`. `Segment` keeps where it stands
  (`moduleId`, `position`, `rotation`, `pitch`, `roll`, `scale`) and the
  builder's `manuallyPlaced`; everything authored on top of that is a field of
  `SegmentAttachments`. A new field has to be one or the other, on purpose.
- `ATTACHMENTS` is a mapped type over `keyof SegmentAttachments`, so a field
  added there **does not compile** until it has an entry: its storable-value
  check and the noun a refusal names it by.
- What used to be seven lists reads the registry: publish validation is one
  `invalidTrackAttachmentReason` (each value's shape, then the conflicts, per
  Segment); the builder has one `setSegmentAttachment(track, index, key,
  value)`; the re-chain and Duplicate copy `attachmentsOf(segment)`.
- `SURFACE_ATTACHMENTS` is the one-deck-one-Surface choice as data, bottom
  sheet first. `resolveTrack`'s tie-break (the top sheet wins), the Surface
  rule, the builder's Surface picker and its panel all read it.

Three things are deliberately **not** in the registry:

- **The Start and a Checkpoint keep their own setters.** Each is a rule across
  the Track — one Start; Checkpoints numbered 1, 2, 3 and renumbered when one
  goes — so `setSegmentAttachment` does not accept either key. Duplicate says
  the same thing: a copy is never the Start, and a Checkpoint's copy is the
  next one.
- **What an Attachment does in a Round** stays in `resolveTrack`. Those are
  different outputs, not one shape repeated; making them one is the audit's
  ticket 5, not this.
- **Which Attachments lock the builder's Prop toggle and which it clears** is
  panel policy, not a property of the Attachment, and stays in the panel and
  the engine.

### A Prop refuses every other Attachment, including future ones

ADR 0095 refused a Prop beside a deck, a Motion and course furniture, which at
the time was all eight other fields. The rule is now written as *every other
Attachment*, so one added later is refused on a Prop until someone decides it
may ride on one. That is the side a mistake can be undone from: a refused
publish is re-published, a stored Revision is immutable (ADR 0032).

## What it found

**The re-chain was already missing three Attachments.** `chainOnto` carried
Motion, Conveyor, ice, mud, the Start and a Checkpoint — not bounce, a
Spring's height or a Prop, the three added after it was written. A Segment
chained by its Sockets lost any of them the moment anything re-placed it: an
edit upstream, a gizmo drag or nudge of the Segment itself (both go through
`settleOne`), or **scaling it**. The per-kind tests had each proved their own
Attachment survived a re-chain; nobody had written one for the three that
didn't. The new test runs over every key of the registry, and its sample table
is typed so that it too fails to compile without an entry.

## Consequences

- An Attachment now costs a field on `SegmentAttachments`, an entry in
  `ATTACHMENTS` (which the compiler asks for), its validator, and whatever it
  does in `resolveTrack` and the builder's panels. Publish, the re-chain,
  Duplicate and the generic setter need nothing.
- Publish reports the first bad Segment rather than the first bad *kind*
  across all Segments. The reasons themselves are unchanged, word for word.
- The builder's engine lost two methods nothing called
  (`setSegmentIce`, `setSegmentMud`); the Surface picker had replaced both.
