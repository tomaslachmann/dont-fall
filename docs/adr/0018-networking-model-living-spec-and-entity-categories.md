# 0018 — The M2 netcode is specified by a living spec; entities are classified by network category

By late M2 the netcode had accumulated ADRs 0011–0017 as a string of reactive patches
(knockdown recovery, then props, then interpolation smoothness), each fixing the previous.
The missing piece was a single model into which every entity slots. A grilling session
(2026-09), cross-checked against 50+ primary sources and three new research briefs, produced
one.

## Decision

**`docs/networking-model.md` is the canonical living spec** — it describes how the netcode
works *now*. ADRs remain immutable decision records (Nygard); each entity row and each
subsystem in the model doc links the ADR that justifies it, and never repeats the reasoning
inline (AWS Well-Architected: an ADR links supplementary material, it is not a design
guide). The Networking Handbook (`docs/DON'T FALL — Multiplayer Networking Handbook.md`) is
background reading, not canon.

**Every networked thing is classified into a network category** that dictates authority,
whether the client predicts it, its wire data, and its handoff policy:

- *Character — local* — predicted + reconciled (input-driven).
- *Character — remote* / *Prop — passive* / *ragdoll bones* — server-authoritative,
  render-delay interpolation, never predicted.
- *Prop — contacted* — narrowly predicted while the local Character touches it (ADR 0022).
- *Spinner* (kinematic pure-function) — recomputed client-side from the tick, no wire data
  (ADR 0025).
- *Trigger volumes* (Checkpoint, Fall, Finish Zone) — server decides; client predicts the
  crossing for feedback.
- *Static geometry* — config at join, no sync.
- *Track Segment* (M3) / *Item Box* (M4) — server-authoritative RNG; provisional rows.

The governing invariant: **predict only what the local player drives with their own input;
everything else is the server's, interpolated.**

## Consequences

- New entities are designed by placing a row in the table, not by inventing a bespoke sync
  scheme — this is the anti-treading-water mechanism.
- The model doc has a `Status: Built / Planned` column; provisional rows are visually
  distinct from settled ones.
- "Finished M2 protocol" means: this spec exists, the wire shapes in it are final, and
  binary encoding / delta compression / snapshot-rate reduction are explicitly deferred
  with trigger conditions (model doc §9) — not a rewrite later.
