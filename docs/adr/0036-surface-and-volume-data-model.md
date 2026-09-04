# 0036 — Surface is a per-Box property; Volume is a separate entity kind

M3.6/M3.7 give Track geometry physical character: a floor piece can be icy or muddy, can speed a
Character up or slow it down, and a region of air can push a Character upward. Neither concept
exists in the data model today — a `Module` is `statics: Box[]` plus Props/Spinners/Checkpoint/
Sockets/Footprint, and a `Box` carries no material information at all.

`docs/research/surface-and-volume-mechanics.md` surveyed how engines model this. The findings were
one-sided enough to settle the question rather than open it.

## Decision

- **A Surface is authored at two levels: `Box.surface?` and `Module.surface?`, resolved
  most-specific-first (`Box ?? Module ?? "default"`).** Per-collider granularity is what every
  surveyed engine settled on — Unity's PhysicMaterial, Unreal's Physical Materials, Source's
  `surfaceprop`, Quake's surface flags. Godot is the sole per-body holdout and its own proposal
  tracker documents the resulting failures; Khronos mandated per-shape materials in the glTF
  physics extension; Unreal's Physical Material Masks exist specifically because per-object turned
  out too coarse. "Most specific wins" is likewise unanimous. The Module level is not redundant
  with the Box level: it is how an author says "this whole piece is ice" without annotating every
  floor Box in it.
- **The two levels are collapsed once, in `resolveTrack`, not in the tick loop.** A resolved Track
  carries a concrete Surface on every floor Box, so `undefined` never reaches the simulation and no
  default-resolution logic runs 30 times a second on both client and server. This is Source's
  bake-at-map-load model.
- **A Volume is its own entity kind (`Module.volumes?: VolumeConfig[]`), never a collider carrying a
  special material.** glTF, Unreal, Source and Quake all agree on this separation. It reuses the
  containment pipeline `Checkpoint` already proves works: an `OrientedBox` through `orientBox` and
  `pointInOrientedBox`, which since ADR 0034 is correct for rotated and tilted Segments. Where
  Volumes overlap, exactly one wins by priority (Unreal's rule) rather than summing — summed forces
  make an authoring mistake feel like a physics bug.
- **Both fields are additive and optional**, exactly like ADR 0034's `pitch`/`roll`. Every already-
  published immutable Revision — including the M1 seed — parses and resolves unchanged, with every
  Surface resolving to `"default"` and no Volumes. No migration, no reseed.
- **The Surface under a Character is read from the floor collider handle the character controller
  already reports**, not from a new scene query. `RapierSimulation` keeps handle maps for Spinners,
  Props and Characters but none for statics; that map is the one piece of plumbing this needs. A new
  query would introduce a dependency on collider insertion order, which would break determinism
  quietly rather than loudly — the worst failure mode available to a project whose client and server
  must agree tick for tick.

## Consequences

- `packages/shared/src/track/Module.ts`: `Box`/`Module` gain optional `surface`, `Module` gains
  optional `volumes`. `Track.ts`'s `resolveTrack` gains the collapse step.
- `RapierSimulation` gains a static-collider handle map. It is delivered inside M3.6's first ticket
  rather than as a plumbing ticket of its own: mud caps top speed, which works on the current
  movement model, so the whole Surface path can be cut end-to-end and demonstrated the first time it
  is built.
- **A naming collision this creates, and how it is resolved:** `Checkpoint.volume` already exists and
  is a *detection* region, while the new domain term `Volume` (CONTEXT.md) means a region that
  applies a force. The domain term keeps the name; `Checkpoint`'s field is renamed to `trigger` so
  one word does not mean two things. Small, mechanical, and worth doing before the second meaning
  spreads.
- Conveyor belts were considered and deliberately left out. Source needs the whole
  `FL_BASEVELOCITY` lifecycle plus a momentum-conversion special case for the tick a Character steps
  off — a disproportionate amount of machinery for a mechanic nobody asked for.
