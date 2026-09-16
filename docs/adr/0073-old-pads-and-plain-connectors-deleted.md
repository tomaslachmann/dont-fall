# 0073 — The old pad Modules and the plain connectors are deleted, not retired

## Context

Two supersessions have landed since the pads were authored:

- **Bounce** is a Segment attachment with a visible inflatable sheet (ADR
  0070) — the grey-box `bounce` Module it grew out of is now just a
  bridge-shaped deck that happens to be bouncy.
- **Launch** is an asset Spring with an author-set apex height (ADR 0069) —
  the grey-box `launch-pad` Module is now just a bridge-shaped deck with a
  fixed vector, and the only non-Spring source of `LaunchPadConfig`s.

Meanwhile the asset transition is underway: Tracks are about to be modeled
from assets only, which leaves the plain procedural connectors (`bridge`,
`bridge-2`) and the Survival `arena` with no future — every converted asset
is socketless and free-placed, so the arena's "lone socketless piece" role
is already the common case, not the exception.

Retirement (the ice/mud/speed-pad treatment: keep the geometry, hide the
id, warn on resolve) would preserve old Tracks — but a retired Module is a
promise the library keeps carrying that geometry, and five more such
promises is exactly the procedural weight the asset transition is shedding.
The user asked for deletion.

## Decision

**Delete `bridge`, `bridge-2`, `bounce`, `launch-pad` and `arena` from
`M1_MODULES` outright. The mechanics stay; only the Modules go.**

- The `bounce` Surface, `SURFACES.bounce` restitution, the Segment bounce
  attachment and its sheets are untouched — only the Module that authored
  the Surface is gone.
- `LaunchPadConfig`, its resolve path, the Epoch latch and the squash
  animation are untouched — only the Module that carried a fixed vector is
  gone, so every pad left is a Spring.
- `M1_TRACK` closes up to four stops (`start`, `checkpoint-spinner`,
  `checkpoint-end-props`, `sandbox`): every beat that matters — the
  Spinner, the Props, both Checkpoints, the sandbox finish — survives.
- Tests that placed the deleted Modules move to survivors (`updraft`
  where deck geometry matters — same 2×4 footprint — `start`/`finish`
  where only an id matters, `sandbox` where open ground matters) or to
  local fixtures (the socketless cases now ride a synthetic pad, the way
  converted assets behave in production).

## Consequences

- Tracks stored before the deletion that place any of the five ids now
  fail `resolveTrack` as unknown-Module — the same as any removed id, and
  publish already refuses unknown ids. Revisions are immutable (ADR 0032),
  so there is no migration: affected Tracks need re-authoring.
- Code-owned seeds self-heal: `syncSeedTrack` (which replaces
  `seedIfEmpty`/`seedTrackIfMissing`) publishes a new Revision whenever the
  stored latest differs from the code's content, so existing databases pick
  up the four-stop M1 seed (and any future seed change) on their next boot
  instead of serving a Revision that references deleted Modules. History
  stays immutable — an explicit fetch of M1 revision 1 still fails, honestly
  naming the unknown Module.
- The procedural palette lists exactly one placeable Module: `updraft`.
  Everything else procedural is either retired (ADR 0064/0066/0067/0068)
  or deleted here.
- `Module.launchPads` and its resolve loop stay though no Module carries
  pads any more — removing the field would churn the shared carrier the
  Springs resolve through for no behavioural gain.
