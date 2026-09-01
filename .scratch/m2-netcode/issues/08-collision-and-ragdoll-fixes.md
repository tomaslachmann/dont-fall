# 08 — Collision & predicted-ragdoll fixes

**What to build:** Fix three ragdoll/collision defects found in M2 playtesting (tickets
03–06 in). All three trace back to the client predicting its own *physics* ragdoll and to
reconciliation treating a discrete state change as an event instead of a tick-aligned
field. Design settled against `docs/research/m2-collision-and-predicted-ragdoll.md`
(primary sources: Source/VDC, CS2 release notes, Halo: Reach GDC 2011, Photon Fusion,
Unity Netcode for Entities, Unreal Networked Physics, Rapier docs/changelog).

**Blocked by:** 05 (reconciliation), 06 (props). Independent of 07.

**Status:** done — Part B (bug 3), Part A2 (bug 1's "through the box" half), Part D (bug
2). **Part A1** (stop predicting the local ragdoll body; drive its bones from server
snapshots) split out to ticket 09 — a real re-architecture that needs its own ADR and a
CS2-style predicted-ragdoll timeout-revert, per the research. The residual jitter of the
predicted ragdoll (bug 1's second half) waits on that.

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

## Part B — Bug 3: predicted knockdowns owned by the client, `bumpSeq` for the rest — DONE

Recorded as ADR 0014 (amends ADR 0013's "any `Ragdoll` snapshot forces a snap" framing for
the local Character specifically).

Research §2, recommendation Q2. (Landed the id-gated event half; the "`motionState` +
`phaseStartTick` replayed field" half is subsumed — the client simply doesn't recompute a
ragdoll during replay, so idempotence isn't needed.)

- [x] Knockdowns the client can mispredict — a **Bump** clearing `IMPACT_STAGGER_MIN`
      (`RapierSimulation.resolveBump`) or a **Fall** at a ledge edge (`detectFall`) —
      advance `CharacterSnapshot.bumpSeq`. A dash-into-wall / Spinner knockdown carries no
      new `bumpSeq` (the client's own machine ran it).
- [x] `reconcileTo` no longer auto-triggers a Ragdoll from `base.motionState`. It takes an
      explicit `forceRagdoll` — the client passes it only on a new `bumpSeq`. A stale
      `Ragdoll` snapshot of a knockdown the client already ran is a no-op (just position
      tracking via `snapRootTo` while both are down).
- [x] Client `reconcile()`: `forceRagdoll = bumped && serverDown`, where `bumped` gates on
      a strictly-rising `server.bumpSeq` (`lastAppliedBumpSeq`). No streak/timeout net —
      the seq gate alone is enough and can't over-fire. (An earlier streak safety net was
      dropped: at high RTT it could re-force the tail of the client's own knockdown, the
      exact bug it was meant to prevent.)
- [x] ADR 0006's guards remain the backstop (`GettingUp` uninterruptible, `RAGDOLL_MAX`).
- [x] **Tests:** a stale `Ragdoll` reconcile with no `forceRagdoll` does not enter Ragdoll;
      a forced Bump enters it once; `resolveBump` advances the target's `bumpSeq` but not
      the mover's; a dash-wall Ragdoll leaves `bumpSeq` at 0.

_Deferred to ticket 09 (Part A1):_ the `isReplaying` / first-forward-sim gate for one-shot
side effects — there are no networked SFX/camera-kick hooks yet, and once the ragdoll is
no longer stepped during replay (ticket 09) the gate is trivial.

---

## Part A1 — stop predicting the ragdoll body → **split to ticket 09**

A real re-architecture (drive the local ragdoll pose from server snapshots; delete
`snapRootTo`; ADR + CS2-style predicted-ragdoll timeout-revert). Research §1. Not done
here.

## Part A2 — ragdoll collides with dynamic props (server-side) — DONE

Research §3.

- [x] `RAGDOLL_GROUPS` filter += `GROUP_PROP`; `PROP_GROUPS` filter += `GROUP_RAGDOLL`.
      Runs on the server (the authority) — clients just interpolate the result.
- [x] Solver guardrails: ragdoll bone bodies get `RAGDOLL_SOLVER_ITERATIONS` (6) extra
      constraint iterations, colliders a small `RAGDOLL_CONTACT_SKIN`. (No joint
      `contactsEnabled` change needed — the ragdoll group still doesn't collide with
      itself, so there is no self-collision to disable.)
- [x] The dash-crash no longer rockets the ragdoll through the box even *with* collision —
      a crash absorbs most forward momentum: `beginRagdoll` scales the inherited velocity
      by `RAGDOLL_IMPACT_VELOCITY_SCALE` (0.2) for any impact-triggered knockdown (a Fall,
      which carries no impact impulse, keeps its velocity).
- [x] Bone mass (0.6–4) vs default Prop mass (4) is already inside the ~1–10× ratio the
      research calls for; noted in `RAGDOLL_IMPACT_VELOCITY_SCALE`'s doc.
- [x] **Test:** a ragdoll dashed into a box crumples near it (pelvis stays within a few
      units), not several units downrange; it still ragdolls; the box still reacts.
- [ ] Ragdoll-vs-ragdoll collision — deliberately **not** enabled for M2 (research §3.3:
      "first thing to cut" at the 12-player ceiling). Follow-up.
- [ ] `GettingUp` un-pins a Character whose settled ragdoll ended up inside geometry —
      follow-up (rare; `RAGDOLL_MAX` is the current backstop).
- [ ] Profiling pass with ~6 simultaneous ragdolls among props — follow-up.

---

## Part D — Bug 2: Wobble survives a correction — DONE

Research §4.

- [x] `stepWobble` itself skips a frame where the render-frame position delta exceeds
      `WOBBLE_TELEPORT_DISTANCE` (1 u — well above the ~0.35 u a full-speed dash covers in
      a 60 fps frame): returns the state unchanged, keeping the last velocity so the next
      frame measures acceleration from a sane baseline. Same "snap through a
      discontinuity" rule `interpolateState` uses for remote entities.
- [x] After a teleport the lean eases back to near-upright within the normal
      `WOBBLE_SETTLE_RATE` window — never pinned at `WOBBLE_MAX_TILT` (test asserts it).
- [x] Animation-state hand-back in `scene.ts` now covers *any* down → Controlled edge
      (`leavingDown`, not just the natural GettingUp → Controlled completion) — stops the
      Death clip, places the rig at the real capsule position, and starts idle so
      `updateCharacterAnimation` has a live `activeAction` to cross-fade from. A
      reconciliation snapping straight from Ragdoll to Controlled (the server rejects a
      knockdown the client mispredicted) skips the GettingUp frame entirely and was
      missing this hand-back — caught in code review, fixed.
- [x] **Test (client):** `stepWobble` fed a large position jump drops that frame entirely
      and recovers to a near-neutral lean over the settle window.
- [x] The bumped player's own ragdoll launch on a forced-Bump reconciliation was silent
      (zero velocity, zero impulse — a limp drop instead of a knockback) because the
      capsule's velocity is zeroed the instant Ragdoll begins and `CharacterSnapshot`
      carries no impulse. Fixed by reporting the ragdoll body's own velocity
      (`Ragdoll.rootVelocity`) as `CharacterSnapshot.velocity` while `Ragdoll` — one tick
      post-impact, so it already reflects the knock. Caught in code review.

**Known follow-ups, not fixed here** (caught in code review, judged out of this ticket's
scope):
- `WOBBLE_TELEPORT_DISTANCE`'s raw-distance heuristic can't distinguish "a real fast dash
  compressed into one render frame after a stall" from "a reconciliation snap" — both
  produce a large frame-to-frame position delta. The fix is to consume an authoritative
  discontinuity signal (the way `interpolateState` does) instead of re-deriving one from
  distance, which needs threading a real "did a reconciliation just happen" flag from
  `main.ts` through to `scene.ts` — a small API change, not a one-line fix.
  **Update (2026-09):** playtesting found the wider version of this — deriving the lean's
  acceleration from render-frame position deltas at all reads as a walking micro-stutter
  once the Character is predicted + reconciled (uneven 30 Hz-tick-at-variable-render-rate
  sampling, on top of the snaps). **Wobble is now disabled** (`WOBBLE_ENABLED = false` in
  `scene.ts`); re-enable once it's driven from a simulation-owned velocity, the same fix
  speed-lines already got in the pre-M2 polish pass.
- ~~A genuine client-side misprediction of its own dash-wall/Spinner knockdown (no `bumpSeq`,
  so no forcing signal) self-corrects only once the server's own Ragdoll episode times out.
  Accepted per ADR 0014 on the strength of ADR 0005's determinism guarantee for the
  deterministic capsule/collision step — revisit if playtesting shows it happening.~~
  **Playtesting did show it happening** (2026-09, up to ~1.9 s of the client walking around
  while the server held it Ragdoll) — fixed by ticket 10 / ADR 0015: the client never
  decides on its own when a knockdown ends, so the server's report is always accepted
  unconditionally, no `bumpSeq` needed.

---

## Explicitly NOT in this ticket

Full positional error-smoothing for the capsule transform (still deferred per ADR 0013) ·
non-adjacent ragdoll self-collision · ragdoll bone vs any Character capsule (the capsule
stays the authority for player-vs-player) · CS2-style predicted-ragdoll timeout-revert
(add later only if a duplicate slips past Part B's guards) · reworking Impact thresholds
or dash-into-wall feel.
