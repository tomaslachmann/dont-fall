# 04 — Retire Start, Finish, checkpoint and sandbox blocks

**What to build:** `start`, `finish`, `checkpoint-spinner`,
`checkpoint-end-props`, `sandbox` join `DEPRECATED_MODULE_IDS`.

**Blocked by:** 03 (the replacements exist first).

**Status:** done (2026-09-15) — tests

## How it behaves after

- The builder palette no longer offers them.
- A stored Track (and the seeded M1 playground) still loads, plays, respawns
  and finishes exactly as before; the builder shows the retired-piece warning
  naming the replacement (a gate Checkpoint, a finish sign, Start on a Segment).

## Checklist

- [x] `DEPRECATED_MODULE_IDS` + warning text
- [x] Tests: old Track resolves identically with warnings; palette hides them

## Notes

- Random Track generation is unchanged: it still chains the procedural
  library, retired pieces included (it already picked the retired pads).
  Filtering them would leave it two bridges and nothing raceable; generating
  from Assets and Gates is its own piece of work.
