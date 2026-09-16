# 01 — Rounded look: radius + color data and render

**What to build:** The Fall Guys look as data + render: optional
`cornerRadius`/`color` on Module and per primitive (Module default,
per-primitive override), `RoundedBoxGeometry` in the client and the builder
preview, and a color material cache. Physics untouched.

**Blocked by:** nothing (first ticket).

**Status:** planned.

## Why

Everything M10 authors needs somewhere to put "rounded" and "pink" — and
every Module already placed needs the look without re-authoring. Data first
(the `surface?` precedent: additive, optional, resolved with a default),
render second, and the collider path never learns these fields exist.

## What to change

- [ ] `Module.cornerRadius?` / `Module.color?` + `FloorBox.cornerRadius?` /
      `FloorBox.color?` (hex string); resolve `box ?? module ??
      DEFAULT_*` next to the existing `surface` resolution
- [ ] `DEFAULT_CORNER_RADIUS` (~0.12) as a named tuning constant in
      `packages/shared` (a number, not three.js — ADR 0050's boundary holds)
- [ ] Client `boxMesh`: `RoundedBoxGeometry(w, h, d, 2, radius)` with the
      resolved radius; material cache keyed by resolved color (default keeps
      today's `platformMaterial` shade)
- [ ] Same swap in the builder's preview mesh so authoring shows the look
- [ ] Thin-primitive guard: radius clamps to the shortest half-side (what the
      geometry does anyway) — eyeball thin walls/rails, leave unrounded where
      rounding eats the face

## Done when

- [ ] Unit: resolve falls back box → module → default; unknown/missing color
      never throws, resolves to the default shade
- [ ] Every existing Module renders rounded + unchanged in color with no data
      change (defaults carry them)
- [ ] Live: walk a Module in the real game — feet flat on top, edges visibly
      round; same Module in the builder preview matches
- [ ] Shared/world-step tests green; no three.js import in `packages/shared`

## Watch out for

**Color is a string, not a type.** Free hex keeps the data permissive; a
palette is a builder preset + later validation, never a data constraint —
don't invent a `ColorId` union now.

**Don't round the collider.** `ColliderDesc.roundCuboid` dilates the shape
(research §2.2) — the collider path stays verbatim `cuboid`, radius never
leaves the renderer.
