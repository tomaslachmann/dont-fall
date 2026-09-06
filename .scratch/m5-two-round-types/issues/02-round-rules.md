# 02 — `RoundRules`: the rules a Round runs by, as data

**What to build:** The record that tells the shared step what kind of Round this is — without ever
telling it *which* kind.

Per ADR 0043, the shared step reads **fields** (does a Fall respawn or eliminate; what grants
Qualification) and never a Round-type name. Per ADR 0041, the record is resolved **once, before
COUNTDOWN**, from the Track Revision's defaults under the Round's overrides, and replicated on the
snapshot beside `phase` so the client predicts against exactly what the server simulates.

Nothing changes behaviour in this ticket: the only Round type that exists is a Race, and a Race
must resolve to precisely what M4 does today.

**Blocked by:** 01 (the lock is the first field that matters).

**Status:** blocked

- [ ] `RoundRules` is a plain data record in `packages/shared` — no Round-type enum reaches the step
- [ ] Resolution is one pure function: Track defaults under Round overrides, absent falls through
- [ ] It rides the snapshot beside `phase`; the client predicts against the replicated copy
- [ ] The Time Limit resolves through the same mechanism as everything else (ADR 0041) — one
      scheme, no special cases
- [ ] A Race resolves to today's behaviour exactly, pinned by the existing suite with no changed
      assertions
- [ ] Nothing varies the tick count, the Character iteration order, or the set of simulated bodies
