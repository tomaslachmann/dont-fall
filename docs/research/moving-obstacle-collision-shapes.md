# Collision shapes for moving obstacles: primitives, hulls, decomposition, or trimesh

> Research note under `docs/research/`, parallel to `docs/adr/` (decisions) and
> `docs/milestones/` (specs). This file feeds a design discussion; it is not itself a
> decision record. If the recommendation below is adopted it should be captured as an ADR
> (it would amend ADR 0050's "collision is the verbatim trimesh" rule).

## Question

How should collision shapes for **moving kinematic obstacles** with complex/curved
authored meshes (a ball on a pendulum, hammers, saw discs, spiked plates, rotating drums)
be built so the kinematic Character is pushed out correctly and is never trapped inside or
under them — while staying identical on client and server?

## Our context

- **Collision today is the render mesh.** `scripts/convert-lib.ts` `addRolePairs` duplicates
  every scene root into a `role: "collision"` and a `role: "visual"` subtree over the *same*
  mesh; `packages/shared/src/track/asset.ts` bakes each collision node's triangles verbatim.
  ADR 0050 chose "collision is a trimesh, verbatim, statics only" because the M8 meshes were
  "tens of vertices", and explicitly deferred hulls to "dynamic asset parts, which need them".
- **ADR 0061 then put those trimeshes on kinematic bodies.** `MovingSegment.ts` builds one
  `kinematicPositionBased` body per moving Segment and attaches
  `ColliderDesc.trimesh(..., TriMeshFlags.ORIENTED)` per collision mesh.
- **Push-out.** After the step, `RapierSimulation.resolveMovingSegmentContacts` runs
  `intersectionsWithShape(capsule)` filtered to Moving Segment colliders, calls
  `collider.contactCollider(capsule, 0)`, skips the contact if `normal1.y >
  SURFACE_GROUND_NORMAL_MIN_Y` (treated as ground/Ride), else queues
  `push = normal1 * -distance` (deepest wins) into the next tick's `computeColliderMovement`
  sweep, and feeds closing speed into the Impact pipeline.
- **What the meshes actually are** (measured with a union-find over welded vertices on the
  converted GLBs, pre-Segment-scale):

  | Asset | Collision nodes | Triangles | Connected components |
  |---|---|---|---|
  | `trap_trapball` | 1 | 40 344 | 2: a thin chain/rod 0.10×3.82×0.10 (**39 352 tris**) + a ball Ø1.71 (992 tris) |
  | `trap_ball` | 1 | 960 | 1 (a UV sphere, Ø2.0) |
  | `trap_hammer` | 1 | ~3 600 | 5 (handle, head, caps) |
  | `trap_trap` | 1 | ~5 800 | 2 (post + base) |
  | `trap_platformspikeblue` | 1 | — | 18 (plate halves + 16 small spikes) |
  | `trap_trapcirclespikeblue` | 2 | — | 90 + 1 (drum body, plates, dozens of spikes) |

  So "one collision node" is routinely *several disjoint solids* in one mesh, and the
  pendulum's collision budget is 97 % chain. A single convex hull per node would be wrong
  (the pendulum's hull is a cone from pivot to ball); per-component shapes are the natural
  unit.
- **Symptom:** a swinging `trap_trapball` holds the Character underneath it instead of
  pushing it away.

---

## 1. Rapier / Parry (primary)

**Shape catalogue.** Rapier's JS collider guide lists ball, cuboid, capsule, cylinder, cone,
the round variants (round cuboid / cylinder / cone / convex polyhedron), convex hull, convex
mesh, triangle mesh, heightfield, and compound shapes
([rapier.rs — Colliders, JS](https://rapier.rs/docs/user_guides/javascript/colliders)).

**Trimeshes are hollow.** The same page says a triangle mesh is made of triangles "with no
thickness", so queries such as point containment "won't work intuitively because the
triangle mesh is assumed to have no interior" (same URL). It then gives the rule that
matters here, for dynamic bodies: using trimeshes is "discouraged … Because they have no
interior, it is easy for another object to get stuck into them", and it recommends "a
convex decomposition with a compound shape instead" (same URL). Our bodies are kinematic,
not dynamic, but the failure it names ("stuck into them") is about the *shape*, not the
body type. A kinematic body that sweeps its surface past a capsule has exactly the
problem a dynamic one does.

**Round shapes are cheaper.** Collision detection with round cylinders, round cones and
round convex shapes "will be faster than … their non-round counterparts". Round cuboids
are the exception and are *slower* than plain cuboids (same URL).

**`TriMeshFlags` (parry).** `ORIENTED`: "the trimesh will be assumed to be oriented (with
outward normals). The pseudo-normals of its vertices and edges will be computed."
`FIX_INTERNAL_EDGES` fixes contact normals "that could lead to incorrect bumps … (especially
on flat surfaces)" by taking adjacent triangle normals into account
([docs.rs parry3d `TriMeshFlags`](https://docs.rs/parry3d/latest/parry3d/shape/struct.TriMeshFlags.html)).
Pseudo-normals are what let parry tell a point just *inside* an oriented mesh from one just
outside. That only works if the mesh is closed and consistently wound. The summarising fetch
of that page also claimed that "contact detection doesn't occur when a shape is completely
inside the mesh". I could not find that sentence verbatim on docs.rs, so treat it as
**unverified**. It does follow from the "no interior" statement above.

**Character controller.** Rapier keeps "a small gap between the character shape and the
environment" called `offset`, for numerical stability. Autostep only fires when "touching
the floor right before the obstacle", and the built-in controller "does not support
rotational movement"
([rapier.rs — Character controller, JS](https://rapier.rs/docs/user_guides/javascript/character_controller)).
The page says **nothing** about a kinematic body moving *into* the character, or about
recovering from penetration. It only mentions using a controller to move a platform. So
"pushed by an obstacle" is ours to build, which is what `resolveMovingSegmentContacts`
already does. What we get back is only as good as the contact the shape pair produces.
(Unverified: how parry's controller handles a capsule that *starts* a sweep already
overlapping a trimesh. The guide doesn't say, and I did not read the Rust source.)

## 2. The installed JS API (`@dimforge/rapier3d-compat@0.20.0`)

Primary source: `node_modules/.pnpm/@dimforge+rapier3d-compat@0.20.0/node_modules/@dimforge/rapier3d-compat/dist/geometry/collider.d.ts`
and `…/geometry/shape.d.ts`.

- **Primitives** are all present on `ColliderDesc`: `ball(radius)`, `capsule(halfHeight,
  radius)`, `cuboid`, `roundCuboid`, `cylinder`, `roundCylinder`, `cone`, `roundCone`.
- **Convex:** `convexHull(points)` computes the hull at runtime. `convexMesh(vertices,
  indices?)` takes points "assumed to form a convex polyline (no convex-hull computation will
  be done)". `roundConvexHull` and `roundConvexMesh` add a `borderRadius`. All four return
  `ColliderDesc | null`, where null means degenerate input.
- **Compound:** `compound(shapes, positions, rotations)`. Nested compounds are not allowed.
- **Convex decomposition exists in JS:** `ColliderDesc.convexDecomposition(vertices,
  indices, params?: VHACDParameters)` builds "a compound shape automatically created from a
  convex decomposition of the given triangle mesh". `VHACDParameters` exposes `alpha`,
  `beta`, `concavity`, `planeDownsampling`, `convexHullDownsampling`, `maxConvexHulls`,
  `resolution` and `convexHullApproximation`, the knobs of parry's V-HACD port (the raw
  binding is `RawVHACDParameters` in `rapier_wasm3d.d.ts`).
- **`TriMeshFlags`** in `shape.d.ts`: `DELETE_BAD_TOPOLOGY_TRIANGLES=4`, `ORIENTED=8`,
  `MERGE_DUPLICATE_VERTICES=16`, `DELETE_DEGENERATE_TRIANGLES=32`,
  `DELETE_DUPLICATE_TRIANGLES=64`, `FIX_INTERNAL_EDGES=144`. The last is documented
  "NOT SUPPORTED IN THE 2D VERSION" and is available in 3D.
- **Queries we use:** `Collider.contactCollider(collider2, prediction)` and
  `Shape.contactShape(...)` return a `ShapeContact | null`. `projectPoint(point, solid)` and
  the ray casts take a `solid` flag, which only means something for shapes with an interior.

What this means for determinism: every option above runs inside the same
`rapier_wasm3d_bg.wasm` on client and server. A runtime `convexHull` or
`convexDecomposition` would give the same result on both sides, provided they get
byte-identical input and use the same package version. V-HACD over a 40k-triangle mesh,
though, is load-time CPU on both sides for no benefit, and it would couple the result to
the Rapier version. It is stricter and cheaper to store the finished hull points and
rebuild them at load: `convexHull` over points that are already a hull, or `convexMesh` if
hull indices are stored too. The probe in §8 found that reading back
`collider.shape.vertices` after `convexHull` returned the *input* points (`indices`
undefined). A build step that wants reduced hull vertices has to compute the hull itself.

## 3. Unity

- "Concave Mesh colliders can only be static (that is, they have no physics body) or
  kinematic (they have a kinematic physics body)." Also: "If two concave colliders make
  contact, no collision occurs." Mesh colliders are best reserved for cases "where
  primitive colliders or a compound collider would have a greater overhead"
  ([Unity Manual — Introduction to Mesh colliders](https://docs.unity3d.com/Manual/mesh-colliders-introduction.html)).
- Convex mesh colliders "are limited to 255 triangles". The same page adds: "for moving or
  dynamic objects, primitive colliders can be more efficient because they offer more
  stability and better-performing physics simulation"
  ([Unity Manual — Mesh Collider component](https://docs.unity3d.com/Manual/class-MeshCollider.html)).
- Unity's own compound-collider page was not fetched (budget), so its wording is
  unverified. That a Rigidbody's child primitives act as one body is well known, but I have
  no citation for it here.

Takeaway: Unity *allows* a concave mesh on a kinematic body, as Rapier does. Its guidance
is still that moving things get primitives or convex shapes, and that is where the
engine's stability promise sits. The 255-triangle cap on a convex mesh is also a hint about
how much detail a collision shape is expected to carry.

## 4. Unreal Engine

- **Authored collision by naming convention.** An FBX may carry collision meshes named
  `UBX_[RenderMeshName]_##` (box), `UCP_…` (capsule), `USP_…` (sphere) and `UCX_…` (convex).
  `RenderMeshName` must match the render mesh, and the `##` suffix allows several per mesh.
  A convex object "can be any completely closed convex 3D shape"
  ([Unreal — FBX Static Mesh Pipeline](https://dev.epicgames.com/documentation/en-us/unreal-engine/fbx-static-mesh-pipeline-in-unreal-engine)).
  This is the closest industry precedent to our `role: "collision"` extras. The *author*
  (or a tool) states the primitive type, and the importer never infers it from a render
  mesh.
- **Auto Convex Collision** in the Static Mesh Editor has "Hull Count" ("the number of
  primitives to represent the collision mesh"), "Max Hull Verts" and "Hull Precision"
  (voxels used for generation)
  ([Unreal — Setting up collisions with Static Meshes](https://dev.epicgames.com/documentation/en-us/unreal-engine/setting-up-collisions-with-static-meshes-in-unreal-engine)).
  These are the same voxel-based V-HACD knobs Rapier exposes (§2).
- **Simple vs complex / "Use Complex Collision As Simple":** neither fetched page covers the
  flag or its restriction on simulated bodies, so this is **unverified** here. (It is widely
  reported that Chaos/PhysX refuse to simulate a body whose simple collision is the complex
  trimesh, but I have no primary citation.)

## 5. Godot

- `ConcavePolygonShape3D` "is *hollow* even if the interconnected triangles do enclose a
  volume, which often makes it unsuitable for physics or detection". It "is intended to
  work with static CollisionShape3D nodes like StaticBody3D and will likely not behave well
  for CharacterBody3Ds or RigidBody3Ds in a mode other than Static". The page warns that a
  fast-moving body can go from outside to inside between frames and, because the shape is
  hollow, the collision is missed. The shape is "the slowest 3D collision shape to check
  collisions against" and should be limited to level geometry, with several
  `ConvexPolygonShape3D`s used for anything that moves. `backface_collision` defaults to
  false, so faces collide only along their normals
  ([Godot — ConcavePolygonShape3D](https://docs.godotengine.org/en/stable/classes/class_concavepolygonshape3d.html)).
- **Import hints.** Name suffixes on a mesh node choose the collider: `-col` gives "a
  triangle mesh collision shape … slow, but accurate", `-convcol` gives a
  `ConvexPolygonShape3D`, `-colonly` replaces the mesh with a collision-only body,
  `-convcolonly` is the convex version of that, and `-rigid` imports a RigidBody3D. With
  `-colonly`, Blender *empties* map to primitives by draw type (cube → BoxShape3D, sphere →
  SphereShape3D …). The page's standing advice: "try to use a few primitive collision
  shapes instead of triangle mesh or convex shapes. Primitive shapes often have the best
  performance and reliability"
  ([Godot — Node type customization using name suffixes](https://docs.godotengine.org/en/stable/tutorials/assets_pipeline/importing_3d_scenes/node_type_customization.html)).

Godot states our situation outright: a concave (trimesh) shape is for Static bodies only
and misbehaves with a CharacterBody that meets it any other way. It also gives the same
authoring pattern as Unreal. A node-name hint picks the shape family at import, and
primitives come recommended first.

## 6. Convex decomposition tools (V-HACD, CoACD)

- **V-HACD** "decomposes a 3D surface into a set of 'near' convex parts". The default
  hull count is 32, which the README calls "often way too high". You ask for a hull count
  rather than getting a "minimum solution". v4.0 is a single-header C++ library under
  BSD-3-Clause ([kmammou/v-hacd](https://github.com/kmammou/v-hacd)). The README says
  nothing about determinism or threading (**unverified**). Rapier ships its own V-HACD port
  in WASM as `ColliderDesc.convexDecomposition` (§2), so we would need no native dependency
  to use it.
- **CoACD** (collision-aware approximate convex decomposition) writes convex hulls as
  `.obj`/`.wrl`. Its main knob is `-t/--threshold` (concavity, 0.01–1, default 0.05). It
  also has `-c/--max-convex-hull` (which "may introduce convex hull with a concavity larger
  than the threshold"), `-pm/--preprocess-mode` (manifold pre-pass: auto/on/off),
  `-pr/--prep-resolution` and `-r/--resolution`. "The algorithm is stochastic", and there is
  a `--seed` for reproducibility. It has Python (pip) and C++ bindings plus a Unity
  integration, no JS/WASM binding is listed, and it is MIT
  ([SarahWeiii/CoACD](https://github.com/SarahWeiii/CoACD)).

For us:

- Both tools need a build step. CoACD would add a Python dependency to the converter, and
  it is stochastic unless seeded. Either way the only safe place to run it is **build
  time, storing the output**, never on each side at load.
- Neither tool is needed for most of the current trap pack. The component table in "Our
  context" shows the meshes are already made of *separate, individually near-convex
  solids*: a UV sphere, cylinder handles and caps, cone spikes. Splitting by connected
  component and taking one hull per component gets most of what a decomposition would,
  deterministically, in about 40 lines of TypeScript. Real decomposition is only
  needed for a single component that is itself concave, such as the 8.17 m drum body in
  `trap_trapcirclespikeblue`. Voxel methods also risk thin parts like the pendulum
  chain (0.10 m wide) disappearing below the voxel size (**unverified**, my inference from
  "voxel resolution").

## 7. glTF physics extensions

The Khronos-branch URL (`KhronosGroup/glTF/.../KHR_physics_rigid_bodies`) returned 404, so
this is **not ratified in the main glTF repo as of this note**. The working drafts live in
[eoineoineoin/glTF_Physics](https://github.com/eoineoineoin/glTF_Physics) (read via the
GitHub API):

- `KHR_physics_rigid_bodies` — Status: **Draft**. A node's `geometry` references either a
  `mesh` or a `KHR_implicit_shapes` `shape`, plus a `convexHull: boolean`. The rationale
  given: "Physics simulations typically recommend against allowing collisions between
  pairs of triangulated mesh objects, preferring to collide pairs of convex shapes
  instead." With `convexHull: true` "the resulting geometry should enclose every `POSITION`
  described by all primitives". `motion.isKinematic` means "treat the rigid body as having
  infinite mass"
  (`extensions/2.0/Khronos/KHR_physics_rigid_bodies/README.md`).
- `KHR_implicit_shapes` defines `sphere`, `box`, `cylinder` (Y-aligned, possibly with
  different top and bottom radii, so a cone is a special case) and `capsule` (Y-aligned,
  two capping spheres that may differ in radius). Degenerate shapes are prohibited
  (`extensions/2.0/Khronos/KHR_implicit_shapes/README.md`).

Takeaway: the vocabulary is almost exactly ours (a per-node sphere/box/cylinder/capsule, or
a mesh flagged as a hull), but the extension is a draft and nothing in our toolchain reads
it. Mirroring its field names inside our existing node `extras` costs nothing and keeps a
path open to adopt it later. Adopting the extension itself now buys nothing. One caveat:
Rapier's `capsule` and `cylinder` take a single radius, so a tapered implicit shape would
need `cone`/`roundCone` or a hull.

## 8. Measured: the same contact through our Rapier (0.20.0, Node)

A throwaway probe (scratchpad script, not committed). It uses a kinematic body at y=2 holding a
Ø1.71 sphere, the `trap_trapball` ball size, in three forms: an `ORIENTED` trimesh UV sphere
(960 triangles), `convexHull` of the same vertices, and `ball(0.855)`. Our capsule
(`CAPSULE_HALF_HEIGHT` 0.5, `CAPSULE_RADIUS` 0.35) is placed at five poses, and each row
shows `obstacle.contactCollider(capsule, 0)`, the exact call in
`resolveMovingSegmentContacts`:

| Capsule pose | Trimesh `ORIENTED` | Convex hull | Ball |
|---|---|---|---|
| directly below, 0.10 in | d −0.10, n (0,−1,0) | d −0.10, n (0,−1,0) | d −0.10, n (0,−1,0) |
| below, 0.3 off-centre | d −0.10, n (0.29,−0.96,0) | same | same |
| side, 0.25 deep | d −0.25, n (1,0,0) | same | same |
| side, axis 0.1 **inside** the surface | d −0.35, n **(0,0,1)**: sideways, wrong depth | d −0.45, n (1,0,0.1) | d −0.45, n (1,0,0) |
| capsule **fully inside** | d **−0.002**, n **(−0.1,1.0,0)**: "up" | d −1.15, n (1,0,0.1) | d −1.16, n (1,0,0) |

Two findings, and they are separate problems:

1. **Once the capsule crosses the surface, a trimesh lies.** The nearest-triangle contact
   swings sideways, reports a depth that is too shallow, and when the capsule is fully
   inside it points *up* with ~0 depth. `normal.y > SURFACE_GROUND_NORMAL_MIN_Y` then files
   that under "ground/Ride" and **no push is queued**, so the Character stays trapped inside
   the obstacle and is carried by it. Solid shapes (hull, ball) keep a consistent outward
   normal and the full depth needed to get out. At 30 Hz a pendulum ball's rim easily moves
   more than a capsule radius (0.35 m) per tick, so this pose is reachable.
2. **"Held underneath" happens with every shape.** Directly below, all three return
   n = (0,−1,0). The push goes straight down, into the floor the next sweep is standing on,
   so it is absorbed. The closing speed along that normal is ~0 because the ball moves
   horizontally at the bottom of its swing, so no Impact fires either. The Character is
   pressed but never displaced or knocked. Changing the shape alone will **not** fix the
   reported symptom.

A second probe confirmed the JS decomposition output can be read back
(`collider.shape.shapes[i].vertices`), and that two runs gave identical parts. Default
parameters split a two-box L-extrusion into **7** hulls, where 2 is exact.

---

## Recommendation

**Moving Segments never collide as trimeshes. At build time the converter replaces each
collision node with solid shapes: fitted primitives first, one convex hull per connected
component otherwise, and V-HACD only when an author asks for it. The runtime builds those
stored shapes verbatim, identically on both sides. Separately, fix the push-out rule so
an obstacle pressing a grounded Character into the floor pushes it along the obstacle's
motion instead of into the ground.**

### Shape family per piece

| Piece | Shape | Why |
|---|---|---|
| Round moving part (pendulum ball, `trap_ball`) | `ball` | Exact curvature and the cheapest contact. The normal always runs from the centre (§8). |
| Rods, handles, chains, posts, saw hubs | `capsule` / `cylinder` (or `roundCylinder`, cheaper per §1) | A 39k-triangle chain becomes one shape with the same silhouette |
| Hammer heads, plates, drums, saw discs | `cylinder` / `cuboid` where the fit is within tolerance, else `hull` | Solid, with a reliable penetration depth |
| Spikes (dozens per plate/drum) | one `hull` per plate *row*, or `cone`s | 90 tiny colliders is wasteful, and a spike never needs its own contact |
| Single concave component (rare: drum body with cut-outs) | `decompose` (author opt-in), stored result | Default V-HACD over-splits (7 parts for an L). Review it rather than trust it. |
| Still floors, stairs, corners | unchanged verbatim trimesh (ADR 0050) | Static trimeshes are the documented use (§1, §5). Exact floors matter for walking. |

A Segment is only known to move per Track (ADR 0061), so the converter cannot key the
choice on "moving". Key it on the asset instead: trap-pack/Obstacle assets get solid
shapes by default, and platform/floor assets keep a trimesh. An asset whose collision is
still `trimesh` **cannot be given a Motion**. The API and the builder refuse it with a
readable reason, the same pattern as M5 refusing a Race on a Track with no Finish Zone.
That keeps a hollow shape off a kinematic body by construction rather than by luck.

### Where it runs

- **Build time, in `scripts/convert-lib.ts`**, as a pass after `addRolePairs`. For each
  collision node: weld the vertices, split into connected components (the union-find
  used for the table above), then try fits in order: sphere (every vertex within ε of a
  radius about the centroid), capsule/cylinder (PCA axis, radial residual ≤ ε), box (OBB
  residual). Fall back to a convex hull. Tolerance ε is a named constant (say 2 % of the
  component's extent). Components below a volume threshold merge into their nearest
  neighbour's hull.
- **Stored in the same GLB**, so ADR 0050's single-file, single-source rule survives. A
  primitive becomes a *mesh-less* node with `extras: { role: "collision", collider:
  { type: "ball", radius } }` and its centre/rotation in the node transform. A hull becomes
  a mesh node with `extras: { role: "collision", collider: "hull" }` whose POSITIONs *are*
  the hull points. The visual node keeps the full render mesh, and collision stops sharing
  it.
- **Runtime (`asset.ts` → `resolveTrack` → `MovingSegment` / the static path)** reads a
  `CollisionShape` union and calls `ColliderDesc.ball/capsule/cylinder/cuboid/convexHull`
  on the stored numbers. There is no fitting or decomposition at load. Even the
  `convexHull` pass runs on already-hull points inside the same WASM, over byte-identical
  input, on server and client. Keep one collider per part rather than a `compound`, so
  `spikedHandles` and per-part `surface`/`hazard` keep working unchanged.
- `validateAsset`'s footprint check has to measure primitive bounds analytically, and the
  track-builder's moving-surface tint has to draw primitives and hulls, not the render
  trimesh.

### Author overrides

Follow the Unreal/Godot pattern (§4, §5) inside our existing extras convention. A node may
set `extras.collider` to `"auto" | "ball" | "capsule" | "cylinder" | "box" | "hull" |
"decompose" | "trimesh" | "none"`. The pack GLBs are not hand-edited, so the everyday
override is a **per-stem table in the converter**, like `hazard` in ADR 0061. For example,
`trapball: { chain: "capsule", ball: "ball" }`, or `"none"` for purely decorative chain
links. The converter always writes a *resolved* concrete shape, so the runtime never sees
`"auto"` and never makes a choice itself. The field names (`sphere`/`box`/`capsule`/
`cylinder`, `convexHull`) can mirror the draft `KHR_implicit_shapes` so a later migration
is a rename (§7).

### Push-out change (the actual "held underneath" fix)

In `resolveMovingSegmentContacts`, once the contact is solid:

1. **Pressed from above while grounded** (`normal.y < 0` and the Character is grounded):
   drop the into-ground component of the push. If the remaining horizontal push is below
   ε, push along the horizontal projection of `movingSegmentVelocityAt(contact point)`,
   the direction the obstacle is sweeping, with magnitude equal to the penetration depth.
2. **Closing speed for that case** is measured along the same horizontal direction, not
   along the vertical normal. A ball skimming your head at speed then Staggers or knocks
   you down through the existing `IMPACT_*` thresholds, instead of reading ~0.
3. Optionally lead the one-tick lag. Push by `depth + max(0, v·n)·TICK_DT`, so next tick's
   sweep clears where the body *will* be. This is unverified: measure it with the same kind
   of probe before adopting.
4. A slab crushing downward onto a Character with nowhere to go (Slide down onto a floor)
   is a separate rule (force a knockdown). Note it, but don't bundle it.

Both sides run this in the shared step, so it needs no replication change.

### Effort and risks

- **Effort, roughly 3–5 days.** Converter pass plus fit tests: 1–2 days. The `asset.ts`
  shape union, mesh-less collision nodes, analytic footprint and tests: 1 day.
  `MovingSegment`/static builders plus the push-out change, with a regression test that
  drives a capsule under and inside a swinging ball: 1 day. Builder tint drawing shapes and
  a regenerate-all-GLBs run: about 1 day. An ADR amending ADR 0050 (collision may be
  primitives/hulls) and ADR 0061 (moving bodies carry no trimesh).
- **Risks.** Fit tolerance can misclassify a part (visible as a hit that is off from the art).
  Log each asset's chosen shapes and residuals in the converter output, and review the diff.
  Hulls fill concave single components. A decompose opt-in helps, but default V-HACD
  over-splits and voxel methods can lose thin parts (unverified). Regenerating every GLB
  churns `assets/`. Existing Tracks with Motion on a floor asset would start failing
  validation, so migrate them or allow those few stems a hull. The push rule change alters
  feel: tune it live, not only under vitest (the M6 lesson in `CLAUDE.md`).
