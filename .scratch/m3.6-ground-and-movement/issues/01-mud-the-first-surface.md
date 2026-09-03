# 01 — Mud: the first Surface that does something

**What to build:** A Track piece can be muddy, and standing on it visibly slows a Character down.
This is the tracer bullet for the whole Surface feature — it cuts a narrow path through every layer
the later Surface tickets widen: authoring a Surface on a Module, resolving it, finding it under a
Character at simulation time, and acting on it.

Mud is deliberately first rather than ice: capping top speed works on today's movement model, so
this ticket does not have to wait for the acceleration rewrite (ticket 05). Ice does have to wait,
because before velocity persists there is nothing for a grip scalar to multiply.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] A Module author can mark a whole Module, or one floor piece within it, as a given Surface —
      additive and optional, exactly like ADR 0034's `pitch`/`roll`
- [x] The two levels collapse most-specific-first, once, at Track resolution — never in the tick
      loop, so no default-resolution logic runs 30 times a second on both client and server (ADR
      0036)
- [x] The simulation can answer "what Surface is this Character standing on?" from the floor collider
      the character controller already reports, without a new scene query — a new query would depend
      on collider insertion order and break client/server determinism quietly rather than loudly
- [x] Mud caps a Character's top speed while leaving its acceleration alone
- [x] One demo Module, visually identical to existing floor pieces — the property is the deliverable,
      the look deliberately is not
- [x] Every previously published Revision, the M1 seed included, loads and plays unchanged, with
      every Surface resolving to the default
- [x] Unit tests for the collapse: a floor piece's own Surface wins over its Module's, a Module's wins
      over the default, and a Module with none anywhere is default throughout
- [x] Manually verified live: walking onto the mud Module visibly slows the Character, walking off it
      restores full speed

## Implementation notes

- **New `packages/shared/src/track/Surface.ts`**: `SurfaceId` (a plain `string`, not a closed union —
  new Surfaces are added to `SURFACES` without touching this type, exactly like `Module.id`),
  `SurfaceConfig` (today just `topSpeedMultiplier`; `grip` — a scalar multiplying both acceleration
  and drag — lands once the acceleration model does, ticket 05/06), `DEFAULT_SURFACE`, the `SURFACES`
  catalog (`default`, `mud`), and `surfaceConfig(id)` (falls back to `default` for an unknown id).
  Mud's `topSpeedMultiplier` (0.5) is deliberately a placeholder — the milestone spec records the
  exact numbers as "a measurement, not a decision," to be tuned against a real mud Module later, not
  litigated here.
- **`Box.surface?`/`Module.surface?`** (ADR 0036): `Box` (in `math/box.ts`) gets a plain `surface?:
  string` — kept untyped to `SurfaceId` deliberately, so `math/` never depends on `track/`; `Module`
  imports the real `SurfaceId` alias. Both additive/optional, resolving to `undefined` for every
  Revision published before this ticket.
- **`resolveTrack`'s Surface collapse**: a new `staticSurfaces: SurfaceId[]` return field, computed
  in the same loop as `statics` (`box.surface ?? module.surface ?? DEFAULT_SURFACE`), **index-aligned
  with `statics`** rather than folded into `OrientedBox` itself — keeps `OrientedBox` (a pure math
  type used well beyond Track floors: Footprint bounds, Checkpoint volumes) free of a domain field,
  at the cost of an implicit pairing invariant. That invariant is confined to exactly two places: the
  loop that produces both arrays together, and `RapierSimulation`'s constructor, which zips them once
  into a handle map and never stores either array again.
- **`RapierSimulation` gains the static-collider handle map ADR 0036 calls for**
  (`staticSurfaceByHandle: Map<number, SurfaceId>`), populated in the constructor from
  `config.staticSurfaces` zipped against `config.statics` by index. `SimulationConfig.staticSurfaces`
  is optional and missing/short entries resolve to `DEFAULT_SURFACE` — every existing caller/test that
  never heard of Surfaces keeps behaving exactly as before.
- **`CharacterController` reports its ground collider, `RapierSimulation` resolves the Surface**:
  `resolveCollisions` (which already walks this tick's `computeColliderMovement` collisions for the
  dash-into-wall check) now also tracks whichever collision has the highest `normal.y` among the
  roughly-horizontal ones (`normal.y > WALL_NORMAL_MAX_Y`, reusing the existing wall-detection
  threshold rather than inventing a new one) as `currentGroundColliderHandle` — exposed via a new
  `groundColliderHandle` getter, `undefined` whenever not grounded. No new Rapier query: this is
  exactly "the floor collider the character controller already reports," per ADR 0036. Reset to
  `undefined` in `endTick` while ragdolling — nothing sweeps the ground during a knockdown, so
  leaving the last-known handle in place could hand back a stale (possibly muddy) Surface the instant
  the Character gets up somewhere else entirely.
- **One tick of lag, deliberately, matching an existing pattern**: `RapierSimulation.tick()` reads
  `character.groundColliderHandle` right after `character.endTick()` (this tick's ground sweep has
  already run) and calls `character.setSurfaceTopSpeedMultiplier(...)`, which is only consumed at the
  *top* of the *next* tick's `beginCapsuleTick` (`WALK_SPEED * this.surfaceTopSpeedMultiplier`). This
  is the same one-tick lag `grounded` itself already has relative to jump/landing — not a new class of
  timing quirk.
- **Scoped to `WALK_SPEED` only, not Dash** — the ticket's acceptance criteria are entirely about
  walking; Dash stays a separate, unaffected branch until ticket 05 makes it "a contributor to
  [persistent] velocity rather than a separate branch," at which point Surface interaction with Dash
  is worth a fresh look, not an assumption carried over from this ticket.
- **Demo Module**: `mud` in `packages/shared/src/track/modules.ts`, deliberately identical geometry to
  `bridge` (same statics/sockets/footprint), `surface: "mud"`. Added to `M1_MODULES`/`MODULE_LIBRARY`
  — picked up automatically by the Track builder's palette and track-service's random generator
  (which already treats every library Module uniformly; no new "teach the generator about Surfaces"
  logic was added, matching the milestone's explicit exclusion).
- **Threaded `staticSurfaces` through every `RapierSimulation`-constructing call site**:
  `apps/server/src/index.ts`, `apps/client/src/main.ts` (both the render `stage` and the local
  prediction `localSim` — only the latter needs it, since `staticSurfaces` isn't consumed by
  rendering), and `apps/track-builder/src/playtest.ts`.

## Manual verification (real browser)

No Playwright/chromium-cli available in this environment (no network access to install either), so
this drove a real headless Chrome via the raw Chrome DevTools Protocol (`ws` package), same approach
as prior M3.5 tickets. A temporary `window.__debugSim` hook in `playtest.ts` (removed before this
commit) exposed the live `RapierSimulation` for ground-truth position reads.

Built a Track (`start` → `mud` → `start`) via three real clicks on the actual module palette entries
(each insert auto-selects the new Segment, so the next click chains after it — no hand-rolled
positions), started **Playtest** with a real click, then held a real `KeyW` keydown (no keyup — an
actual held key, not simulated auto-repeat) for 4 seconds while sampling the Character's position
every 250ms. Measured per-interval speed:

```
start:  6.40, 5.64                          (~WALK_SPEED = 6)
mud:    3.20, 3.20, 2.80, 3.20, 2.80         (~half — matches topSpeedMultiplier = 0.5)
start:  5.26, 5.60, 6.40, 6.40, 5.60, 6.40   (back to ~WALK_SPEED)
```

Confirmed both numerically (the clean halving and full recovery) and visually in captured
screenshots — the mud Module renders identically to every other straight piece, exactly as required.

## Code review findings and fixes

`/code-review high` (physics/simulation logic warrants high, per CLAUDE.md) — 6 findings, all fixed:

- **Fixed — a Character-to-Character contact could be mistaken for the floor.** The new ground-
  candidate scan in `resolveCollisions` picked the collision with the highest `normal.y` with no
  `!hitCharacter` exclusion, unlike the wall-knockback check three lines below it. Two overlapping
  Characters standing on a tilted Surface (ADR 0034 pitch/roll) whose own `normal.y` is reduced below
  1.0 could have their contact's `normal.y` outrank the real floor, silently resolving to
  `DEFAULT_SURFACE` (or the wrong Surface) for a tick. Added the same `!hitCharacter` filter the
  dash-wall check already uses. Not given a dedicated new test — reliably engineering a tilted-floor-
  plus-character-overlap scenario where the contact normal *beats* the floor's own is disproportionate
  machinery for a one-line filter that now structurally mirrors an already-tested sibling check.
- **Fixed — `reconcileTo` didn't reset the ground handle or the top-speed multiplier**, only
  position/velocity/grounded/motion-state/dash. A correction crossing a Surface boundary (mud vs
  default) would leave the first replayed tick running with whatever multiplier was set *before* the
  correction — a second, undocumented tick of wrong walk speed stacked on the position correction
  itself. Now resets both to their neutral defaults in the non-down branch, since the snapshot itself
  carries no Surface (ADR 0036: derived from position, never replicated) — the next real ground sweep
  recomputes the true value one tick later, collapsing this into the same already-accepted one-tick
  lag rather than a second, separate one.
- **Fixed — `playground.ts` dropped `staticSurfaces`**, and the two test harnesses that build a
  `RapierSimulation` from its `PLAYGROUND_STATICS` (`tickAddressedInput.integration.test.ts`,
  `predictionRegression.harness.test.ts`) passed no `staticSurfaces` at all. Harmless today (no M1
  Module sets `surface`), but silent the moment one does. Added `PLAYGROUND_STATIC_SURFACES` and
  threaded it through both harnesses.
- **Fixed — `WALL_NORMAL_MAX_Y` (tuned/named for dash-wall classification) was reused as the ground-
  for-Surface threshold**, coupling two unrelated systems to one knob — a future dash-feel tuning pass
  could silently retune which collisions report a Surface. Added a separate `SURFACE_GROUND_NORMAL_MIN_Y`
  constant, starting at the same value but independently tunable, with a comment at both definitions
  cross-referencing the other.
- **Fixed — duplicated "unknown id → default" fallback.** `RapierSimulation`'s per-tick resolution
  computed `?? DEFAULT_SURFACE` inline before calling `surfaceConfig`, which already does the same
  fallback internally — two independent definitions of "no Surface found" that could silently diverge.
  Changed `surfaceConfig` to accept `SurfaceId | undefined` and own the entire fallback decision;
  the call site now just passes the raw (possibly-missing) lookup through.
- **Fixed — `Box` (a pure geometry primitive used well beyond Module floors: `Footprint.bounds`,
  `Checkpoint.volume`) inherited an optional `surface` field with no meaning on those uses.** Reverted
  `Box` to its original two fields; added a new `FloorBox extends Box` (in `Module.ts`, where the
  domain concept lives) carrying `surface?`, and changed `Module.statics: Box[]` to `FloorBox[]`. No
  call-site changes needed — every existing static-Box literal is still a structurally valid
  `FloorBox` (the new field is optional).

Re-verified afterward: full monorepo typecheck clean, full test suite green (224 shared / 68
track-builder / 32 track-service / 78 client / 16 server — one new test added, for `surfaceConfig`'s
`undefined` case). The live-browser mud verification above wasn't re-run — none of these six fixes
touch the single-Character walking path (the `!hitCharacter` filter and `reconcileTo` reset are both
no-ops with only one Character in the world and no reconciliation in local playtest; the rest are
type-only or drop-in-equivalent changes), and the full automated suite already covers that.
