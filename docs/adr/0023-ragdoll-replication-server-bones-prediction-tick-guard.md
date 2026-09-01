# 0023 — Ragdoll replication: 11 bones from the server, no local ragdoll body, a prediction-tick guard, epoch + cause

Extends ADR 0006 (the hybrid capsule/ragdoll Character) and amends ADR 0015 (knockdown
recovery is server-authoritative). Settled against `docs/research/m2-ragdoll-replication.md`
and `docs/research/m2-collision-and-predicted-ragdoll.md`.

## Decision

**The server runs the full 11-body articulated ragdoll** and is the authority for the bone
poses and for when the knockdown ends. DON'T FALL's constraints invert the ones that made
GTA Online skip networked ragdolls (32 players, listen-server): here it is one dedicated
process per match, 12 players, and *browser* clients — the server affords the 11-body sim
better than 12 browser tabs would, and option (a) below keeps the client cheap (it just
lerps received transforms).

**The client runs no local ragdoll body** — ticket 09 is closed. `bones` (all 11 transforms)
come from the server and are interpolated like a remote entity (ADR 0017). The wire shape is
a **sparse/indexed list with the count as data**, so a later switch to pelvis-only or
key-bones-only is not a schema break — the *documented fallback* if the profiling pass finds
a problem. Option (b) (send the pelvis only, run a local cosmetic ragdoll) was rejected: it
re-introduces the per-machine divergence and the getup-anchor pop that ADR 0015 just
removed, and it moves 11-body physics onto 12 browser clients.

**Capsule-only server ragdoll** is a documented fallback, adopted only on a measured
problem. The profiling pass (12 players / ~6 simultaneous ragdolls) checks CPU and
bandwidth **and race artefacts** — the asymmetric "only one client sees it" desync that
FiveM and Roblox report and that a performance profiler does not catch.

**The knockdown transition is predicted; the physics is not.** `motionState` snaps to
`Ragdoll` locally for instant feel (ADR 0015). The client tags its predicted ragdoll with
the prediction tick `P` and **ignores any non-down snapshot with `tick < P`** — the first
snapshot with `tick ≥ P` decides `motionState`. This is the correct, `bumpSeq`-free form of
the `downSincePredictionTick` guard that ADR 0015 over-removed; without it a stale snapshot
can revert a just-started knockdown (`reconcile()`'s `localDown && !serverDown` branch).
Backed by Fusion (resim only runs forward from a server tick), Unity NfE, CS2.

**Wire fields:**

- `bumpSeq` → `ragdollEpoch` — monotonic, rises on **every** Ragdoll entry (the old narrow
  Bump/Fall-only scope existed for ADR 0014's gate, which ADR 0015 removed).
- `ragdollCause` — 2 bits: Bump / Fall / DashWall / Spinner. For camera kick, hit-react,
  cause-specific SFX (M4). **Known limitation: 4 values max without a field-width bump** — a
  fifth cause later is a protocol-version change.
- `phaseStartTick` — the tick the current `motionState` phase began. The client derives the
  GettingUp blend locally from it (anchor-tick + local derivation, the `spinnerAngleAt`
  pattern; confirmed production practice, Unity NfE 2025). **Not** a `0..1` progress float.
- GettingUp: server-decided start, fixed duration.

**One-shot effects (impact SFX, camera kick, hit-react) — dual gate:**

- predicted effects gate on the *first forward simulation of the tick* (Source
  `IsFirstTimePredicted` / Fusion `IsForward` / Unity NfE) — never on a resimulated pass.
- snapshot-delivered effects gate on `ragdollEpoch > lastAppliedEpoch`.

## Consequences

- ADR 0015's "the local Character never recovers on its own" stands; its revert path gains
  the prediction-tick guard. The `downSincePredictionTick` / `localRecoverySeenByServer`
  machinery that ADR 0015 deleted is *not* restored — the new guard is simpler and not
  coupled to `bumpSeq`.
- `CharacterSnapshot`: `bumpSeq` renamed, `ragdollCause` + `phaseStartTick` added, `bones`
  reshaped to a sparse list. The server keeps its full articulated ragdoll.
- The profiling pass is a required part of accepting this ADR, not a follow-up.
