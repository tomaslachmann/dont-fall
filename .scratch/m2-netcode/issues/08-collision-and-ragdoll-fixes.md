# 08 — Collision & predicted-ragdoll fixes

**What to build:** Fix three ragdoll/collision defects found in M2 playtesting (tickets
03–06 in). All three trace back to the client predicting its own *physics* ragdoll and to
reconciliation treating a discrete state change as an event instead of a tick-aligned
field. Design settled against `docs/research/m2-collision-and-predicted-ragdoll.md`
(primary sources: Source/VDC, CS2 release notes, Halo: Reach GDC 2011, Photon Fusion,
Unity Netcode for Entities, Unreal Networked Physics, Rapier docs/changelog).

**Blocked by:** 05 (reconciliation), 06 (props). Independent of 07.

**Status:** ready-for-agent

The three parts are independent and can be split into separate tickets. Recommended
order: **Part B first** (most acute, most contained; also removes the churn that drives
Part C), then Part A, then Part D.

---

## Symptoms observed (playtest, 2-player, local server)

1. **Dash into a Prop → you "wake up" well past it.** The ragdoll flies *through* the box
   with full dash momentum and GettingUp finishes several units downrange — reads as
   "teleported N positions forward". Jitter during the flight on top of that.
2. **Repeated Impacts in quick succession → the Character's mesh is left visibly tilted**
   and doesn't recover to upright.
3. **Dash into a wall → the Ragdoll + GettingUp sometimes plays twice** back to back
   (~2 s of lost control instead of ~1 s).

---

## Root causes (from code)

- **Bug 1:** `RAGDOLL_GROUPS` = `collisionGroups(GROUP_RAGDOLL, GROUP_STATIC)` — ragdoll
  bones collide with static geometry only (file comment already flags this as *"revisit
  only if playtesting says it matters"*). Plus: the client predicts its own 11-body
  ragdoll, which diverges from the server's within a few ticks (ADR 0003), and
  `Ragdoll.snapRootTo` (ticket 05) hard-yanks the pelvis to the server pose every
  snapshot. No surveyed shipping game runs a predicted authoritative articulated ragdoll
  for the local player.
- **Bug 2:** `stepWobble` derives acceleration from render-frame position deltas; a
  reconciliation position snap → huge fake acceleration → lean pinned at
  `WOBBLE_MAX_TILT`. `scene.ts` only re-seeds the wobble while `visualState !==
  "Controlled"` — a `Controlled → snap → Controlled` correction isn't covered, and rapid
  Impacts bring corrections faster than `WOBBLE_SETTLE_RATE` recovers.
- **Bug 3:** `dash → wall → Ragdoll` is predicted locally *and* produced by the server
  ~½ RTT later. `reconcile()` compares the server's **latest** `motionState` against the
  local **current** one (not tick-aligned), so after local recovery a stale-but-still-
  `Ragdoll` snapshot hits `reconcileTo`'s `base.motionState === "Ragdoll" &&
  !isDown(local)` branch → `snapTo("Ragdoll") + beginRagdoll()` with a fresh timer →
  full second knockdown. The research's framing: a snapshot is *the value of a field at a
  tick*, not an *event* — if `motionState` is a replayed field, applying the server's
  tick-T value is idempotent by construction.

---

## Part B — Bug 3: `motionState` as a replayed field, event-ids for server-only knockdowns

Research §2, recommendation Q2.

- [ ] Add `motionState` and `phaseStartTick` (the tick the current motion-state phase
      began) to `SimState.character` / `CharacterSnapshot` as first-class replicated
      state. `phaseStartTick` is what makes "same ragdoll" vs "new ragdoll" decidable.
- [ ] Reconciliation resets these to the server's tick-`lastInputTick` value before
      replay (it already resets the rest of the base per ADR 0013). Then a stale tick-T
      `Ragdoll` snapshot whose `phaseStartTick` the client already predicted is a **no-op**
      — remove the "server says Ragdoll and I'm not down → beginRagdoll()" event path from
      `reconcileTo`; the replayed shared step recomputes the transition from inputs.
- [ ] One-shot side effects (impact SFX hook points, camera kick, speed-lines burst) fire
      only on the **first forward simulation** of a tick, never on a replayed pass — add
      an `isReplaying` flag to the sim/tick context (Fusion's `IsForward` rule).
- [ ] Server-only knockdowns the client cannot predict (**Bump** from another player,
      later: hazards) carry a monotonic `impactSeq` in the snapshot. The client keeps
      `lastAppliedImpactSeq` and applies an impact iff `seq > lastAppliedImpactSeq` —
      stale re-delivery is ignored. (Bump stops being handled by the generic "server
      down, I'm not" path and becomes id-gated.)
- [ ] Keep ADR 0006's guards as the backstop: `GettingUp` uninterruptible, re-entering
      `Ragdoll` doesn't restart the timer, `RAGDOLL_MAX`.
- [ ] **Tests:** a dash-wall Ragdoll reconciled against a stream of stale `Ragdoll`
      snapshots after local recovery does **not** re-enter Ragdoll. A Bump with a fresh
      `impactSeq` snaps to Ragdoll exactly once; the same snapshot redelivered does
      nothing. A Bump the client already applied by id is not re-applied on replay.

---

## Part A — Bug 1: stop predicting the ragdoll body; let it collide with props

Research §1 + §3, recommendation Q1 (option b) + Q3.

### A1 — drive the local ragdoll from server snapshots, not local physics
- [ ] The local player's ragdoll **pose** comes from `SimState.character.bones` +
      `interpolateState` — the exact path ADR 0006 already built for remote Characters.
      The client no longer runs the 11-body ragdoll forward as a predicted authoritative
      body.
- [ ] The knockdown still *feels* instant: `motionState` snaps to `Ragdoll` locally on
      the predicted hit (Part B). Cover the ½-RTT gap before the first `Ragdoll` snapshot
      with a 1-frame hold of the last capsule pose (or a short canned hit-react), then
      cross-fade to the networked bones.
- [ ] Delete `Ragdoll.snapRootTo` and the per-snapshot pelvis hard-snap in `reconcileTo`
      — there are no predicted ragdoll bones left to snap.
- [ ] `replayLocalCharacter` no longer steps an articulated ragdoll per replayed tick
      (ADR 0013's flagged cost) — only the capsule.
- [ ] This changes how the local ragdoll is produced vs. what tickets 03/05 built — **add
      an ADR** (supersedes the implicit "client predicts its own ragdoll"; ADR 0013's
      discrete-snap rule is unchanged, ADR 0006's state machine is unchanged).

### A2 — ragdoll collides with dynamic props (server-side)
- [ ] `RAGDOLL_GROUPS` filter also includes the dynamic-Prop bit (`GROUP_PROP`; consider
      `GROUP_OBSTACLE`). This runs on the server — the authority — so no client/server
      divergence risk.
- [ ] Guardrails from the research: `contactsEnabled = false` on each ragdoll joint
      (jointed neighbours don't jitter); self-collision between non-adjacent bones stays
      **off** for M2; ragdoll rigid bodies get `additionalSolverIterations` ~4–8 and a
      small non-zero `contactSkin`; dynamic-Prop mass clamped to ~1–10× a bone's mass.
- [ ] Ragdoll-vs-ragdoll collision **on** (two players' ragdolls tangling is on-genre) —
      note it as the first thing to cut if the server tick budget blows at the 12-player
      ceiling.
- [ ] `GettingUp` nudges the capsule to a valid nearby position if the settled ragdoll
      ended up inside geometry, so a prop can never pin a Character (with `RAGDOLL_MAX` as
      the time backstop).
- [ ] **Measure:** one profiling pass on the real server with ~6 simultaneous ragdolls
      among props — no primary source quantifies the cost.
- [ ] **Tests:** a ragdoll launched into a Prop ends up within a small radius of the
      Prop, not downrange; the Prop still reacts.

---

## Part D — Bug 2: Wobble survives a correction

Research §4.

- [ ] The `Wobble` deriver detects a render-frame position delta above a threshold (well
      above one frame's skated movement), treats that frame as a teleport: skip it, reset
      the deriver's stored velocity/`previousWobblePosition`, resume next frame. Never
      feed the discontinuity through the wobble spring. Same rule `interpolateState`
      already applies to remote entities on a `motionState` change.
- [ ] After any run of Impacts + corrections the mesh eases back to upright within the
      normal `WOBBLE_SETTLE_RATE` window — never left pinned at `WOBBLE_MAX_TILT`.
- [ ] Fix the animation-state leak: `leavingGettingUp` in `scene.ts` stops the Death
      action but never restores `activeAction`, so the model relies on the next
      `updateCharacterAnimation` to pick a clip — make entering Controlled explicitly
      reset to idle/locomotion.
- [ ] **Tests (client):** `stepWobble` fed a large position jump returns to a
      near-neutral lean within the settle window instead of pinning.

---

## Explicitly NOT in this ticket

Full positional error-smoothing for the capsule transform (still deferred per ADR 0013) ·
non-adjacent ragdoll self-collision · ragdoll bone vs any Character capsule (the capsule
stays the authority for player-vs-player) · CS2-style predicted-ragdoll timeout-revert
(add later only if a duplicate slips past Part B's guards) · reworking Impact thresholds
or dash-into-wall feel.
