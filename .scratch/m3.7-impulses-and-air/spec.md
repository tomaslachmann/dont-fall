# M3.7 — Impulses and air

Recorded from the same eight-round `/grill-with-docs` session as M3.6 (2026-09). Milestone
definition in `docs/milestones/M3.7.md`; decisions in ADR 0035 (Epoch-latched velocity writes), ADR
0036 (Volume as its own entity kind), ADR 0037 (speed-gated wall Impact).

## Why this is a separate milestone from M3.6

M3.6's selection criterion was "adds no replicated state" (with `Sliding` as its single, argued
exception). Everything here breaks that criterion: a pad, a bounce and a launch all need an `Epoch`
latch so they fire exactly once under prediction replay. Grouping them means the protocol changes
once, is verified once, and any prediction bug they cause has one milestone to look in.

## The design turn this milestone came out of

The session initially settled on "every effect is a continuous function of position; a bounce is the
single deliberate exception". Research then showed the exception was a symptom: SuperTuxKart's
zipper is an impulse *plus* a temporarily raised speed cap with a fade, and a boost implemented as a
pure continuous multiplier is clipped by the cap on the very next tick — on a short pad it does
almost nothing.

Rather than accumulate exceptions, the movement model itself was replaced (ADR 0035). Once velocity
persists between ticks, a one-shot velocity write stops being exceptional — it is an ordinary write
that the next tick's acceleration and drag act on. `Epoch` then carries only "fire once", not "behave
differently". That is why M3.6 has to land first: this milestone is cheap on top of the new model
and near-impossible on top of the old one.

## Prior art the tickets should follow

- **Quake 3's jump pad** is the netcode template: launch velocity precomputed, velocity **set**
  rather than added (idempotent under replay), the code in the shared module both sides run, and
  one-shot firing deduped via a latch in the replicated player state. Independently the same pattern
  `CONTEXT.md` already calls an **Epoch**.
- **`SURF_NODAMAGE`** exists in Quake precisely so bounce pads do not cause fall damage — the general
  rule being that a surface which launches you may declare its landings harmless. Here it costs
  nothing: no fall-damage rule exists at all (ADR 0037).
- **`Checkpoint`'s containment pipeline** (`OrientedBox` → `orientBox` → `pointInOrientedBox`) is
  correct for rotated and tilted Segments since ADR 0034, and is what Volumes reuse rather than
  reinvent.

## Deliberately unresolved

Every number: pad strength, fade length, bounce velocity, updraft force and its speed ceiling. Same
posture as M3.6 — structure is decided, magnitudes are measured against real content.
