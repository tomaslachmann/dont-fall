# 06 — The belt

**What to build:** `DF_belt` as an Asset that conveys: a flat deck that carries
whoever stands on it the moment it is placed, slats scrolling across it at the
speed it actually runs, and side rails you can be shoved into. ADR 0120.

**Blocked by:** 01 (the converter), 02 (Parts)

**Status:** done on tests (2026-09-21) — every visual and feel check is the user's

- [x] `pnpm convert:df` converts it: roles, one still Part (housing, rollers,
      rails, arrows), the 36 slats dropped from collision, and the deck's own
      flat top as what a Character stands on
- [x] `AssetModuleDef.attachments` — the defaults a placed Segment carries (ADR
      0120), read wherever the Segment is silent, never written into a stored
      Track. The belt's is `conveyor: { preset: "medium" }`
- [x] A placed belt runs along its own +Z at 4 u/s, turning with the Segment, and
      the CONVEYOR panel retunes it with the presets it already has — no new
      authoring surface
- [x] The slats scroll at the belt's own speed, in sim time, so what you see is
      what carries you. Drawn only: the deck is one flat collision surface
- [x] The rails are solid, and the arrows are scenery
- [x] The chevron strip the Conveyor Attachment draws on an ordinary deck (ADR
      0064/0096) is not drawn on this one — the machine already says which way
      it runs, and two answers on one deck is one too many
- [x] Tests (shared): a placed belt resolves with a Conveyor without one being
      stored; a Segment's own Conveyor overrides it; the flow turns with the
      Segment; a Character standing on it is carried; publish stores nothing new

## Notes

- Measured from the export (2026-09-21): 2.52 × 1.22 × 5.23, 36 slats,
  `belt_loop_length` 10.913, `roller_radius` 0.4, rollers at z = ±2.1.
- The slats' own clip is one loop of the belt. Like every other clip in this
  milestone it is read, not played: it gives the scroll its spacing, and the
  speed comes from the Conveyor, so a retuned belt's slats keep up by
  construction.

## As built

- **The loop is four numbers, not the clip's 121 samples.** The slats' authored path is two
  straight runs joined by a half turn round each roller — so `BeltPath` stores the rollers'
  place, their radius and the slat count, and `beltSlatPose` walks it. The proof it is the
  authored loop rather than an approximation of it: those four numbers give a loop of
  10.913 m, which is exactly the `belt_loop_length` the export's own extras carry.
- **The deck is a box the converter adds.** The model has no flat belt surface — the top
  run *is* the slats — so a `deck` in the converter's table emits one closed, outward-wound
  collision box where they run (x ±1.04, z ±2.1, top at 1.13). Measured and written there,
  never fitted: what a Character stands on is not a thing to guess at.
- **`AssetModuleDef.attachments` is typed to the one field it may name**
  (`Pick<SegmentAttachments, "conveyor">`), so ADR 0120's narrowness is a compiler fact
  rather than a promise in prose.
- **The chevron strip is skipped for a belt**, through an `own` flag on the resolved
  Conveyor — physics and sound read the entry either way, and the machine says which way it
  runs by itself.
- **The SURFACE panel opens on the belt that is there.** A conveyor Asset would otherwise
  offer to ATTACH BELT to a thing that is already conveying; it now shows the preset and
  angle, with no detach button (there is nothing of the author's to detach) and a line
  saying that changing it makes it this Segment's own.
- **What the live check is for:** whether 4 u/s is the right default, whether the slats read
  as carrying you at the speed you are actually carried, and whether the rails keep a
  shoved Character on.
