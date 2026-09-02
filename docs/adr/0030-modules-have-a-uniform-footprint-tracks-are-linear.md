# 0030 — Modules share one fixed footprint; a Track is strictly linear for M3

Two constraints keep both the builder and the randomizer (ADR 0028) simple: every Module has the
**same fixed-width, straight-line entry/exit footprint**, so any Module can follow any other
purely by placing it after the previous one ends — no per-Module compatibility metadata, no
socket-matching logic, in either the hand-built or randomized path. And a Track is **strictly a
single linear path** for M3 — no branching, no parallel routes — matching the existing Race Round
type and the Finish-Zone-as-an-area design (`CONTEXT.md`).

Both are deliberate scope cuts, not oversights: a variable footprint or branching topology are
each a materially bigger problem (junction pieces, path-balancing, non-trivial compatibility
checks) that M3's roadmap goal — "build a Track from Modules" — doesn't require solving yet.

## Consequences

- Every Module definition in `packages/shared` must fit the shared footprint; a Module whose
  natural shape doesn't (e.g. a wide arena piece) is out of scope until this ADR is revisited.
- The randomizer's job reduces to "pick an ordered list of Modules" — no graph/compatibility
  solving.
- Revisit if a specific Module design genuinely needs a different footprint or the game wants
  branching paths (e.g. a Team Round variant) — that's a new ADR, not a quiet exception here.
