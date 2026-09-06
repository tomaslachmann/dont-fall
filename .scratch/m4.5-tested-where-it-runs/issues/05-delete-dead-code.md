# 05 — Delete what nothing calls

**What to build:** Deletions only.

- `RapierSimulation`'s renderer accessors (`getStatics`/`getCheckpoints`/`getSpinners`/`getProps`)
  and their clone helpers are dead in production — the renderer builds from `resolveTrack`, not
  from the authoritative simulation. Roughly forty lines that suggest a coupling that does not exist.
- `playground.ts` is exported from shared's public index. It is a test fixture, not API.
- `advanceFixed` / `FixedSimulation` are production-dead. Decide: widen them to a real caller, or
  delete them. Do not leave them undecided a third time.

**Blocked by:** None.

**Status:** done

- [x] The dead accessors and clone helpers are gone — `getStatics`/`getCheckpoints`/`getSpinners`/
      `getProps` and their `clone*` helpers, plus the one test that existed only to exercise them
- [x] `playground.ts` is no longer public API — dropped from `packages/shared`'s index, given its
      own `package.json` subpath export (`@dont-fall/shared/playground.js`, matching the
      `./design/tokens.css` precedent) for the three test files that use it across a package boundary
- [x] `advanceFixed`/`FixedSimulation` — kept, not deleted: `RapierSimulation` already implements
      `FixedSimulation`, and `game.ts`'s own frame loop hand-duplicates `advanceFixed`'s exact
      accumulator/clamp logic in its own comments ("same guard as `advanceFixed`") without calling
      it. Ticket 02, landing next in this same session, is the real caller this was built for —
      deleting it days before its own consumer arrives would be the opposite of progress
- [x] Full suite green with no changed assertions
