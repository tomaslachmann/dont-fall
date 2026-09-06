# 05 — Delete what nothing calls

**What to build:** Deletions only.

- `RapierSimulation`'s renderer accessors (`getStatics`/`getCheckpoints`/`getSpinners`/`getProps`)
  and their clone helpers are dead in production — the renderer builds from `resolveTrack`, not
  from the authoritative simulation. Roughly forty lines that suggest a coupling that does not exist.
- `playground.ts` is exported from shared's public index. It is a test fixture, not API.
- `advanceFixed` / `FixedSimulation` are production-dead. Decide: widen them to a real caller, or
  delete them. Do not leave them undecided a third time.

**Blocked by:** None.

**Status:** ready-for-agent

- [ ] The dead accessors and clone helpers are gone, or a real caller is named in the commit
- [ ] `playground.ts` is no longer public API; tests import it directly
- [ ] `advanceFixed`/`FixedSimulation` are either used or deleted, and the commit says which and why
- [ ] Full suite green with no changed assertions
