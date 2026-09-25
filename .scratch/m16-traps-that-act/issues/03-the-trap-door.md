# 03 — The trap door

**What to build:** Two leaves that fall open on a clock and a floor that exists
only while they are shut. ADR 0117.

**Blocked by:** 02

**Status:** done on tests (2026-09-21) — every visual and feel check is the user's

- [x] `gated` Parts: collision exists only in the rest pose. Off the instant the
      real swing starts, back on the Tick the leaves are fully closed again —
      binary both ways, so nothing ever lands on a half-shut door
- [x] The swing is a pure function of the Tick from `(period, phase, hold)`,
      authored in the inspector beside a Motion's numbers and defaulting to the
      clip's (2.17 s cycle, 88°, 0.75 s held open). No replicated state
- [x] The opening shudder is kept and drawn while the floor is still solid — it is
      the telegraph the rule needs, not decoration (ADR 0117)
- [x] The frame is a `still` Part and stays solid throughout
- [x] A Character over an opening door falls: no Ride, no push, no impulse
- [x] Authoring reaches it the same way Motion does — the builder's inspector and
      an MCP setter — and publish validation refuses numbers that cannot run
      (a hold longer than the period, a negative phase)
- [x] Tests (shared): the floor is there at rest and gone one Tick into the swing;
      a Character standing on it falls when it opens and does not get carried; two
      doors with staggered phases open in sequence; the pose at Tick *n* is the
      same on a fresh world and on a replayed one

## Notes

- Derived by `pnpm convert:df` (2026-09-21): 2.17 s cycle — ±2° shudder to 0.42 s,
  fully open at 0.83 s, held 0.75 s, closed at 2.17 s. The constants are in
  `dfAssetDefs.ts` (`TRAPDOOR_*`), waiting for this ticket to read them. Leaves
  rotate about local Z despite their extras naming Y.

## As built

- **The leaves replay the authored clip, sample for sample.** The user's point, mid-ticket:
  the GLBs already carry animations. They are still never *played* — the server has no
  three.js, and a pose every Player must agree on cannot come from one client's playback —
  but `pnpm convert:df` now lifts the curve itself out of the clip (53 samples at its own
  24 fps) into the def, and `trapDoorAngle` replays it. Authored motion, one source of
  truth. Re-tuning the fall means re-exporting the GLB and re-running the converter, which
  is where that knob belongs.
- **"Shut" needs no threshold, because the tremble is negative.** The authored leaf lifts
  ~4° the *wrong* way before it drops, so a leaf is a floor exactly while its angle is at
  or below zero. The telegraph and the collision rule turn out to be the same fact.
- **A `gated` Part is a Moving Segment carrying its clock**, not a fourth kind of body: it
  follows the swing with its colliders switched off, so what is drawn and what could be
  collided with stay the same object. `MovingSegment.solidAt(tick)` is the whole of it.
- **What the sim found, which no unit test would have:** the Ride carried the Character
  along the *opening* arc, flinging it ~2 m sideways — because `rideFor` reads the pose at
  `tick + 1`, and on a leaf's last shut Tick that pose is already falling. A Ride now asks
  `solidAt(tick + 1)` first, which is ADR 0117's "the floor stops existing" made true: the
  fall is straight down, bar the 7 cm the tremble had already tipped it by.
- **The period is floored, not refused.** A publish validates a Segment without its Module,
  and the swing it must outlast is the *Asset's*, so `trapDoorCycleOf` floors a too-short
  period and the builder floors it where the author sets it. Publish still refuses a
  period that is not a positive number, and a phase outside 0..1.
- **Hold is not a knob any more.** The ticket asked for period / phase / hold; hold is part
  of the authored curve now, so the inspector and `set_trapdoor` offer period and phase.
- **Default period: 4 s, and it is a guess.** The clip is 2.2 s of continuous movement with
  no dwell at all — a hole with a floor over it. The remaining 1.8 s is the floor being
  there. First number for the user to play with.
- **Authoring:** a TRAP DOOR section in the builder's inspector (period stepper, four
  head-start presets, a hint that says how long it is shut), and `set_trapdoor` on the MCP
  server, with the Attachment described in `list_attachments`.
