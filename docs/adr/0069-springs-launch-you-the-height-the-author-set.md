# 0069 — A Spring launches you the height its author set, and squashes as it does

## Context

Eight spring Assets sit in the palette doing nothing: `kaykit_spring`, the four
`kaykit_spring_pad_*` colours, and `trap_platformspring{blue,green,red}`. They
are `platform`-category Assets with a footprint and no mechanic, so a runner
walks over a coil spring and nothing happens.

Meanwhile the simulation has carried two unrelated "the floor throws you"
mechanics since M3.7, both reachable only through grey-box procedural Modules:

- **`launch-pad`** — a trigger box plus a velocity that is *set*, not added, on
  the rising edge of a Character's capsule centre entering it (Quake's
  `BG_TouchJumpPad` model: `VectorCopy`, never an add). Epoch-latched
  (`launchPadEpoch`), replicated, tested, and never re-armed until the
  Character leaves.
- **`bounce`** — a Surface with a restitution (0.85) and a minimum (6), so the
  bounce you get is proportional to the speed you landed with.

Nothing on the client reacts to either: `launchPadEpoch` is on the snapshot and
does not appear anywhere under `apps/client/src`. A launch today is a Character
silently leaving the ground.

Researched in `docs/research/spring-assets-launch-and-animation.md` (the GLBs
were parsed: **neither pack's springs carry an animation clip**, and the shared
GLB reader has no animation support — any spring animation is one we author).
Settled with the user (2026-09-15), two rounds:

- *"my netvoříme quaka, ale skákačku — horizontální rychlost bych úplně
  nezahazoval"*
- *"síla by se měla nastavovat v builderu"* — both presets and an exact number
- *"bounce ne, pouze launch pad"*
- knockdown on launch: *"spíš ne"*
- aiming: by tilting the Segment, no separate angle control

## Decision

**A Spring is a launch pad whose strength the Track author sets in metres, it
throws along its own up, it keeps your run, and the squash is a cosmetic the
renderer draws from state that is already replicated.**

### The physics

- **Vertical is SET, horizontal is ADDED.** A launch decomposes its world-space
  vector at the world Y axis: the vertical component replaces the Character's
  vertical velocity outright (so the apex is the same whether you walked on or
  fell on — Unreal's `bZOverride`), and any horizontal component is added to the
  Character's own. This replaces the current whole-vector `VectorCopy`, for
  every launch pad, not just Springs: one mechanic, one rule. This game is a
  platformer, not an arena shooter — a pad that deletes your run is a stop, not
  a boost.
- **A Spring's own vector is purely vertical in its Module frame.** `resolveTrack`
  already rotates a launch pad's velocity by the Segment's orientation and never
  translates it, so a Spring tilted with ADR 0034's pitch/roll throws you at an
  angle with no new authoring surface: **you aim a Spring by tilting it.** A
  tilted Spring therefore sets your vertical *and* shoves you sideways, which is
  exactly the read of its own pose.
- **A launch never knocks down.** The Character stays `Controlled`, as
  `triggerLaunchPad` already leaves it. No new state, no Impact.
- **Bounce is not what a Spring is.** `SURFACES.bounce` stays in the codebase as
  the model for a future trampoline deck; no Spring Asset is wired to it, and
  the `bounce` Module is not retired here.

### The authoring

- **Strength is an apex height in metres**, stored on the placed Segment:
  `Segment.launch?: { height: number }` — additive and optional exactly like
  `conveyor`/`motion`/`scale`, so every Track stored before this reads
  unchanged. The simulation converts once, at resolve time:
  `v = sqrt(2 · |GRAVITY_Y| · height)`. Height is what an author actually
  reasons about ("does this clear the gap"); speed is what the physics wants,
  and only one of the two should be typed by a human.
- **The builder offers both presets and an exact number** — `LOW` 3 m,
  `MEDIUM` 6 m, `HIGH` 10 m as one-click buttons over a stepper (1–20 m),
  the same preset-row-plus-stepper shape the inspector's SIZE control already
  uses. The presets write the same `height` field; there is no preset enum in
  the data. `MEDIUM` is today's procedural pad (`velocity.y = 16` ≈ 5.8 m).
- **Which Assets are Springs is decided by the converters, per stem**, on the
  Asset def (`AssetModuleDef.launch`), exactly as `hazard: "spiked"` (ADR 0061)
  and `gate` (ADR 0068) are — never at runtime from a name. A def carries the
  Asset's **default height** and its **trigger box**, derived from the measured
  footprint.
- **A Spring is its own Asset category** — `ASSET_CATEGORIES` gains `spring`,
  between `obstacle` and `gate`. A Spring filed under Platform is lost among
  400 platforms, and the category now means something the author can act on:
  like `gate`, it is a listing group whose members all carry a mechanic. The
  two directions are pinned as one invariant — every Spring is in the category,
  and nothing else is.
- **A placed Spring always launches** — there is no switch, and
  `Segment.launch` is an override of the def's default, not the thing that turns
  it on. A Spring that does nothing until someone finds a checkbox is a trap for
  the author (ADR 0068 settled the same point for finish signs).
- **Scale does not change the throw.** `segmentScale` already scales a pad's
  trigger box; the height stays the number the author typed. A bigger Spring is
  a bigger *target*, not a stronger one.

### The animation

- **Cosmetic, client-side, and never simulated.** The renderer squashes the
  Spring's own visual instance when it fires and releases it with an overshoot.
  The collision does not move, nothing new is replicated, and the simulation
  cannot tell the difference. This is the split id shipped in Quake: velocity is
  simulation, `EV_JUMP_PAD` is a *predictable event* the client draws from.
- **Driven by `launchPadEpoch`, per Segment.** The renderer animates when a
  Character's epoch *value* changes (never a boolean — a replayed prediction
  tick that re-produces the same epoch must be a no-op), and latches the
  animation on the **Segment**, so two Characters launching off one Spring in
  one tick is one squash, restarted rather than stacked. The local Character's
  squash fires at prediction time, a full round trip before the server confirms
  it; remote Characters' epochs arrive on the snapshot and take the same path.
- **`resolveTrack` gains `launchPadOwners: number[]`**, index-aligned with
  `launchPads` — which Segment each resolved pad came from, the same bookkeeping
  `staticOwners`/`trimeshOwners` already do for the gate floor probe. Derived on
  both sides from the Track; not a protocol change.
- **The whole instance squashes, about its foot** — `scale.y` down, `x/z` out,
  the classic squash-and-stretch. These Assets are one visual mesh each and sit
  on `y = 0`, so there is no coil to compress separately without a converter
  pass; that split is a known upgrade, not a blocker. Transform-only, so the
  shared geometry/materials of `buildAssetVisuals`' clones stay shared.
- **The launch happens on the trigger tick, never at the end of the squash.**
  The anticipation is drawn after the fact. Timings are provisional tuning (a
  measurement, not a decision): compress ≈66 ms to 0.55, release ≈180 ms to
  1.12, settle ≈120 ms.

## Consequences

- `ASSET_CATEGORIES` grows a fifth member, which every consumer iterates
  (the builder's Assets tab picks it up on its own — its category tabs scroll
  sideways since 2026-09-15 rather than dividing a fixed width).
- New shared surface: `Segment.launch`, `AssetModuleDef.launch`, its validator,
  `LAUNCH_*` tuning constants, `launchHeightToSpeed`, and
  `resolveTrack(...).launchPadOwners` (renderers only). No snapshot change: the
  Epoch this rides on has been replicated since M3.7.
- **The procedural `launch-pad` Module changes behaviour**: its authored
  `{ x: 0, y: 16, z: -6 }` now sets vertical and *adds* its forward shove to the
  runner's own speed instead of replacing it. Its seeded Tracks throw slightly
  further; re-tune the vector if that plays badly rather than reinstating the
  old whole-vector write.
- A Spring on a Moving Segment launches from where it rests: ADR 0061 resolves a
  moving Segment's triggers at the rest pose. The builder warns; publish does
  not refuse (unlike gates, ADR 0068 — a misleading Spring is a bad Track, not
  an unresolvable one). Making pad triggers follow their mover is a separate
  change.
- Horizontal add is uncapped. The common case (an untilted Spring) adds nothing,
  so this only bites a tilted Spring hit at speed — deliberately, since that is
  the trick shot.
- The builder's inspector grows a `LAUNCH` section, shown on Segments whose
  Asset def carries `launch`. It should draw the resolved launch vector and its
  apex in the viewport, the same "show exactly what the simulation will do"
  discipline ADR 0061 set for Motion.
- Every existing Track keeps playing: no Track has `Segment.launch`, and a
  Spring that was placed as scenery becomes a live Spring at its def's default
  height — which is the point.

## Alternatives rejected

- **Springs as bounce Surfaces.** Proportional output means the same Spring
  clears the gap or doesn't depending on how the runner arrived; a race Track
  wants an apex the author can place. (User: *"bounce ne, pouze launch pad"*.)
- **Quake's whole-vector `VectorCopy`.** Correct for an arena shooter where the
  pad *is* the movement; wrong for a platformer where the run into the Spring is
  the skill.
- **Strength fixed per Asset family in `tuning.ts`.** Predictable, and one less
  field — but it makes every Spring on every Track the same jump, and the user
  asked for the builder to set it.
- **A separate aim angle beside the height** (Conveyor's shape). More control,
  but the visual would lie: a Spring standing straight up while throwing
  sideways. Tilting the piece says what it does.
- **Playing an authored glTF clip.** No clip exists in either source pack, the
  shared reader has no animation support, and it buys the same feedback as a
  scale curve at many times the cost. Nothing here blocks it later.
- **Moving the plate for real** (a Motion, ADR 0061). A Motion is an endless
  function of the Tick — it would fire with nobody standing on it — and being
  hit by a mover goes through the Impact rule, whose outcomes are push /
  `Stagger` / `Ragdoll`, not a clean launch. A triggered mover would have to
  replicate its phase, which ADR 0061 explicitly rejected.
