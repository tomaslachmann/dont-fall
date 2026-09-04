# 0037 — A `Sliding` state, two independent slope thresholds, and a speed-gated wall Impact

Nothing in this project has ever been tilted, so slopes have never been exercised. Three latent
problems surfaced when M3.6 was designed, all of them invisible until a ramp exists.

**Ground-stick is expressed as a speed, not a distance.** `GROUND_STICK_SPEED = 2` against
`WALK_SPEED = 6` caps descent at `atan(2/6) ≈ 18°`; mid-Dash, with total speed up to 21, it
collapses to about **5.4°**. Any ramp steeper than that makes the Character skip down it. Rapier's
own snap-to-ground and autostep are both disabled, with a documented rationale (edge stalling,
Dash hitching) that predates most of the current code.

**Rapier leaves no band between walking and falling.** Probing the installed
`@dimforge/rapier3d-compat@0.20.0` directly: `maxSlopeClimbAngle` and `minSlopeSlideAngle` are
**both 45°** by default, so there is no angle at which the Character slides — it walks anything up
to 45° with full control and treats anything steeper as an unclimbable wall.

**The wall Impact rule is gated on Dash, not on speed.** `DASH_WALL_MIN_SPEED_RATIO` /
`DASH_WALL_IMPACT_MAGNITUDE` only fire while dashing, so a Character launched into a wall by a
bounce pad or an updraft would hit it and feel nothing.

## Decision

- **A new Character state, `Sliding`**, entered and left by a *condition* — standing on a Surface
  steeper than the walkable limit — rather than by a timer. Reusing `Stagger` was rejected:
  `Stagger` means "recovering from a hit", is fixed at `STAGGER_MS = 350`, and reusing it would make
  a slope indistinguishable from a punch in state, animation and replication. `Sliding` applies only
  while grounded; flying over a steep face keeps full air control, because taking control away
  mid-air for a reason the player cannot see reads as a bug.
- **An Impact while `Sliding` goes straight to `Ragdoll`**, exactly as it does from `Stagger`.
- **Two independent angle thresholds with a band between them**: walkable → sliding → wall. A single
  threshold would make a 50° ramp a wall to collide with rather than a slope to slide down and swear
  at; the band is the entire point of tilted geometry. `WALL_NORMAL_MAX_Y` keeps defining "wall"
  and is deliberately *not* reused as the walkable limit.
- **The wall Impact rule is re-expressed as a speed threshold**, whatever the source of that speed —
  Dash, bounce, launch pad, updraft — and its magnitude scales with closing speed instead of being
  the constant `DASH_WALL_IMPACT_MAGNITUDE = 14`. Dash becomes one source of speed among several
  (ADR 0035). A second, parallel rule for "launched" states was rejected: two rules for the same
  event drift apart under tuning and neither can then be blamed.
- **Ground-stick becomes a distance.** This is a unit bug in this codebase, not a Rapier
  limitation. Whether Rapier's own snap-to-ground is then enabled is settled empirically by a spike
  rather than by argument: enable it on 0.20.0, measure whether the M1-era edge-stalling and
  Dash-hitching symptoms still reproduce, and fall back to the project's own distance-based
  ground-stick if they do. It is entirely possible that fixing the unit removes the need for
  Rapier's feature altogether.
- **Landing from height stays harmless.** No fall-damage rule exists today — knockdown comes from
  Impact magnitude — and none is added. `Fall` (leaving the play volume) remains the only
  height-related failure. Bounce pads and launch pads therefore create shortcuts by design; policing
  shortcuts is a matter of Round rules, which do not exist until M4.

## Consequences

- `CharacterMotionState` gains `Sliding` — an additive protocol change, replicated and snapped like
  every other discrete state (ADR 0013). It is the only new replicated state in M3.6; every other
  mechanic in that milestone is a pure function of position.
- Because `Sliding` is condition-held rather than timed, the client derives it from the same
  resolved Track data the server has, so prediction agrees without new messages.
- `Sliding` is also the one place where gravity is projected onto the slope plane and integrated —
  the model ADR 0035 rejects for *walking*. Two movement formulations now coexist, deliberately,
  split exactly on the walkable threshold.
- Rapier cannot be upgraded away from these defaults: `@dimforge/rapier3d-compat@0.20.0` is the
  latest published JS binding (the `rapier3d` **Rust** crate's much higher version numbers are a
  separate version line, and the JS bindings lag it). The thresholds must be set explicitly; there
  is no newer release to inherit better defaults from.
