# 0065 — Moving Segments collide as solid parts, fitted at build time; a press from above shoves sideways

## Context

ADR 0050 made an Asset's collision its authored trimesh, and ADR 0061 put those
trimeshes on kinematic bodies so Segments could move. The converted packs'
"authored" collision is simply the render mesh (`trap_trapball`: 40k triangles,
97 % of them chain). A trimesh is a hollow shell with no inside. Driving the real
`trap_trapball` on a Swing through our Rapier (0.20) measured two failures
(`docs/research/moving-obstacle-collision-shapes.md`):

- a Character hit by the ball went down and its ragdoll was **carried inside the
  ball for the whole swing**;
- a Character the ball reached while standing still was **never pushed out** —
  inside the shell the contact reports an upward normal with no depth, which reads
  as floor.

And a third that no shape fixes: a body pressing a grounded Character from above
has a downward contact normal, so the push is absorbed by the floor and the
closing speed along it is ~0 while the body sweeps sideways — held underneath,
neither moved nor hit. Rapier, Unity, Unreal, Godot and the glTF physics draft
all reserve triangle meshes for still geometry.

Settled with the user (2026-09-15): fix both — the push rule first, then solid
shapes — and decompose concave moving pieces rather than filling their holes.

## Decision

- **Every Asset also carries solid parts**, stored in its own GLB as mesh-less
  `role: "solid"` nodes: `extras.shape` is a `ball` / `capsule` / `cylinder` /
  `box` (centred on the node, a capsule or cylinder along its local Y) or a `hull`
  (its points, in the Asset frame). The shared reader parses them into
  `ValidatedAsset.solid`.
- **A Moving Segment collides as its solid parts** whenever the Asset has them,
  never its trimesh. A still Segment keeps the exact trimesh (ADR 0050 unchanged
  for still geometry — walking on floors wants exactness, and trimeshes are fine
  there). Procedural box Modules are solid already.
- **Fitted at build time, rebuilt verbatim at load.** `scripts/convert-solids.ts`
  runs in both converters after seating: weld, split into connected components,
  gather many small ones (chain links, spikes) into one group, then per part — a
  closed part filling less than `CONCAVE_FILL_MAX` (0.9) of its hull is
  decomposed with V-HACD (through the same Rapier) so its hole stays open;
  otherwise the tightest ball / cylinder / capsule / oriented box whose volume the
  part's hull fills to `PRIMITIVE_FILL_MIN` (0.88), else one convex hull. Only the
  finished numbers are stored, so the server and every client build identical
  colliders with no fitting at runtime.
- **Scale** (ADR 0062) scales solid parts like everything else.
- **Pressed from above while grounded, a Character is shoved sideways**
  (`pushDirection`): the into-ground part of the contact normal is dropped, and
  right under the body — where nothing sideways is left — it is pushed the way the
  body is sweeping. The closing speed for the Impact is measured along that same
  direction, so a body skimming your head fast still staggers or knocks you down.

## Consequences

- Every Asset GLB is regenerated (both converters); the converters log each
  Asset's chosen parts for review (e.g. `trap_trapball: capsule r0.07 h2.53 · ball r1.17`).
- A fit can misjudge a part — a hit a little off from the art. Tolerances are
  named constants; the log is the review surface; a per-stem override is the
  escape hatch when one is needed.
- Hulls round off small concavities under the 0.9 threshold (a barrier's groove).
- V-HACD over-splits (up to ~38 hulls on a pipe), costing collider count, not
  correctness.
- The trimesh stays in every file, so still Segments are unaffected and an older
  file without solid parts still moves (as before, hollow).

## Alternatives rejected

- **Fitting at runtime** (or `convexDecomposition` at load): identical on both
  sides only by care, and CPU on every Track load for no gain.
- **Only solid parts, everywhere:** a decomposed floor has seams a walking
  Character can snag on; exact still trimeshes are the documented good use.
- **Refusing Motion on assets without a solid fit:** the user wants moving
  platforms, and every Asset now has a fit.
- **One hull per piece:** fills hoops, pipes and holes a Character must pass through.
