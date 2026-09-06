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

**Status:** blocked

- [ ] The Round ends when survivors reach the Survivor Target, or the clock expires — whichever first
- [ ] Everyone still standing when it ends Qualifies; `finishTick` needs no wire change, because it
      is already a Tick rather than a boolean
- [ ] Expressed as a Survival-shaped ending alongside the Race's, not as a third mechanism
- [ ] The Race's endings are untouched, pinned by M4's tests
