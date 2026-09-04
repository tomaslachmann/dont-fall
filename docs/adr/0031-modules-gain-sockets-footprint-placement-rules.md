# 0031 — Modules gain Sockets, Footprint, and Placement rules; `MODULE_STEP` is retired

ADR 0030 gave every Module the exact same fixed footprint/step so a Track could chain them with
no compatibility metadata — simple, but structurally unable to give pieces real variety: every
Module is interchangeable, none can be rotated to anything but identity, and the builder can only
append/remove the *last* Segment (no insert, move, or delete in the middle). A second grilling
round (2026-09), cross-checked against `docs/track-builder-proposal.md` and
`docs/research/m3-track-builder-v2-architecture.md`, replaces the single global step with the
proposal's core data-model spine, adopted under this project's own naming (`CONTEXT.md`'s
`Module`/`Segment`/`Track`, not the proposal's `PieceDefinition`/`TrackPiece`/`TrackSnapshot` —
same concepts, no reason to rename an already-glossaried term).

## Decision

- **Every Module declares its own Sockets** — named local connection points (`position` +
  `rotation`), at minimum an `entry` and `exit`. Placing a Module against another aligns the new
  Module's entry Socket to the target's exit Socket; the Track builder computes the resulting
  world transform, not a global constant.
- **Every Module declares a Footprint** — occupied bounds + clearance, a placement/overlap
  contract independent of its visual geometry or Rapier collider (`CONTEXT.md`).
- **Sockets carry a type, but M3-v2 ships with exactly one (`"floor"`)** — the structure
  (`SocketType`, `accepts`) is adopted now so a second type is additive later, not a rewrite;
  building a second type today would be speculative (every current Module is a walkable floor
  piece).
- **A Segment's `rotation` is real now**, not always `0` — placement can align a Module at any of
  its Socket's allowed yaws. Track topology is still a single linear sequence (no branching) —
  only the *rotation* constraint from ADR 0030 is lifted, not the topology one.
- **The builder can insert, move, rotate, delete (any Segment, not just the last), and duplicate**
  — command-pattern (`EditorCommand.execute`/`undo`), giving undo/redo for free. This is
  well-established editor architecture, not a genuine trade-off, so it doesn't need its own ADR.

## Consequences

- `packages/shared/src/track/Module.ts`: `MODULE_STEP` is removed; `Module` gains `sockets:
  SocketDefinition[]` and `footprint: Footprint`.
- `chainTrack` (auto-assembly for the randomizer, ticket 06) now walks Socket-to-Socket instead of
  summing a constant — still zero compatibility metadata needed *between* Modules, since they all
  still share the one `"floor"` Socket type.
- Every existing M1-derived Module (`modules.ts`) needs an entry/exit Socket + Footprint added;
  this is a data migration, not a logic rewrite.
- The Track builder's placement UI moves from "click appends at the end" to real
  select/move/rotate/delete/duplicate against Socket-snap candidates, per
  `docs/track-builder-proposal.md` §5.4's snap algorithm (simplified: one Socket type, so
  compatibility filtering is trivial).
