# 0062 — A Segment scales uniformly, and its scale wraps everything it authors

## Context

Track authors want the converted pieces bigger or smaller than their files —
a wider floor, a taller pillar, a smaller saw — "simply" (user, 2026-09-15).
Until now a Segment was position + orientation only: every Module's geometry,
Sockets, Footprint, triggers and (ADR 0061) Motion sat at the file's own size.

## Decision

- **`Segment.scale?`: one positive number, default 1**, additive and optional like
  `pitch`/`roll`/`motion`. Uniform only — per-axis stretching would turn a
  round saw or pillar into an ellipse, and the user chose one number.
  Bounded to [`MIN_SEGMENT_SCALE`, `MAX_SEGMENT_SCALE`] (0.25–4), validated by the API.
- **Scale is the innermost part of the placement, and wraps the Motion too**:
  a rest-local point `p` is at `position + orientation·(scale · motion(p))`.
  Geometry (boxes, asset trimeshes), Footprint, Sockets, triggers, Prop and
  Spinner sizes and the Motion's pivots and offsets all scale together, so a
  Segment at 2× is exactly the same piece zoomed: a hammer swings the same
  angle, a sliding platform slides twice as far (and so twice as fast), and no
  pivot authored at 1× is ever left pointing at the wrong spot.
- **Not scaled**: launch-pad velocities and Volume forces (they are physics
  feel, not size), Footprint clearance (a gap in metres), angular speeds.
- **Baked, never a collider scale**: `resolveTrack` scales colliders' vertices
  and boxes when it places them, as it already rotates and translates them; a
  Moving Segment's body carries only the scaled translation of its Motion.
- **Chaining follows the scaled Sockets**, so a scaled piece still meets its
  neighbours; re-scaling a chained Segment re-places it at its entry and
  re-chains what follows.

## Consequences

- One placement helper per consumer that must agree: `resolveTrack` (server and
  client simulation), `placeAfter`, the builder's overlap/snap/rotate maths, the
  client's asset visuals, the builder's Segment groups. Each takes the scale.
- The builder's Motion panel and Impact tint multiply speeds by the scale.
