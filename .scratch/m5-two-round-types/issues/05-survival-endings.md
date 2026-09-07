# 05 — A Survival Round ends

**What to build:** Survival's two endings, reusing M4's machinery rather than inventing more.

A Survival Round ends when the **Survivor Target** is reached — how many Players it leaves standing
(CONTEXT.md) — or when the Time Limit expires, whichever first. Everyone still standing Qualifies.
This is deliberately the same shape as M4 ticket 05's Race endings, which is the point: if Survival
needs a third mechanism, the seam is in the wrong place.

The Survivor Target is the parameter that makes one Round type serve a whole Match: cut a large
field early, decide a winner last. It resolves like everything else (ADR 0041) — the Track's
default under the Round's override.

**Blocked by:** 04.

**Status:** done

- [x] The Round ends when survivors reach the Survivor Target, or the clock expires — whichever
      first. `RoundRules.survivorTarget: number` (Track default `DEFAULT_SURVIVOR_TARGET = 1`,
      resolved the same `resolveRoundRules` mechanism as everything else); `survivorTargetReached`
      (`Qualification.ts`) counts non-eliminated Characters against it. `matchLoop.ts` feeds it (or
      `allQualified`, for a Race) into the identical `advanceMatchPhase` RUNNING → ROUND_END call
- [x] Everyone still standing when it ends Qualifies; `finishTick` needs no wire change, because it
      is already a Tick rather than a boolean. `RapierSimulation.qualifySurvivors(tick)` — a new
      match-authority-only method, called exactly once, the Tick the transition happens, before
      that same Tick's snapshot is built, so survivors show as Qualified in it immediately
- [x] Expressed as a Survival-shaped ending alongside the Race's, not as a third mechanism —
      `advanceMatchPhase` itself is untouched (still takes one `allQualified: boolean`);
      `matchLoop.ts` is the only thing that knows which Round-shaped answer to compute, from
      `roundRules.fallBehavior`
- [x] The Race's endings are untouched, pinned by M4's tests — full pre-existing suite passes with
      no changed assertions. Two new server-level integration tests exercise Survival's own two
      endings end-to-end (a real disconnect triggering an early Survivor-Target ending; a real
      clock expiry with everyone still standing), backed by unit tests for
      `survivorTargetReached` and `qualifySurvivors`
- [x] (Beyond the checklist) Since ticket 07's Lobby Round-type picker doesn't exist yet, added
      test-only `fallBehaviorOverride`/`survivorTargetOverride` server config knobs (mirroring
      `timeLimitMsOverride`'s own existing precedent) so this ticket's own server-level tests can
      exercise a real Survival Round without waiting on ticket 07
- [x] (Found by code review, `high` effort) A Character already Qualified by `qualifySurvivors`
      could be retroactively marked eliminated too if residual ragdoll momentum (or, in the added
      test, a reconciled position) carried it below the kill plane afterward — `detectFall` never
      checked `finishTick`. Fixed: `detectFall` now returns immediately once `finishTick !== null`
      — an already-Qualified Character has nothing left for a Fall to change, in either Round type
- [x] (Found by code review) `roundRules.fallBehavior === "eliminate"` was checked independently
      at two call sites in `matchLoop.ts`'s own tick handler; consolidated into one `isSurvival`
      read so the two can never silently disagree
- [x] (Found by code review) `DEFAULT_SURVIVOR_TARGET`'s own doc comment overclaimed parity with
      `DEFAULT_TIME_LIMIT_MS`'s bounds enforcement (`MIN_`/`MAX_TIME_LIMIT_MS`, checked by
      track-service on publish) when no such bounds exist yet for `survivorTarget` — corrected to
      say so plainly; real bounds are ticket 07's own design question once it gives this field a
      real input to validate
- [x] (Found while chasing a flaky server test the review also flagged) `updateFinishZone` — the
      Race-only mechanism for granting Qualification — ran unconditionally, with no Round-type
      gate at all. Since Survival currently has to run on an ordinary, possibly Finish-Zone-
      carrying Track (ticket 06's dedicated arena doesn't exist yet), a Character could Qualify by
      simply walking to the finish line, bypassing `qualifySurvivors`/the Survivor Target entirely
      — exactly what made one of this ticket's own server tests intermittently fail depending on
      which Track track-service's shared `/tracks/any` happened to hand back. Fixed: skipped
      outright when `fallBehavior === "eliminate"`, pinned by a new unit test walking straight
      through a Finish Zone under Survival rules and confirming it never Qualifies that way
