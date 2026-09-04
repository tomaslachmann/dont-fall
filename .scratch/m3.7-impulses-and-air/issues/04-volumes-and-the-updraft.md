# 04 — Volumes, and the updraft

**What to build:** A region of air that lifts a Character inside it. Ride it up, drift out of the
side, land.

**Blocked by:** M3.6 ticket 07 (the rename that frees the word `Volume`). Independent of the Surface
work — a Volume is its own entity kind, not a Surface.

**Status:** done

- [x] A Module can carry Volumes as their **own entity kind**, never a collider wearing a special
      material. glTF, Unreal, Source and Quake all separate the two (ADR 0036)
- [x] Containment reuses the pipeline a Checkpoint's trigger already proves works, which has been
      correct for rotated and tilted Segments since ADR 0034 — not a second implementation
- [x] An updraft applies an upward force to a Character inside it. **No flight mode**: no new
      Character state, no new controls, no camera change. You are blown upward and you flail — which
      is the intended comedy, and which keeps the effect a pure function of position with nothing to
      replicate
- [x] Overlapping Volumes: exactly one wins by priority, never summed. Summing turns an authoring
      mistake into what looks like a physics bug
- [x] Every Volume carries a maximum induced speed — a wind Volume without one is an unbounded
      integrator
- [x] Manually verified live: ride an updraft up, drift out of the side of it, and land without being
      knocked down

## Implementation notes

`VolumeConfig` (new, `simulation/Volume.ts`): `bounds: OrientedBox`, `force: Vec3` (an acceleration,
authored in the Module's own local space and rotated — never translated — into world space by
`resolveTrack`, exactly like a launch pad's `velocity`), `maxInducedSpeed: number`, `priority: number`.
Deliberately not called `trigger` — CONTEXT.md's own avoid-list for `Volume` names `trigger` explicitly,
since a Volume never latches; it applies its force every tick a Character is inside and stops the
instant it isn't.

`Module.volumes?: VolumeConfig[]` (zero or more, same shape as `speedPads`/`launchPads`).
`Track.ts`'s `resolveTrack` collapses them the same way: `bounds` placed via `placeBox`, `force` rotated
via `rotateVec3ByQuat`.

`movementVerbs.ts`'s `applyVolumeForce(velocity, force, maxInducedSpeed)`: adds `force * TICK_DT`, then
clamps only the resulting component *along `force`'s own direction* to `maxInducedSpeed` — every other
component of `velocity` passes through untouched, so an updraft caps how fast it lifts a Character
without flattening whatever horizontal drift they walked in with. Unconditional and additive (unlike
`accelerateVelocity`'s friction-then-accelerate walk model) because a Volume competes with whatever else
is already acting on the Character (gravity, an in-flight Dash) rather than replacing it. A `force`
already at or beyond the cap contributes nothing further that tick — it never pulls the Character back
down; "never exceeded," not "clamped to exactly."

`CharacterController` gains `activeVolume: { force, maxInducedSpeed } | undefined` and
`setActiveVolume()`, set by `RapierSimulation` with the same one-tick lag `surfaceGrip`/`surfaceBounce`
already have (this tick's now-updated position decides the Volume that pushes *next* tick — exactly
mirroring the Surface pattern ADR 0036 established). Applied in `beginCapsuleTick` unconditionally, after
gravity/Sliding/Surface/Dash and even after a same-tick launch-pad SET — a Volume is a continuous force
competing for the velocity slot, not a one-shot effect overriding it. Reset on reconciliation for the
same reason `surfaceBounce` is: it is a pure function of position (ADR 0036), never replicated, so the
safest fallback after a correction is "not in one" until the very next real containment check.

`RapierSimulation` pre-sorts `volumes` highest-`priority`-first once at construction, so resolving
containment every tick is just "first match in the sorted array wins" — no per-tick max-scan, and
"exactly one wins, never summed" falls out for free from only ever reading the first match.

`modules.ts` gains a permanent `updraft` demo Module (same deliberately-identical-geometry-to-`bridge`
treatment as every other pad/Surface demo): `force: { y: 40 }` comfortably beats `GRAVITY_Y` (-22) for a
net lift, `maxInducedSpeed: 10`. `apps/track-builder/src/render.ts` gains `addVolume` (a wireframe box
plus a force-direction arrow, mirroring `addLaunchPad`'s own treatment) so a track designer can see a
Volume's region and pull direction, not just its floor.

### A genuine discovery, not a bug: ground-stick fights a weak Volume

While designing the priority-resolution test, a Volume with force 25 (net +3 over gravity) could never
lift a *grounded* Character at all, even though it clearly should win the priority contest. Traced
empirically: the ground-stick clamp resets `velocity.y` to `-GROUND_STICK_SPEED` (-2) every grounded
tick a Character isn't actively bouncing/launched, so a Volume needs to out-accelerate gravity *and* that
reset within a single tick to ever break contact — beating gravity alone isn't enough. This is a real,
intentional consequence of the ground-stick design (ADR 0037: "ground-stick as a distance"), not
specific to Volumes — a very weak, purely-vertical Volume simply cannot lift a standing Character off
the ground on its own, the same way it couldn't if the force were a hand-wave instead. The demo
`updraft` Module's own `force: 40` clears this threshold comfortably. The priority-resolution regression
test uses a correspondingly-tuned "weaker but still liftable" `outer` Volume (`force: 90`, cap `6`) so it
demonstrates priority handoff rather than an unrelated liftoff-threshold effect.

## Manual verification (real browser)

Verified live through the actual `apps/client` render/prediction/network pipeline (not track-builder's
own flat preview), per this session's "official" testing requirement — same pattern as tickets 01–03:

- Temporarily widened one throwaway Module (`verify-updraft`: a large floor plus an `updraft`-shaped
  Volume) in `packages/shared/src/track/modules.ts`, posted (then re-posted, republishing the same
  `trackId` as a new Revision after widening the floor) a one-segment Track using it to a locally-running
  track-service.
- Restarted the real match server against track-service's `/tracks/any` until it served that Track.
- Ran the real Vite dev server for `apps/client`, drove it with headless Chrome over raw CDP, and
  observed the real predicted `CharacterSnapshot` through two temporary debug hooks in `main.ts`
  (`window.__debugSim`/`__debugMyId` and a `window.__debugMoveOverride` input override), all removed
  before commit.
- With no input at all, the Character rose from the floor purely from the Volume's own force — no jump,
  no dash, `motionState` staying `Controlled` throughout (confirmed both in the raw snapshot log and
  visually: the HUD's own position readout climbed from y≈9 to y≈14 while the character kept its normal
  standing pose, floating — the intended "no flight mode" comedy).
- Drifting horizontally (`__debugMoveOverride`) carried it out from under the column; it then fell,
  landed (`grounded: true`), and settled back to `Controlled` — never once reaching `Ragdoll`.
- An earlier attempt at this same drift (before enlarging the temporary Module's floor) walked the
  Character clean off the small floor's edge while still very high and falling fast, triggering an
  unrelated kill-plane Fall/Respawn — a test-rig staging mistake (floor too small relative to how far the
  drift travelled), not a Volume bug; caught immediately by the trace log showing an out-of-bounds `x`
  position and a `ragdollCause` consistent with Fall, and fixed by enlarging the floor before re-running.
- Cleaned up afterward: the temporary Module, the temporary debug hooks, and all scratch/`_verify_*`/
  `_probe_*` scripts were removed (`grep -rln "__debug"` across `apps/client/src`, `apps/server/src`,
  `packages/shared/src`, `apps/track-builder/src` returns clean); the permanent `updraft` demo Module and
  its `addVolume` builder-render support were left in place. The leftover Track row in track-service's
  local (gitignored, not committed) SQLite data file was left in place, matching the many other stray
  scratch tracks already there from earlier sessions.

## Code review

Reviewed at **high** effort (CLAUDE.md's rule for intricate physics/netcode logic). No findings —
the implementation closely mirrors already-established patterns (`surfaceBounce`/`surfaceGrip`'s
one-tick lag, `pointInOrientedBox` from Checkpoint, `rotateVec3ByQuat` from launch pads), and the
reviewer specifically traced `replayLocalCharacter` to confirm `activeVolume` recomputes correctly on
every replayed prediction tick, not just live ticks.
