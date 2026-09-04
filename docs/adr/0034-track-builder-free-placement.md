# 0034 — Track builder v2: free position + full 3D rotation for Segments

ADR 0030 fixed Track topology to a strictly linear chain with a uniform footprint; ADR 0031 kept
the chain but freed rotation only in 90° steps, justified by `RapierSimulation`'s static colliders
being "translation-only, no rotation" — a self-imposed simplification (Rapier itself supports
rotated static bodies), not an engine limit. A third grilling round (2026-09, `/grill-with-docs`)
revisited both constraints after finding the actual authoring experience — no drag, no tilt,
positions 100% chain-derived — read as a toy rather than a real content tool, especially against
the original `docs/track-builder-proposal.md` (§5.4), which always described snap-by-default with
a free-placement escape hatch, not an always-locked chain.

## Decision

- **A Segment's position becomes genuinely free** on all three axes. Placing/dragging still snaps
  to the nearest compatible Socket by default (Trackmania-style); holding Shift switches to a
  finer positional grid (0.1 units) instead of removing snap entirely — there is no fully
  unconstrained float-position mode, so a placement never lands on an unreproducible, jittery
  value even when fine-tuning. Track topology itself is unchanged from ADR 0030 — still one
  linear, non-branching sequence, no floating/off-chain pieces — only *how a Segment's transform
  is derived* changes, from "always computed from the chain" to "computed by default, overridable
  per-Segment."
- **A Segment's rotation becomes a full 3D orientation** (yaw + pitch + roll), not a 90°-locked yaw
  scalar. Stored as degrees at every boundary (wire format, editor UI), composed as quaternions
  internally. Rotation snaps to 15° by default; Shift switches to a finer 5° snap tier instead of
  going fully continuous — same reasoning as position: no arbitrary, unreproducible angle should
  ever be reachable, only coarser or finer *clean* ones. Both the mouse gizmo drag and the
  keyboard rotate step honor the same two-tier snap.
- **`RapierSimulation`'s static colliders switch to real rotated rigid bodies** (`setRotation()`),
  retiring the `rotateBoxYaw90`/`isMultipleOf90` AABB-swap trick (`packages/shared/src/math/box.ts`)
  entirely — a simplification of that code, not an extension of it.
- **Once a Segment is manually moved/rotated, it's exempt from `rechainFrom`** (a `manuallyPlaced`
  flag or equivalent) — an unrelated upstream edit no longer silently overwrites a deliberately
  placed Segment. A Segment that's never been touched still auto-follows its predecessor, exactly
  as today.
- **Tilt is available uniformly on every Segment** — no Module-level "can this tilt" flag. Every
  current Module bundles its floor geometry with any embedded Obstacle/Prop/Checkpoint as one rigid
  unit (`modules.ts`), so gating by "type" isn't meaningful — it would invent a category the
  codebase has nowhere else. Untuned slope-walking feel (Rapier's `KinematicCharacterController`
  already climbs/slides by default, just never exercised since nothing has ever been tilted) is
  caught by manual Test Mode, consistent with ADR 0033's existing posture on playability
  validation generally — not gated in code.
- **`Segment`'s wire shape changes additively**: `rotation` keeps meaning yaw; `pitch`/`roll` are
  new optional fields defaulting to 0. Every already-published Revision (including the M1 seed)
  parses unchanged — no migration, no reseed.
- **The randomizer (ticket 06, `chainTrack`) is untouched** — stays chain-only, zero offset/tilt.
  Free placement is an editor-authored capability only; teaching the generator to place
  *interesting, still-completable* gaps and tilts is its own future design problem.
- **The Track builder stays a standalone vanilla-TS app** through this work — no React. ADR 0008's
  React-for-Screens decision covers `apps/client` only; folding Track-building into a React
  "Create" screen happens if/when M4 ships that shell, not before (building the same UI chrome
  twice would be wasted work).
- **Real-time overlap feedback** (ghost-piece red/green while placing/dragging, Trackmania/Fall
  Guys Creative-style) ships as part of the editor. It's a live authoring aid, not a save-blocking
  validator — publishing an overlapping Track still succeeds, exactly like ADR 0033's existing
  "manual Test Mode, not a solver" stance on reachability. Multi-select (move/rotate several
  Segments together) also ships this round.

## Consequences

- `packages/shared/src/track/Module.ts`/`Track.ts`: `Socket` needs a full 3D orientation (not just
  a yaw scalar) so snap-alignment composes correctly in 3D; `Segment`/the wire schema gains
  `pitch`/`roll`; `placeAfter`/`chainTrack` generalize their yaw-composition math to quaternion
  composition.
- `packages/shared/src/math/box.ts`: `rotateBoxYaw90`/`isMultipleOf90`'s AABB-swap machinery is
  deleted, not generalized — real Rapier rotation replaces it. Footprint overlap-checking
  (previously unimplemented — a gap the M3 round-2 code review already flagged) generalizes to
  OBB-vs-OBB, needed now since free placement can put footprints where 90°-chained placement mostly
  couldn't by construction.
- `apps/track-builder`: a real interaction rewrite — Three.js `TransformControls` (translate +
  rotate gizmo), keyboard nudge, multi-select, live overlap ghost-feedback. Ticket 08's pure-edit-
  function seam (`trackEdit.ts`) is extended, not replaced, keeping this app's existing split:
  editor logic is unit-testable, DOM/Three.js wiring stays thin and manually/Playwright-verified.
- Tracked as its own milestone (M3.5), completed before M4 starts.
