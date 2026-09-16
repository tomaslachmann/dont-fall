# 03 — Compose mode: gizmos on a Module draft

**What to build:** A new track-builder mode that edits a Module draft's
primitive list visually: click a box/cylinder, move it with the existing
translate gizmo, resize it with the `scale` gizmo mode, on a grid — seeing
solid-rounded visuals and collider wireframes simultaneously.

**Blocked by:** 01, 02 (the mode composes the primitives those tickets
define and render).

**Status:** planned.

## Why

This is the ticket the milestone exists for: no human authors Module
contents blind, and no human here will learn Blender. The builder already
owns every hard part (viewport, `TransformControls`, grid + snap tiers,
overlap ghost) — the mode re-points them from Segments to primitives inside
one Module draft.

## What to change

- [ ] Compose mode entry/exit (new draft vs. existing Module contents as the
      starting draft); draft state separate from the Track Draft, never
      auto-saved over anything
- [ ] Selection inside the draft: click a primitive to attach the gizmo;
      `setGizmoMode` gains `"scale"` with `setScaleSnap` (official
      `TransformControls` API, verified in three@0.171.0); translate keeps
      the existing snap tiers
- [ ] Add/delete/duplicate primitive in the draft (keyboard + buttons, the
      builder's existing conventions)
- [ ] Dual render per primitive: solid rounded/colored mesh + wireframe box
      (the trigger-marker treatment from `render.ts`) so the collider gap is
      visible while authoring, never a playtest surprise
- [ ] Local-frame `GridHelper` grounding the draft (the `viewport.ts:139`
      pattern, second instance)

## Done when

- [ ] A draft of 3+ boxes can be composed, moved, resized, and deleted
      without touching code — exercised live in the real builder
- [ ] Gizmo scale snaps to the grid tiers; translate matches Segment-mode
      snapping behavior exactly
- [ ] Wireframe always matches the collider the data would build (spot-check
      against ticket 01/02 resolve outputs, not eyeballed)
- [ ] Exiting the mode never mutates the open Track Draft (draft isolation
      test, in-test + live)

## Watch out for

**Don't rebuild the editor.** Every gizmo/grid/snap behavior here must reuse
the builder's existing stack — a second implementation of snapping or
picking is the failure mode, not a shortcut.

**Draft ≠ Track Draft.** The mode edits Module contents, never Segments —
reusing the Track Draft's history/publish path for primitives will corrupt
both; keep the state machines apart.
