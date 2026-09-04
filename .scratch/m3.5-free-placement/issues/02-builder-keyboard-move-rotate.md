# 02 — Track builder: keyboard move/rotate + manually placed Segments survive edits

**What to build:** Select a placed Segment and reposition/rotate it with the keyboard — arrow keys
nudge position, a rotate step (e.g. bracket or Q/E keys) turns it in 15° increments on any axis.
Holding Shift switches both to a finer step (a 0.1-unit grid for position, 5° for rotation) —
never a fully unconstrained value, same two-tier snap ticket 03's gizmo uses. The moment a Segment
is touched this way it's flagged as manually placed and exempt from the existing `rechainFrom`
auto-recompute, so editing something earlier in the sequence no longer silently resets it.

**Blocked by:** 01 (needs the 3D rotation primitives to expose pitch/roll via keyboard).

**Status:** done

- [x] Arrow-key nudge moves the selected Segment's position by a fixed step per keypress (held for
      repeat); the same keys held with Shift move by the finer 0.1-unit step instead.
- [x] A keyboard rotate step turns the selected Segment by 15° per press, on whichever axis is
      active; held with Shift, it turns by 5° per press instead.
- [x] `trackEdit.ts` gains a pure function that sets a Segment's position/rotation directly
      (bypassing `rechainFrom`'s chain-derivation) and marks it `manuallyPlaced` (or equivalent).
- [x] `rechainFrom` skips any Segment flagged `manuallyPlaced` when cascading from an earlier edit
      — a Segment that's never been touched still auto-follows its predecessor exactly as today.
- [x] Manually verified live (real browser): build a 3+ Segment Track, manually nudge/rotate the
      last Segment away from the chain via keyboard, insert a new Segment near the start, confirm
      the manually-placed Segment's position/rotation is unchanged. Undo/redo still works across
      these new operations.

## Implementation notes

- **`Segment.manuallyPlaced?: boolean`** — added to the shared type (`packages/shared`), purely
  additive like `pitch`/`roll`. Lives on the Segment itself rather than an index-keyed side table
  so it naturally survives insert/delete/reorder/undo-redo along with the Segment it describes.
  It's a pure Track-builder authoring concern — `resolveTrack`/`RapierSimulation`/the Match server
  never read it — but persisting it (rather than keeping it builder-local) means it also survives
  a save → reload → keep-editing session, not just edits within one browser session.
- **`rechainFrom`** now skips re-deriving any Segment flagged `manuallyPlaced` (pushing it through
  unchanged) in addition to its existing index-0 exemption. Whatever comes *after* a manually-
  placed Segment still chains from wherever that Segment actually is — dragging Segment 3 off to
  the side and leaving Segment 4 untouched means Segment 4 still attaches to Segment 3's new
  position, not its original one. Also fixed a latent bug this touched: the index-0 branch built a
  bare `{ moduleId, position, rotation }` literal instead of spreading the Segment, silently
  dropping `pitch`/`roll`/`manuallyPlaced` — same category of bug the ticket 01 review caught in
  `rotateSegment`.
- **`rotateSegment` gained an `axis: "yaw" | "pitch" | "roll" = "yaw"` parameter** (default
  preserves every existing caller's exact behavior — the toolbar's ±90° buttons stay yaw-only) and
  now marks the result `manuallyPlaced`. Its Socket-anchored pivot math generalized from
  `rotateYaw` to full quaternion composition (`segmentOrientation`/`rotateVec3ByQuat`) so pivoting
  works correctly on any axis, not just yaw.
- **New `moveSegment`** — offsets a Segment's world position by a delta (no Socket to anchor,
  unlike rotate), marks it `manuallyPlaced`, re-chains everything after it.
- **Editor UI**: arrow keys move X/Z, PageUp/PageDown move Y, `[`/`]` rotate on whichever axis a
  new three-button Yaw/Pitch/Roll selector in the inspector has active (the pre-existing ±90°
  toolbar buttons are unaffected by this selector — they're a separate, always-yaw shortcut).
  Keyboard handling is ignored while a toolbar text input has focus, so typing a track id/name/URL
  doesn't hijack arrow keys. Inspector label shows "(manually placed)" once a Segment has been
  touched, for at-a-glance feedback.
- Coarse step values (0.5 units, 15°) aren't specified anywhere else in the spec/ADR — chosen as a
  sensible 5x ratio against the two fine values (0.1 units, 5°) that *were* specified.

## Code review finding and fix

- **Fixed — held-key repeat triggered a full scene teardown/rebuild on every event.** Move/rotate
  routed through the same `rerender()` as every structural edit (insert/delete/duplicate), which
  unconditionally disposed and rebuilt the *entire* Three.js Group — expensive, and OS key-repeat
  can fire 20-30 keydowns/sec while a key is held, the exact workflow this ticket adds. Fixed with
  a `TrackViewport.retransformSegments` fast path: move/rotate never add, remove, or reassign the
  `moduleId` of any Segment, so the existing per-Segment groups are still valid and only need their
  transform refreshed — no dispose, no rebuild. `applyEdit`/`rerender` gained a `transformOnly` flag
  used by both the keyboard nudge and the pre-existing toolbar rotate buttons (a correctness-
  preserving win for them too); structural edits (insert/delete/duplicate/undo/redo) are unaffected
  and still use the full rebuild. Re-verified live afterward: fast-path move/rotate, a subsequent
  structural insert, and undo/redo across a mix of both all still work correctly.

## Manual verification (real browser)

No `chromium-cli`/Playwright available in this environment (no network access to install either),
so verification drove a real headless Chrome (`--headless=new --use-gl=angle
--use-angle=swiftshader --enable-unsafe-swiftshader`, needed for WebGL to work at all headless) via
the raw Chrome DevTools Protocol — real `Input.dispatchMouseEvent` clicks by element bounding rect,
real `KeyboardEvent`s dispatched through the exact same `window.addEventListener("keydown", ...)`
path the app uses. A temporary `window.__debug` hook (removed before this commit — not present in
the diff) exposed `history.track` for ground-truth assertions instead of guessing 3D-picked pixel
coordinates.

Verified, against the real running app:
- Built a 3-Segment Track via the palette.
- Selected the last Segment; `ArrowRight` moved it exactly +0.5 on X, `Shift+ArrowUp` moved it
  exactly −0.1 on Z, neither touched Y, and it became `manuallyPlaced`.
- Clicked the real "Pitch" axis button (verified `.active` class actually applied); `BracketRight`
  turned it exactly +15° of pitch without touching yaw; `Shift+BracketLeft` turned it back −5°,
  landing at exactly +10° pitch.
- Selected the first Segment and inserted a new one right after it (an edit earlier in the
  sequence) — the manually-placed Segment (now shifted from index 2 to index 3) kept its exact
  position and pitch, unchanged.
- Undo removed the insert; Redo restored it.
- Zero console errors through the whole run.
