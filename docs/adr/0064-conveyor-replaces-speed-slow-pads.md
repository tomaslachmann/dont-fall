# 0064 — A Conveyor replaces the speed/slow pads: one directional belt attached to a Segment

## Context

M3.7 ticket 01 built the speed/slow pads as one mechanism with two faces
(`SpeedPadConfig.capMultiplier` above or below 1): a directionless one-shot
that fires as a Character's capsule centre enters its trigger — an instant
velocity write along the Character's *own* heading plus a fading `WALK_SPEED`
cap multiplier, Epoch-latched and replicated (`speedPadEpoch`/
`speedPadMsLeft`/`speedPadCapMultiplier` on the snapshot). The builder offered
them as two separate placeable Modules (`speed-pad`, `slow-pad`), visually
identical bridge platforms with invisible triggers.

Three things about that never sat right, and all three surfaced together:

1. Two Modules for one idea, distinguished only by a multiplier's sign — an
   author wanting "slow them down" reaches for a different block than "speed
   them up", when physically it is one belt running with or against you.
2. A one-shot with a fading cap is the wrong physics for a belt: stepping
   onto a walkway that runs against you should slow you *while you stand on
   it* and release you the instant you step off — no latch, no fade window,
   nothing to replicate.
3. The things being belted are the assets themselves. A pad Module is a
   block you place *next to* the interesting geometry; what an author means
   is "this asset carries whoever stands on it, that way."

Meanwhile ADR 0036 settled the machinery this needs: a floor's behaviour
rides its collider (`staticSurfaceByHandle`), resolved once per tick from
ground contact, and Surfaces compose (mud caps the target, ice removes grip)
without knowing about each other.

## Decision

**One Conveyor, attached to a Segment, pushing horizontally at a preset
speed — and the speed/slow pads are retired.**

- `Segment.conveyor?: { preset: "slow" | "medium" | "fast"; angle: number }`
  (CONTEXT.md: Conveyor). `angle` is a free yaw in the Segment's local frame
  (radians, 0 = module forward, toward the exit Socket); the speed presets
  (`CONVEYOR_SPEEDS`: slow 2, medium 4, fast 8 m/s against `WALK_SPEED` 6)
  are provisional tuning, "a measurement, not a decision" like `SURFACES`'
  own numbers. Fast deliberately beats a run, so a belt running against you
  can hold you still or push you back — the old slow pad, emerged rather
  than authored.
- `resolveTrack` bakes each Conveyor into a world-space horizontal velocity
  on every collider of its Segment (the local yaw rotated by the Segment's
  *own yaw only*, never its pitch/roll — the Spinner precedent: a belt has
  a compass direction on the map, and grounding resolves the slope). Boxes
  travel a `staticConveyors` array index-aligned with `statics` (the
  `staticSurfaces` precedent); trimeshes and MovingSegment parts carry it on
  the entry like `surface`/`hazard` already do.
- `RapierSimulation` resolves the ground collider's belt the way it resolves
  its Surface (`staticConveyorByHandle`) and pushes it into
  `CharacterController`, where it joins the wish velocity ADR 0035 already
  chases (`walk + dash + conveyor`) — so grip, slope scaling and the Sliding
  steer blend all apply to it for free, and stepping off ends it the same
  tick. Airborne reads zero (no ground collider, no belt). A Grab hold's
  tether wish replaces `walk` outright, so a held pair ignores belts — one
  documented edge, not a second code path.
- Nothing new is replicated; three snapshot fields are deleted
  (`speedPadEpoch`/`speedPadMsLeft`/`speedPadCapMultiplier`). A belt is a
  pure function of (position, Track) both sides already share — like ice,
  not like a pad firing. Client and server ship from this repo in one
  commit, so the wire-shape change needs no version gate.
- Legacy: `speed-pad`/`slow-pad` stay in `MODULE_LIBRARY` as deprecated
  geometry-only stubs (plain bridge platforms — what their statics always
  were), hidden from the builder palette by `DEPRECATED_MODULE_IDS`, and
  `resolveTrack` reports each Segment still referencing one in a new
  `warnings` array. Old Tracks load with a readable warning instead of
  throwing or silently inventing a belt direction their directionless
  triggers never had.
- The belt is visible: `resolveTrack` also returns per-Conveyor
  `{ velocity, deck }` entries (world-space flow + the Segment's
  footprint-frame box), and both the game scene and the builder viewport
  draw chevron strips on the deck pointing along the flow. Mud/ice stay
  invisible by design; a belt's whole point is a direction a player must
  read at a glance.

## Consequences

- Deleted: `SpeedPad.ts`, `SpeedPadController`/`speedPadCapMultiplier`,
  `triggerSpeedPad`/`pendingSpeedPadCapMultiplier`/
  `consumePendingSpeedPadBoost`/`updateSpeedPad`/`touchedSpeedPadIndex`,
  `Module.speedPads`, the `speedPads` half of `resolveTrack`'s output, and
  every test pinning the one-shot behaviour — replaced by Conveyor tests at
  the same seams.
- `CONTEXT.md` retires "Speed pad"/"Slow pad" (and the Epoch entry's pad
  example); "Launch pad" is untouched — a fixed-velocity SET is still a
  different mechanic from a standing belt.
- The API's publish validation (`isSegment`) accepts the new optional
  `conveyor` shape (known preset, finite angle) and 400s anything else — a
  Revision is immutable, so a malformed belt must fail at publish, not in
  a Match.
- The builder's Inspector gains a Conveyor panel (attach/detach, preset,
  angle stepper) on the selected Segment; the palette's "Pads & surfaces"
  group keeps its name (launch pad, Surfaces, updraft remain).
