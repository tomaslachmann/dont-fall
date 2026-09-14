# Block builder: uniform grid and snapping for parametric blocks

> Research note under `docs/research/`, parallel to `docs/adr/` (decisions) and
> `docs/milestones/` (specs). Synthesizes four prior findings: editor pipeline
> (snapping tiers, free placement), physics/data model (slope, step, stacking
> limits), persistence/wire format (Segment shape, validation, storage), and
> snapping/grid precedents (proposal + ADR 0030/0031/0034). This note is not a
> decision record; if adopted, capture it as an ADR the normal way.
>
> Adopted as ADR 0055; implementation tracked in
> `.scratch/block-builder/issues/` (01–05 phase 1: cuboid + wedge; 06–08
> phase 2: arc). Open questions 1, 2, 4, 5 resolved per author feedback
> (recorded inline); 3 and 6 deferred to tickets 07 and 08.

## 1. Problem and goal

Block builder needs parametric blocks (cuboid, wedge, arc) placed on one
uniform grid with typed snap points. Goal: no arbitrary heights, no free-float
gaps, every placed block reproducible from quantized parameters.

Constraints driving the design:

- Walkable slope is `WALKABLE_SLOPE_MAX_ANGLE = 35°`
  (`packages/shared/src/tuning.ts:394`); derived normal threshold
  `WALKABLE_NORMAL_MIN_Y = cos(...)`
  (`packages/shared/src/simulation/CharacterController.ts:42`).
- Steep transition is `grounded && normal.y < WALKABLE_NORMAL_MIN_Y`
  (`packages/shared/src/simulation/CharacterController.ts:684-686`); steering
  in Sliding is scaled by `SLIDE_INPUT_SCALE 0.3`
  (`packages/shared/src/tuning.ts:257`) with blend `SLIDE_STEER_BLEND 0.15`
  (`packages/shared/src/tuning.ts:268`).
- Wall boundary is `WALL_NORMAL_MAX_Y = 0.5` (`packages/shared/src/tuning.ts:364`),
  separate from ground-lookup threshold `SURFACE_GROUND_NORMAL_MIN_Y = 0.5`
  (`packages/shared/src/tuning.ts:376`); Rapier collapses climb/slide to one
  wall angle `wallAngle = acos(WALL_NORMAL_MAX_Y)` (= 60°)
  (`packages/shared/src/simulation/CharacterController.ts:391-393`), with the
  finer walkable-vs-sliding split owned by the state machine, not Rapier
  (`packages/shared/src/simulation/CharacterController.ts:380-390`).
  Consequence: <= 35° walks, 35-60° slides, >= 60° is wall (blocked).
- Downhill speed is `slopeSpeedMultiplier = 1 - SLOPE_SPEED_ANGLE_FACTOR*angle`
  with `SLOPE_SPEED_ANGLE_FACTOR 0.4`, floor `SLOPE_SPEED_MULTIPLIER_MIN 0.1`
  (`packages/shared/src/tuning.ts:408,415`).
- Autostep stays OFF, snap-to-ground ON with `GROUND_SNAP_DISTANCE 0.5`
  (`packages/shared/src/simulation/CharacterController.ts:372-379`), where
  `GROUND_SNAP_DISTANCE = 0.5` covers ~40° slopes at Dash and stays below the
  smallest kill-plane drop 7.5 (`packages/shared/src/tuning.ts:83`); stick
  speed `GROUND_STICK_SPEED 2` is controller non-zero solution, not slope glue
  (`packages/shared/src/tuning.ts:68`).
- Wire `Segment` is `{ moduleId, position, rotation, pitch?, roll?,
  manuallyPlaced? }`, `Track = Segment[]`
  (`packages/shared/src/track/Track.ts:34-44`); `manuallyPlaced` is a
  builder-only authoring flag never read by `resolveTrack`/server
  (`packages/shared/src/track/Track.ts:25-32`); no `params` field exists today
  (grep over `shared/track/` + `track-service/` is empty).
- Server shape check `isSegment` requires string `moduleId`, finite x/y/z
  `position` via `isVec3`, finite `rotation`, optional-finite `pitch`/`roll`
  (`apps/track-service/src/index.ts:191-201`, `apps/track-service/src/index.ts:173-177`,
  `apps/track-service/src/index.ts:170-171,199`); `isTrack = Array.every`
  (`apps/track-service/src/index.ts:203`); strictness rationale is Revision
  immutability (`apps/track-service/src/index.ts:180-190`).
- `POST /tracks` pipeline is `isTrack` -> 400, `unknownModuleIds` -> 400,
  limit checks -> 400, then `saveTrack`
  (`apps/track-service/src/index.ts:427-469`); `body.id` republishes as a new
  Revision, never mutates (`apps/track-service/src/index.ts:454-455`).
- `unknownModuleIds` uses `Object.hasOwn`, not `in`
  (`apps/track-service/src/validate.ts:17-28`); limits are rejected, not
  clamped, because Revisions are immutable
  (`apps/track-service/src/validate.ts:36-38,54-56`); limit rules are
  integer + MIN/MAX range (`apps/track-service/src/validate.ts:40-49,62-71`).
- Storage table `tracks` has PK `(track_id, revision)` with columns `track_id,
  revision, name, author_id, content_hash, data (JSON Segment[]), created_at,
  time_limit_ms, survivor_target`
  (`apps/track-service/src/schema.ts:12-41`); `data` stays `Segment[]` while
  `timeLimitMs`/`survivorTarget` are per-`(track_id,revision)` row attributes
  (`apps/track-service/src/schema.ts:20-36`); DDL lives in
  (`apps/track-service/src/db.ts:42-55`) with WAL mode (`apps/track-service/src/db.ts:18`).

## 2. State today

### Snapping tiers (track-builder editor)

- Keyboard constants `MOVE_STEP = 0.5`, `MOVE_STEP_FINE = 0.1`,
  `ROTATE_STEP = 15°`, `ROTATE_STEP_FINE = 5°`
  (`apps/track-builder/src/trackEdit.ts:187-190`); comment states `MOVE_STEP`
  has no gizmo equivalent and gizmo default is socket-snap, not grid
  (`apps/track-builder/src/trackEdit.ts:179-186`).
- Gizmo tiers in `applySnapTiers()`: `translationSnap = Shift ?
  MOVE_STEP_FINE : null`, `rotationSnap = Shift ? ROTATE_STEP_FINE :
  ROTATE_STEP` (`apps/track-builder/src/viewport.ts:208-216`); rotation goes
  through TransformControls natively, position defaults to custom socket-snap
  (`apps/track-builder/src/viewport.ts:208-215`).
- Socket snap radius `SOCKET_SNAP_RADIUS = 1.5`
  (`apps/track-builder/src/trackEdit.ts:316`); `snapPositionToNeighborSocket`
  tries only entry -> predecessor exit and exit -> successor entry, else no-op
  (`apps/track-builder/src/trackEdit.ts:335-371`); live override runs on each
  `objectChange` only for translate + `!shiftHeld` + single-select
  (`apps/track-builder/src/viewport.ts:302-312`); rotation is never touched
  (`apps/track-builder/src/viewport.ts:295-301`); spec covers in-radius snap,
  3x-radius no-snap, index-0 successor snap, neighborless no-op, pure-Vec3
  return (`apps/track-builder/src/trackEdit.test.ts:398-449`).
- Shift handling via window keydown/keyup toggling `shiftHeld` +
  `applySnapTiers` (`apps/track-builder/src/viewport.ts:219-230`); keyboard
  nudge/rotate uses fine tier under Shift (`apps/track-builder/src/main.ts:382,390`);
  Shift+click is multi-select toggle, not snap (`apps/track-builder/src/main.ts:313,161-167`).

### Free placement + `manuallyPlaced`

- `Segment.manuallyPlaced` is a builder authoring mark; `resolveTrack` /
  simulation never read it; it lives on Segment to survive
  insert/delete/undo (`packages/shared/src/track/Track.ts:25-41`).
- Set by `rotateSegment`, `moveSegment`, `setSegmentTransform` /
  `SetTransforms` (`apps/track-builder/src/trackEdit.ts:211-212,243`,
  `apps/track-builder/src/trackEdit.ts:268-271`,
  `apps/track-builder/src/trackEdit.ts:284-313`).
- `rechainFrom` respects it (chainable = prev + modules exist and both ends
  auto; exact predicate per prior finding).

### Precedents: proposal + ADR chain

- Proposal defines a combined placement model (no "grid OR socket OR free"):
  one piece may carry grid + surface + sockets + free + rotation
  simultaneously, with `GridConstraint{snapX,snapY,snapZ,step}` and
  `RotationConstraint{allowedYawDegrees,allowPitch,allowRoll}`
  (`docs/track-builder-proposal.md:250-275`); footprint is a build contract
  (`occupiedCells` + clearance) independent of visual/collider
  (`docs/track-builder-proposal.md:277-290`); sockets need a full local frame
  (position + rotation) or ramp orientation is unknowable
  (`docs/track-builder-proposal.md:292-317`); snap pipeline is raycast
  candidate -> sockets in radius -> type/accepts/direction filter -> frame
  align -> grid/rotation constraint -> footprint/bounds -> green/red ghost
  with reason (`docs/track-builder-proposal.md:319-331`); free mode is the
  exception with a fine step, not the default (`docs/track-builder-proposal.md:331`).
- ADR 0030 (start): uniform fixed-width footprint for all modules, strictly
  linear track, no compatibility metadata; randomizer = ordered list only
  (`docs/adr/0030-modules-have-a-uniform-footprint-tracks-are-linear.md:1-12`).
- ADR 0031: every module owns sockets (min entry + exit, position + rotation),
  footprint (bounds + clearance), typed sockets but M3-v2 ships only `"floor"`;
  real rotation; builder insert/move/rotate/delete/duplicate via
  command-pattern undo/redo
  (`docs/adr/0031-modules-gain-sockets-footprint-placement-rules.md:15-30`);
  `MODULE_STEP` removed, `chainTrack` walks socket-to-socket
  (`docs/adr/0031-modules-gain-sockets-footprint-placement-rules.md:34-44`).
- ADR 0034 (= current target, M3.5): segment positions free on all axes,
  default snap to nearest compatible socket (Trackmania-style), Shift = finer
  0.1-unit grid, never full free float
  (`docs/adr/0034-track-builder-free-placement.md:14-21`); rotation full 3D
  yaw + pitch + roll stored in degrees, quaternions internally, default 15°
  snap, Shift 5°, never continuous
  (`docs/adr/0034-track-builder-free-placement.md:22-27`).

## 3. Proposal

### 3.1 Grid module: coarse horizontal, fine vertical, quantized everything

- Fix two base units: `GRID_XZ = 0.5` horizontal, `GRID_Y = 0.25` vertical.
  The horizontal unit reuses the existing coarse keyboard step
  (`apps/track-builder/src/trackEdit.ts:187-190`), equals
  `GROUND_SNAP_DISTANCE 0.5` (`packages/shared/src/tuning.ts:83`), and
  divides the socket radius `SOCKET_SNAP_RADIUS = 1.5`
  (`apps/track-builder/src/trackEdit.ts:316`) exactly (3 cells). The vertical
  unit is one half-cell: still an exact divisor of 0.5 and 1.5, so horizontal
  and vertical snapping never disagree, but fine enough for platform heights
  and wall thicknesses (author feedback: 0.5 vertical is too coarse).
- Every block dimension MUST be an integer multiple of its axis unit
  (length/width/radius/thickness of `GRID_XZ`, height of `GRID_Y`). No
  fractional heights. The two units generalize the proposal's
  `GridConstraint{snapX,snapY,snapZ,step}`
  (`docs/track-builder-proposal.md:250-275`) from per-piece config to a
  global invariant; per-piece constraints remain only for allowed rotation
  (`RotationConstraint`, same ref).
- Stacking height is therefore always `k * 0.25` — purely additive, no
  special rule (see open question 2, now resolved). Combined with autostep
  OFF (`packages/shared/src/simulation/CharacterController.ts:372-379`,
  OFF because it hitches during Dash), NO vertical ledge of any height is
  walkable by walking into it — every step-up needs a jump or a wedge ramp
  (<= 35° leg); a vertical face (>= 60°) is a wall by the `wallAngle` rule
  (`packages/shared/src/simulation/CharacterController.ts:391-393`). A finer
  vertical grid creates no new hitch risk: the hitch question does not depend
  on ledge height at all.
- Jump reachability bounds which stacked heights make sense, not which are
  legal: `JUMP_VELOCITY = 10` against `GRAVITY_Y = -22` with
  `JUMP_HOLD_MAX_MS = 260` at half gravity
  (`packages/shared/src/tuning.ts:36,153-159`). The exact max jump height is
  a measurement task for implementation (builder warning thresholds must come
  from the measured number, not from `v²/2g` arithmetic) — any step-up above
  it without a ramp is warn-worthy, never silently fine.
- Keep `MOVE_STEP_FINE = 0.1` exclusively as the Shift-override fine tier
  (`apps/track-builder/src/viewport.ts:208-216`,
  `apps/track-builder/src/main.ts:382,390`); fine placement sets
  `manuallyPlaced` (`packages/shared/src/track/Track.ts:25-41`,
  `apps/track-builder/src/trackEdit.ts:284-313`) and is therefore always
  detectable downstream.

### 3.2 Snap-point typology: face / edge / corner + stacking

- Each parametric block exposes three snap families:
  - **face**: center of each cuboid face; top face doubles as the stacking
    receiver. Generalizes ADR 0031 sockets (min entry + exit with
    position + rotation)
    (`docs/adr/0031-modules-gain-sockets-footprint-placement-rules.md:15-30`)
    from track-flow sockets to block-assembly sockets.
  - **edge**: midpoint of each of the 12 cuboid edges (wedge: exposed
    non-slope edges; arc: inner/outer rim midpoints). Used for flush
    side-by-side alignment.
  - **corner**: 8 cuboid corners (wedge: 6 vertices; arc: rim quadrant
    endpoints). Used for precise corner-to-corner joins.
- **Stacking** is `top-face -> bottom-face` socket-to-socket, reusing the
  `chainTrack` socket-to-socket precedent
  (`docs/adr/0031-modules-gain-sockets-footprint-placement-rules.md:34-44`)
  and requiring a full local frame per socket per the proposal
  (`docs/track-builder-proposal.md:292-317`). Stacked height stays on-grid by
  section 3.1.
- Snap priority (first match wins): stacking face > entry/exit flow sockets
  (existing `snapPositionToNeighborSocket` predecessor/successor logic at
  `apps/track-builder/src/trackEdit.ts:335-371`) > edge > corner > grid
  fallback. Radius stays `SOCKET_SNAP_RADIUS = 1.5`
  (`apps/track-builder/src/trackEdit.ts:316`); ghost accept/reject with reason
  follows the proposal pipeline (`docs/track-builder-proposal.md:319-331`).
- Footprint + clearance remain the placement contract independent of
  visual/collider (`docs/track-builder-proposal.md:277-290`); stacked blocks
  add their heights to the occupied column.

### 3.3 Parametric `Segment` schema: additive, no migration

- Extend, do not replace. Today's `Segment` shape
  (`packages/shared/src/track/Track.ts:34-44`) gains one optional field:
  `params?: BlockParams`, where `BlockParams = { kind: "cuboid" | "wedge" |
  "arc"; lengthGrid, widthGrid, heightGrid: int; slopeAxis?: "x" | "z";
  radiusGrid?: int; angleDeg?: number; thicknessGrid?: int }` (all grid-count
  ints except `angleDeg`; horizontal counts are `GRID_XZ` units, `heightGrid`
  counts `GRID_Y` units per section 3.1). Old segments without `params` keep
  validating and loading untouched.
- Persistence-safe: `data` column stays JSON `Segment[]`
  (`apps/track-service/src/schema.ts:12-41`,
  `apps/track-service/src/schema.ts:20-36`); per-`(track_id,revision)`
  immutability means the extended shape only appears in new Revisions
  (`apps/track-service/src/index.ts:454-455`,
  `apps/track-service/src/index.ts:180-190`); server validation extends
  `isSegment` (`apps/track-service/src/index.ts:191-201`) with an optional
  `params` branch, mirroring the optional-finite `pitch`/`roll` pattern
  (`apps/track-service/src/index.ts:170-171,199`), and unknown-param rejection
  mirrors `unknownModuleIds` with `Object.hasOwn`
  (`apps/track-service/src/validate.ts:17-28`), rejected-not-clamped per
  (`apps/track-service/src/validate.ts:36-38,54-56`).

### 3.4 Arc tessellation and wedge generation in `shared`

- Single source of truth: `packages/shared` owns
  `buildBlockGeometry(params) -> { vertices, indices }` (and the matching
  Rapier trimesh collider descriptor). Builder preview, game collider, and
  server-side validation all call it; no per-app reimplementation.
- **Wedge**: derive analytically from its cuboid envelope
  (`lengthGrid*GRID_XZ x heightGrid*GRID_Y x widthGrid*GRID_XZ`): high edge at
  full height, low edge at zero, slope face between. Emit slope angle from
  `atan(height/length)`; quantized inputs keep the angle reproducible.
  Walkable iff slope <= 35° (`packages/shared/src/tuning.ts:394`).
- **Arc**: tessellate by angle step `<= 15°` (reuses `ROTATE_STEP`
  (`apps/track-builder/src/trackEdit.ts:187-190`)), chord count
  `n = ceil(angleDeg / 15)`, chord error bounded by
  `r*(1-cos(step/2))`. Radius and thickness are grid multiples (section 3.1);
  emit inner/outer wall quads + top/bottom ring sectors as one indexed mesh.
  Rim snap points fall on quadrant boundaries so tessellation never moves a
  snap target.

### 3.5 Snap tiers for new parameters

- Dimension entry: coarse step 1 cell on its axis (0.5 horizontal for
  length/width/radius/thickness, 0.25 vertical for height), Shift-fine 0.1
  WITHOUT quantization commit; uncommitted fine values keep `manuallyPlaced`
  set (`packages/shared/src/track/Track.ts:25-41`) until snapped back
  on-grid. Mirrors the existing translation tier split
  (`apps/track-builder/src/viewport.ts:208-216`).
- Angle entry (wedge orientation, arc sweep): 15° default, 5° under Shift,
  mirroring `ROTATE_STEP` / `ROTATE_STEP_FINE`
  (`apps/track-builder/src/trackEdit.ts:187-190`,
  `apps/track-builder/src/viewport.ts:208-216`,
  `docs/adr/0034-track-builder-free-placement.md:22-27`); never continuous.
- Position during drag: socket/snap-point radius 1.5 first
  (`apps/track-builder/src/trackEdit.ts:316`,
  `apps/track-builder/src/trackEdit.ts:335-371`), grid fallback at 0.5,
  Shift 0.1 override with live `objectChange` gating (translate +
  `!shiftHeld` + single-select, rotation untouched) per
  (`apps/track-builder/src/viewport.ts:302-312`,
  `apps/track-builder/src/viewport.ts:295-301`); free mode stays the
  exception, not the default (`docs/track-builder-proposal.md:331`).

### 3.6 Validation rules (client + server)

- Shape: finite numbers, `moduleId` string, finite `position`/`rotation`,
  optional-finite `pitch`/`roll` as today
  (`apps/track-service/src/index.ts:191-201`,
  `apps/track-service/src/index.ts:173-177`); `params`, when present, must
  have known `kind`, positive integer grid counts, `angleDeg` finite in
  (0, 360], `radiusGrid >= thicknessGrid > 0` for arcs.
- Quantization: every grid-count field is an integer; server rejects
  non-multiples (reject-not-clamp, per
  `apps/track-service/src/validate.ts:36-38,54-56`); integer + MIN/MAX range
  style per (`apps/track-service/src/validate.ts:40-49,62-71`).
- Physics plausibility (warn in builder, reject or flag server-side per
  policy): wedge slope > 35° is slide territory (state-machine rule at
  `packages/shared/src/simulation/CharacterController.ts:684-686` with
  `SLIDE_INPUT_SCALE 0.3` at `packages/shared/src/tuning.ts:257`); slope >=
  60° is wall (`packages/shared/src/simulation/CharacterController.ts:391-393`,
  `packages/shared/src/tuning.ts:364`); downhill speed floor 0.1
  (`packages/shared/src/tuning.ts:408,415`); stacked columns taller than the
  kill-plane margin 7.5 (`packages/shared/src/tuning.ts:83`) need explicit
  authoring confirmation.
- Compatibility: unknown `kind`/field rejected via `Object.hasOwn` style
  (`apps/track-service/src/validate.ts:17-28`); `POST /tracks` order
  (shape -> module/param check -> limits -> save) unchanged
  (`apps/track-service/src/index.ts:427-469`).

## 4. Phasing

### Phase 1 — cuboid + wedge (no tessellation risk)

1. Add `GRID = 0.5` constant + `quantize(n)` helper in `packages/shared`;
   unit-test integer-multiple rule.
2. Add optional `BlockParams` (`cuboid` | `wedge` only) to `Segment`
   (`packages/shared/src/track/Track.ts:34-44`); keep `manuallyPlaced`
   semantics (`packages/shared/src/track/Track.ts:25-41`).
3. Implement `buildBlockGeometry` wedge branch in `shared` (analytic, no
   tessellation); wire builder preview + game Rapier collider to it.
4. Expose face (incl. stacking) + edge + corner snap points for cuboid/wedge;
   priority stacking > flow sockets
   (`apps/track-builder/src/trackEdit.ts:335-371`) > edge > corner > grid;
   keep radius 1.5 (`apps/track-builder/src/trackEdit.ts:316`) and ghost
   reason (`docs/track-builder-proposal.md:319-331`).
5. Add dimension tiers (1 cell / Shift 0.1 uncommitted) reusing `applySnapTiers`
   (`apps/track-builder/src/viewport.ts:208-216`) and Shift plumbing
   (`apps/track-builder/src/viewport.ts:219-230`,
   `apps/track-builder/src/main.ts:382,390`); extend `isSegment` + server
   param checks (`apps/track-service/src/index.ts:191-201`,
   `apps/track-service/src/validate.ts:17-28`) reject-not-clamp
   (`apps/track-service/src/validate.ts:36-38,54-56`).
6. Ship builder warnings for slide/wall slopes (35°/60° rules at
   `packages/shared/src/tuning.ts:394`, `packages/shared/src/tuning.ts:364`,
   `packages/shared/src/simulation/CharacterController.ts:684-686`).

### Phase 2 — arc (tessellation + rims)

1. Add `arc` to `BlockParams` (`radiusGrid`, `angleDeg`, `thicknessGrid`).
2. Implement `shared` tessellation (`n = ceil(angle/15)`, quadrant rim
   snaps); verify chord error bound and snap-point stability.
3. Add angle tier 15°/5° Shift
   (`apps/track-builder/src/trackEdit.ts:187-190`,
   `docs/adr/0034-track-builder-free-placement.md:22-27`).
4. Extend footprint/clearance to swept-arc bounds
   (`docs/track-builder-proposal.md:277-290`); validate stacked arcs against
   the 7.5 kill-plane margin (`packages/shared/src/tuning.ts:83`).
5. Load-test trimesh collider count; fall back to convex decomposition only
   if measured hitch appears (no speculative physics split).

## 5. Open questions

1. ~~Single 0.5 vertical step vs. finer module~~ — RESOLVED (author
   feedback): split grid, `GRID_XZ = 0.5` / `GRID_Y = 0.25` per section 3.1.
2. ~~Stacking clearance rule~~ — RESOLVED (author feedback: stacking is purely
   additive). A block stacked on another is just face-to-face contact in world
   space: heights sum (`k * 0.25`, always on-grid), and the existing
   world-space overlap test passes it naturally as long as faces *touch* but
   volumes don't interpenetrate (contact tolerance, not zero). No inherited
   footprint, no column check — each block keeps its own footprint evaluated
   in world space. The only stacking-specific work is the top-face snap
   receiver (section 3.2) and the "above max jump height without a ramp"
   warning (section 3.1).
3. Arc collider: single Rapier trimesh from `shared` output vs. convex
   pieces — decide by measurement, since Rapier currently collapses to one
   wall angle (`packages/shared/src/simulation/CharacterController.ts:391-393`).
4. ~~`pitch`/`roll` vs. wedge `slopeAxis`~~ — DECIDED (author feedback:
   keep both). Composition is free: `params` geometry (including the wedge
   slope) is baked in the block's local frame, then the existing Segment
   orientation (`segmentOrientation` quaternion from yaw/pitch/roll,
   `packages/shared/src/track/Track.ts:103-105`) applies on top — the same
   "bake, then orient" split ADR 0050 uses for asset node transforms. Tilt
   never de-quantizes `params` (orientation is not geometry), but it can push
   the effective slope into slide/wall territory or break face-contact
   stacking — both already covered by the section 3.6 warnings, no new
   machinery.
5. ~~Server strictness for `params`~~ — DECIDED (author feedback: it should
   warn): two layers, matching the existing ghost pattern (live aid, not
   save-blocking, per `docs/track-builder-proposal.md:319-331`). The builder
   warns live (red ghost + reason, authoring never blocked); the server
   rejects at publish with a readable reason (existing `POST /tracks` 400
   order at `apps/track-service/src/index.ts:427-469`, reject-not-clamp per
   `apps/track-service/src/validate.ts:36-38,54-56`). Same split applies to
   slope warnings (slide/wall territory): warn in the builder, never silently
   fine, never hard-blocked mid-authoring.
6. Ghost UX for the enlarged snap set (face/edge/corner/stacking): extend the
   green/red + reason pattern (`docs/track-builder-proposal.md:319-331`) or
   does priority-order auto-pick suffice without per-type coloring?
