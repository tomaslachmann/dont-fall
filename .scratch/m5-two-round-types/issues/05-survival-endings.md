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
