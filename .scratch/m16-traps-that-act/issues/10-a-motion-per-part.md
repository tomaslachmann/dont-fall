# 10 — A Motion per Part

**What to build:** `partMotions`, an Attachment carrying one Motion per moving
Part of a parted Asset, so each arm of a sweeper is tuned on its own:
speed, direction and Ramp. ADR 0124.

**Blocked by:** 09 (a Part's Motion carries its own Ramp)

**Status:** done on tests (2026-09-23) — the panel's look is the user's

- [x] `Segment.partMotions?: Record<partName, SegmentMotion>` in the Attachment
      registry (ADR 0099). Precedence: `partMotions[part]` → `motion` → the
      def's default
- [x] Publish refuses a key that names no moving Part of the Segment's Asset
      (a Shooter's aiming Parts included)
- [x] The builder's MOTION panel shows a Part picker when the Asset has more
      than one moving Part, pre-filled from that Part's current Motion, with a
      direction switch on a Spin
- [x] MCP `set_motion` takes an optional `part`
- [x] Tests (shared): a `partMotions` entry moves only its Part; `motion` still
      moves every Part without one; a stored Track without `partMotions`
      resolves byte-identically; publish refuses an unknown Part

## As built

- `track/PartMotions.ts`: the type, its shape check (the registry's), and
  `invalidPartMotionsTargetReason`, which needs the Asset. The API's publish and
  the MCP `validate_draft` both run it. `motionPartNames(module)` is the one list
  of addressable Parts, leaving out a Shooter's aiming Parts.
- `segmentMotionOf(segment, module, part?)` answers for one Part.
- The builder remembers the last Part picked while the selection keeps an Asset
  that has it, and writes through `setSegmentPartMotion`, which drops the
  Attachment once no Part has one. An Asset with a single moving Part (the two-arm
  sweeper) still edits the whole Segment's `motion`, exactly as before.
- The MCP `list_attachments` reference describes it, and `set_motion` takes `part`.

