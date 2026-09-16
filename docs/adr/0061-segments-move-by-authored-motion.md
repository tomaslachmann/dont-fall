# 0061 — Segments move by an authored Motion: a pure function of the Tick, ridden and pushed through the existing Impact rule

## Context

The converted asset packs (KayKit, the ImageToStl trap pack) brought hammers,
saw discs, pendulum balls, spiked plates and rotating drums — shapes that only
make sense moving. The engine has exactly one moving piece of Track: the M1
Spinner, a Module-level bar spinning about world Y, whose pose is a pure
function of the Tick (`spinnerAngleAt`) and so is never replicated. Nothing
else moves: asset collision is baked into static world trimeshes (ADR 0050:
"trimesh colliders must be static … articulated asset parts are out of scope
until a dynamic representation is designed"), a Character standing on a moving
body is not carried, and a body moving *into* a standing Character is only
noticed if the Character's own movement sweep happens to meet it.

Settled with the user (2026-09-14): any placed piece may move — platforms and
Obstacles alike; the motion set is derived from the pieces we actually have and
must stay extensible; constant speed and eased back-and-forth timing both;
riding and being hit both land in the first version; knockdown follows the
existing Impact thresholds, except spiked pieces, which always knock down.

## Decision

- **Motion is a property of the Segment, not the Module.** `Segment.motion?`
  is additive and optional (like ADR 0034's `pitch`/`roll`): the same Asset is
  a still platform in one Track and a sliding one in the next, and every Track
  stored before this reads unchanged.
- **Three kinds, composed in a fixed order.** A Motion carries at most one of
  each, applied `spin → swing → slide`, each in the Segment's local frame:
  - **Spin** — endless rotation about a local axis through a local pivot, at a
    constant signed speed (saw discs, drums, carousels).
  - **Swing** — rotation back and forth through ±amplitude about a local axis
    through a local pivot (hammers, pendulums, seesaws).
  - **Slide** — translation back and forth between rest and a local offset
    (moving platforms, crushers, spiked plates).
  Swing and Slide carry a period, an easing preset (`linear`, `easeIn`,
  `easeOut`, `easeInOut`), a pause at each end and a phase offset; Spin carries
  a start angle. The fixed order means no ordering UI and no ambiguity (a saw
  that spins while sliding on a rail is `spin` + `slide`). A new kind is a new
  optional field, never a change to these three.
- **Pose is a pure function of the Tick** (`motionPose(motion, tick)`), in
  `packages/shared`, exactly like `spinnerAngleAt`. The server, a predicting
  client and the Track builder's preview all call the same function, so nothing
  about a Motion is replicated beyond the Track itself, and the builder shows
  exactly what the simulation will do.
- **A moving Segment is one kinematic body.** `resolveTrack` routes a moving
  Segment's colliders (boxes or asset trimeshes) onto a kinematic
  position-based body posed each tick, instead of into the static world. This
  amends ADR 0050: trimeshes may sit on kinematic bodies. Triggers the Segment
  authors (Checkpoint, pads, Finish Zone, Volumes) and its Props stay at the
  rest pose in this version.
- **Riding.** A Character grounded on a moving Segment is carried by that
  body's full rigid displacement at its position (a carousel carries it round
  its pivot), swept against everything *except* that body, on top of its own
  movement. Facing is not turned: it is the Player's input (ADR 0045), and
  turning the camera with a carousel is presentation. When it leaves that
  ground (jump, walk-off, knock) it keeps the body's velocity: the vertical
  part once, into its own velocity under gravity; the horizontal part as a
  carry of its own until it lands, since air control would otherwise erase it
  within a tick. Rapier's character controller has a built-in carry of its own
  for kinematic bodies ("kinematic friction"), but it only acts on ticks its
  sweep happens to register the contact — measured carrying a rider off the
  end of a sliding platform within one period, and double-carrying on top of
  a Ride. So a Moving Segment's body is held `Fixed` while the Characters
  sweep and turned back to kinematic for the step: the Ride is the one
  authority, and Props and ragdolls still get the body's velocity in the step.
- **Being hit is the existing Impact rule, not a new one.** When a moving
  Segment moves into a Character, the Character is pushed out along the
  contact normal, and the *closing speed* — the body's velocity at the contact
  point along the normal, net of the Character's own — feeds the same
  `IMPACT_STAGGER_MIN` / `IMPACT_RAGDOLL_MIN` pipeline as a wall crash or a
  Bump. Slow bodies push, faster ones stagger, fast ones knock down; a saw's
  rim hits harder than its hub. There is no "is this an Obstacle" branch —
  the rule cares how fast, never what (the same principle as ADR 0037's wall
  Impact).
  *Amended by ADR 0065:* a grounded Character pressed from above is pushed
  sideways (or along the body's sweep) rather than into the floor, and the
  closing speed is measured along that push; a moving Asset collides as solid
  parts, not its hollow trimesh.
- **Spiked is the one exception, and it is a property of the Asset.** An
  Asset def may carry `hazard: "spiked"`; any Character contact with a spiked
  collider — standing on it, walking into it, or being moved into — is an
  Impact at `IMPACT_RAGDOLL_MIN`, still or moving. The converters assign it per
  stem like Asset category, never at runtime from a name.
- **The builder plays Motion live and shows what it would do.** The viewport
  animates every moving Segment from the shared pose function (play, pause,
  scrub) and tints each moving surface by the Impact a Character would take
  there at that moment — carries/pushes, staggers, knocks down — with spiked
  surfaces always marked as knockdown.

## Consequences

- The Track Revision format gains `motion`; the API validates it (finite
  numbers, known easing presets, positive periods, unit-ish axes).
- The per-tick step gains two phases: a Ride is computed at the start of the
  tick from the pure pose (so a reconcile's jump in the Tick cannot leave it
  stale) and applied as a second sweep; push contacts are found after the step
  and applied in the next tick's sweep — one tick of lag, identical on server
  and predicting client, since both run the step.
- A Character riding a platform mispredicts only when the platform's pose
  does — which it never does, being a pure function of the synced Tick. The
  momentum kept after leaving a ride is not replicated, so a correction that
  lands mid-air right after a jump off a moving platform can mispredict for
  the rest of that jump; accepted until it shows up in play.
- The M1 Spinner becomes a second way to spin with a second knockback rule.
  Folding it into Motion (and retiring `spinnerKnockback`) is a follow-up
  ticket in this milestone, not left to drift.

## Alternatives rejected

- **Motion on the Module.** Every moving variant would need its own Module and
  Asset file, and a Track author could not make an existing piece move.
- **Keyframe tracks / a curve editor.** The most expressive, and a large UI
  for a first version; the three kinds cover every piece in the current packs,
  and a keyframed kind can be added later as a fourth optional field.
- **Replicating mover poses in snapshots.** Unnecessary bandwidth and a
  correction path for something every side can compute exactly.
- **"Obstacle category always knocks down."** Category is a listing property
  (Asset category) and must stay one; a slowly sliding Obstacle that ragdolls
  on a brush is not fun, and a spiked plate that merely pushes is wrong. Speed
  plus an explicit `spiked` hazard says what actually happens.
