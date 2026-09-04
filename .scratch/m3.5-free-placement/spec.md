# M3.5 — Track builder v2: free placement

Recorded from a `/grill-with-docs` session (2026-09). Supersedes parts of ADR 0030/0031; full
decision record in `docs/adr/0034-track-builder-free-placement.md`.

## Problem Statement

The Track builder (`apps/track-builder`, M3) technically proves the Module/Socket/Track
architecture end-to-end, but as an authoring tool it doesn't hold up: a Segment's position is
never something you set — it's always computed by chaining Sockets end-to-end — and rotation is
two sidebar buttons in fixed ±90° steps, with no drag, no keyboard nudge, and no tilt on any axis.
Compared to the reference authoring tools this project's own proposal doc cites (Trackmania, Fall
Guys Creative, Golf With Friends), and to the proposal's own described interaction model (grid/
socket snap by default, with a free-placement escape hatch), the current builder reads as a demo
of the data model rather than a tool a track author would actually want to build with.

## Solution

Give a Segment a genuinely free position (all three axes) and a genuinely free 3D rotation (yaw,
pitch, roll), snap-assisted by default with a modifier-key override, manipulated through an
on-canvas gizmo plus keyboard nudge — while keeping Track topology exactly as linear and
non-branching as ADR 0030 already established. Once a Segment is manually placed it stops
auto-following the chain, so free-form authoring survives ordinary edits elsewhere in the
sequence. Physics keeps up: `RapierSimulation`'s static colliders switch to real rotated rigid
bodies instead of the current axis-aligned-only trick, so a tilted piece is actually collidable at
that angle, not just visually tilted.

## User Stories

1. As a track author, I want to drag a placed Segment to any position in 3D space, so that I can
   fine-tune a jump's distance or a platform's placement without authoring a new Module variant
   for every distance I want to try.
2. As a track author, I want a dragged Segment to snap to the nearest compatible Socket by
   default, so that ordinary corridor-building stays as fast as it is today.
3. As a track author, I want to hold Shift while dragging to switch to a finer positional grid
   (0.1 units) instead of the normal Socket-snap, so that I can fine-tune a placement without ever
   landing on an arbitrary, unreproducible float value.
4. As a track author, I want to nudge a selected Segment's position with the keyboard, so that I
   can make small precise adjustments without fighting the mouse.
5. As a track author, I want to rotate a selected Segment freely on any axis (yaw, pitch, roll),
   not just yaw in fixed 90° steps, so that I can build banked turns, ramps, and tilted platforms
   the way Trackmania/Fall Guys-style pieces do.
6. As a track author, I want rotation to snap to clean angle increments (15°) by default, so that
   I don't end up with ugly, hard-to-reproduce odd angles by accident.
7. As a track author, I want to hold Shift while rotating to switch to a finer 5° snap tier instead
   of the normal 15°, so that I can dial in a more precise angle without losing snapping
   altogether — there's never a reachable angle that isn't a clean, reproducible value.
8. As a track author, I want the same rotate/move controls (including the two-tier snap and its
   Shift modifier) available from the keyboard as from the mouse, so that I'm not forced into
   imprecise mouse-only manipulation.
9. As a track author, once I've manually moved or rotated a Segment, I want it to stay exactly
   where I put it regardless of edits I make elsewhere in the sequence, so that inserting or
   deleting an earlier Segment doesn't silently undo my placement work.
10. As a track author, I want to select multiple Segments and move or rotate them together, so
    that adjusting a whole section of the Track doesn't mean repositioning each piece one at a
    time.
11. As a track author, I want live visual feedback (a ghost-piece preview, red when overlapping,
    green when clear) while I'm placing or dragging a Segment, so that I can see a structural
    problem immediately instead of discovering it in a playtest.
12. As a track author, I want to tilt any Segment — whether it's a plain floor piece or one with a
    Spinner/Props/Checkpoint baked in — so that I'm not blocked by an arbitrary category
    distinction the tool invents.
13. As a track author, I want a tilted floor Segment to actually be walkable/climbable up to some
    reasonable slope (even if untuned for feel yet), so that "tilt" is a real physical property of
    the Track, not a purely cosmetic visual rotation with a flat hitbox underneath.
14. As a returning player, I want every Track Revision published before this change (including the
    M1 seed) to keep loading and playing exactly as it did, so that this rewrite doesn't silently
    invalidate existing published content.
15. As the project maintainer, I want the Track builder to remain a standalone vanilla-TS app
    through this work, so that no React investment is made here before M4 decides whether/how the
    builder folds into `apps/client`'s eventual React shell.
16. As the project maintainer, I want the random Track generator (ticket 06) to be entirely
    unaffected by this change, so that a real design pass on "interesting, still-completable
    generated gaps/tilts" stays a deliberate future decision, not a side effect of an editor
    ticket.

## Implementation Decisions

- **Segment position**: becomes an independently authored `Vec3`, not solely a value derived by
  `rechainFrom`. A newly inserted Segment still defaults to chain-derived placement (unchanged
  behavior for the common case); a Segment gains a `manuallyPlaced` flag (or equivalent) the
  moment it's dragged/rotated by hand, and `rechainFrom` skips any Segment carrying that flag when
  cascading from an earlier edit.
- **Segment rotation**: generalizes from a single yaw scalar to yaw + pitch + roll. Wire/storage
  shape changes **additively** — `rotation` keeps meaning yaw; `pitch`/`roll` are new optional
  fields defaulting to `0`. Composed internally as quaternions; exposed at every boundary (editor
  fields, wire format) in degrees.
- **Two-tier snap, not snap-vs-free, for both position and rotation**: default position snap is
  the nearest compatible Socket; Shift switches to a 0.1-unit grid, never a fully unconstrained
  float. Default rotation snap is 15°; Shift switches to a 5° grid, never fully continuous. Both
  the mouse gizmo and the keyboard move/rotate step honor the same two tiers and the same Shift
  modifier — there is no reachable position or angle that isn't a clean, reproducible value.
- **Socket** gains a full 3D orientation (not just a yaw scalar), so `placeAfter`'s Socket-to-
  Socket alignment composes correctly for a tilted predecessor. The snap algorithm generally
  follows the original proposal's §5.4 shape: find candidate Sockets within a snap radius, prefer
  the best match, fall back to the finer grid described above when Shift is held or nothing
  qualifies.
- **`packages/shared/src/math/box.ts`**: `rotateBoxYaw90`/`isMultipleOf90`'s AABB-swap machinery is
  removed outright, not extended. A new oriented-box (OBB) representation/overlap-test replaces it
  wherever Footprint overlap needs checking (both the editor's live ghost-feedback and, if reused,
  any shared geometry helper).
- **`RapierSimulation`**: static collider construction switches to setting a real rotation on the
  rigid body (`setRotation()` with a quaternion) instead of pre-rotating an axis-aligned box by
  hand. This is a simplification of that code path, not an addition to it.
- **Character movement on tilted floors**: relies on Rapier's `KinematicCharacterController`'s
  existing (default, currently unconfigured) slope climb/slide behavior. No new movement code is
  written for this milestone; tuning that feel for this game specifically is explicitly deferred
  (see Out of Scope).
- **`apps/track-builder` editor**: Three.js `TransformControls` (translate + rotate gizmo) drives
  the on-canvas interaction; keyboard arrow-keys/bracket-keys mirror the same move/rotate step.
  Multi-select applies the same move/rotate operations to a group. All of this routes through
  `trackEdit.ts`'s existing pure-function seam (extended, not replaced) — `main.ts`/`viewport.ts`
  stay thin wiring around it, per this app's established split (ticket 08).
- **Overlap feedback**: a live, editor-only ghost-piece preview (red/green) computed from the new
  OBB overlap test. It is informational, not a save-blocking gate — `POST /tracks` behavior is
  unchanged; an overlapping Track can still be published, exactly as ADR 0033 already treats
  reachability (manual Test Mode is the actual safety net).
- **`chainTrack`/the randomizer (ticket 06)**: no changes. It keeps producing zero-offset,
  zero-tilt, perfectly touching Tracks.
- **Track builder tech stack**: unchanged (vanilla TS + Vite + Three.js). No React work in this
  milestone; ADR 0008's React-for-Screens scope still covers `apps/client` only.

## Testing Decisions

Good tests here exercise external behavior (a Track's resolved geometry, a Segment's final
position/orientation after a sequence of edits, whether two Footprints report overlapping) — never
internal Three.js/gizmo mechanics.

- **`packages/shared/src/track/*`**: unit tests on `placeAfter`/`chainTrack`/`resolveTrack` and the
  new quaternion/Socket-orientation composition and OBB overlap helpers — this project's existing
  seam and prior art (`Track.test.ts`).
- **`packages/shared/src/math/box.ts` / `RapierSimulation`**: unit/integration tests confirming a
  rotated static collider actually collides at its rotated position (not the old pre-rotated-AABB
  approximation), and that a Character's `computedGrounded()`/movement behaves sanely walking onto
  a moderately tilted static floor. Prior art: this project's existing physics test suite style
  (`CharacterController`-adjacent tests, `predictionRegression.harness.test.ts`'s harness-based
  approach for anything requiring judgment about "did this feel right").
- **`apps/track-builder/src/trackEdit.ts`**: unit tests for free move, 3D rotate,
  `manuallyPlaced`/rechain-exemption semantics, and multi-select group operations — prior art:
  `trackEdit.test.ts`'s existing pure-function test style (ticket 08).
- **`apps/track-builder/src/main.ts`/`viewport.ts`** (TransformControls wiring, keyboard/Shift
  handling, ghost-preview rendering): **not** unit-tested — manually verified live in a real
  browser (Playwright + Chromium), matching every prior Track builder ticket's own verification
  standard (ticket 04/05/08's "manually verified live... zero console errors" pattern).

## Out of Scope

- **Tuning Rapier's slope climb/slide feel** for this game specifically (max walkable angle, slide
  speed, "hilarious when you fail" feel on a steep ramp). This milestone makes tilt real and
  collidable; making it *feel good* to walk on is its own design pass once real tilted content
  exists to test against.
- **The random Track generator gaining gaps/tilts.** `chainTrack` stays exactly as it is.
  Generating *interesting, still-completable* variation is a future design problem, not a side
  effect of this work.
- **Any Track builder tech-stack change.** No React, no framework migration. Revisit only if/when
  M4 ships `apps/client`'s React shell and a decision is made to fold Track-building into it as a
  "Create" screen.
- **Server-side/`POST /tracks` overlap enforcement.** Overlap feedback is a live editor aid only;
  publishing an overlapping Track is not blocked, consistent with ADR 0033.
- **Any change to Track topology.** Still one linear, non-branching sequence — no floating/off-
  chain decorative pieces, no branching paths. Only per-Segment transform freedom changed.

## Further Notes

- The stated justification for needing free position ("we can never make jump/gap Segments
  without it") doesn't fully hold — a `Gap` Module (already a named term in `CONTEXT.md`) could
  ship as a fixed-span piece exactly like `Bridge` does today, no free position required. The real
  and better justification is authoring iteration speed: testing "is this jump 6 or 7 units" via
  dragging beats authoring a new Module variant per distance. Recorded here so the reasoning stays
  accurate for whoever reads this later.
- `RapierSimulation`'s static-collider rotation was previously justified in code comments as "Rapier
  colliders don't rotate" — that's an overstatement. Rapier fully supports rotated static rigid
  bodies; the actual constraint was this codebase's own `Box` type never storing an orientation.
  Worth being precise about this distinction in any future code comments touching the same area.
