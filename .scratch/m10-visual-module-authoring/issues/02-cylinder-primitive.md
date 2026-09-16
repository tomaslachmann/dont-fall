# 02 — Cylinder primitive

**What to build:** A second static primitive alongside the box: round fence
posts and rails as data (`center`, `halfHeight`, `radius`, `axis?`), Rapier
cylinder colliders on both sides, `CylinderGeometry` in client and builder.

**Blocked by:** 01 (same render/collider seams — land in order, keep the
diffs reviewable).

**Status:** planned.

## Why

Ticket 01 rounds boxes, but a fence post is not a rounded box — it's a
cylinder, and faking one from boxes looks wrong up close. Rapier ships an
exact cylinder collider (`ColliderDesc.cylinder(halfHeight, radius)`,
verified in the installed `collider.d.ts:771`), so visual and collider match
1:1 with no rounding question at all.

## What to change

- [ ] `statics` becomes a box/cylinder union: `{ kind: "box", ...FloorBox } |
      { kind: "cylinder", center, halfHeight, radius, axis?, surface?,
      color? }` — all existing entries read as boxes unchanged
- [ ] `axis?: "x" | "y" | "z"` (default `"y"`) lays rails horizontal without
      quaternions; `resolveTrack` carries it through like `surface`
- [ ] `RapierSimulation`: one branch — `ColliderDesc.cylinder` for cylinders
      (plus `setRotation` for non-Y axes), `cuboid` untouched otherwise
- [ ] Client `boxMesh` sibling + builder preview: `CylinderGeometry` with the
      resolved color; radius field ignored on cylinders (nothing to round)
- [ ] Builder overlap check approximates a cylinder by its bounding box
      (conservative, documented) — no new SAT test this ticket

## Done when

- [ ] Unit: a cylinder Module resolves + collides identically on both sides;
      axis variants orient correctly; box entries byte-identical to before
- [ ] A hand-written fence Module (posts + rails, colored) renders and
      collides in the client
- [ ] Live: walk into/around the fence in the real game — posts block,
      rails block, nothing invisible or phantom
- [ ] Builder preview matches the game; overlap ghost treats cylinders
      honestly (bounding-box approximation visible, never red on green)

## Watch out for

**Don't generalize to N primitives.** Wedges and arcs already have a home
(ADR 0055's parametric blocks) — this ticket is cylinders only, and the
union stays closed until a real Module needs a third shape.

**Rotation is axis-only on purpose.** A full quaternion per primitive
re-opens the ADR 0034 placement math for no fence-shaped reason — `axis`
covers posts and rails, which is the whole ticket.
