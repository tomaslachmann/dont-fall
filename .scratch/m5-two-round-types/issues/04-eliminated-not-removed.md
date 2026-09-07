# 04 — An eliminated Character is marked, not removed

**What to build:** Elimination that does not disturb the world for everyone still playing.

Per ADR 0042: the Character's entry stays in the collection and its body stays in the world with
its collider disabled, so the simulated set and the iteration order never vary. It is not stepped —
the per-Character work is skipped, so an eliminated Character costs an iteration and a branch, not
a controller sweep.

**This also fixes a live flaw.** M4 ticket 05's disconnect path calls `removeCharacter` mid-Round,
which takes a rigid body out of the world and changes contact resolution for everyone still
racing. It is rare enough that nothing has noticed. Same fix, same ticket.

The client needs almost nothing: it already refuses to mirror players who are down, and eliminated
players go through that same path.

**Blocked by:** 03.

**Status:** done

- [x] An eliminated Character is marked; its body stays, its collider does not —
      `CharacterProgress.eliminated`, replicated as `CharacterSnapshot.eliminated`. Going down is
      immediate and synchronous (`CharacterController.eliminateNow`: `machine.snapTo("Ragdoll")` +
      `beginRagdoll()`, which disables the collider) — not the state machine's usual deferred
      `forceRagdoll`, because there is no next `beginTick` left to land it on
- [x] It is not stepped, and the saving is real — not a controller sweep per corpse per tick.
      `RapierSimulation.tick`'s two per-Character loops both `continue` on `progress.eliminated`
      before calling `beginTick`/`endTick` or any Checkpoint/Fall/pad detection
- [x] A mid-Round disconnect stops removing the Character from the simulation — a new
      `RapierSimulation.eliminateCharacter(id)` the server's `close` handler calls instead of
      `removeCharacter`, but only while `match.phase === "RUNNING"` (matching the existing DNF
      condition exactly); outside RUNNING nothing relies on the body, so a plain removal stays
      correct and cheaper
- [x] The client does not mirror eliminated Characters, reusing the down-player path — needed
      literally nothing: an eliminated Character's `motionState` is always `Ragdoll` and never
      recovers (it is never stepped again), so `game/index.ts`'s existing `isDownMotionState`
      mirror-skip already excludes it
- [x] Nobody can shove a corpse, and a corpse cannot shove anybody — its capsule collider (the only
      thing that ever collides with another live Character; `RAGDOLL_GROUPS` already excludes
      `GROUP_CHARACTER`) is disabled and never re-enabled once eliminated
- [x] (Found during implementation, not on the original checklist) Code review on ticket 03 caught
      a real bug this ticket's own mechanism fixes as a side effect: without "not stepped at all,"
      the state machine's unconditional Ragdoll→GettingUp→Controlled timers would eventually cycle
      an eliminated Character back to `Controlled` while still falling, re-triggering `detectFall`
      forever. A new long-running test (well past `RAGDOLL_MAX_MS + GETUP_MS`) pins that this can
      no longer happen
- [x] (Found during implementation, not on the original checklist) `allQualified` — the condition
      that ends a Race early — used to require *every* entry in `state.characters` to have
      `finishTick` set. Since an eliminated Character (a mid-Round disconnect) now stays in that
      collection forever without one, it would have held every future Race open for the rest of
      its Time Limit the instant anyone disconnected. Fixed by treating "eliminated" as resolved,
      same as "Qualified," for this one check — pinned by both a unit test and a real
      two-Player-drop-then-the-other-Qualifies server integration test
