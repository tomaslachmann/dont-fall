# 02 — Decide whether `TrackBuilder.tsx` supersedes ADR 0034

**What to build:** A decision (and superseding ADR, if the answer is yes) on whether the Track
builder folds into `apps/client` as a React route, or stays the standalone vanilla-TS app ADR
0034 deliberately chose.

**Blocked by:** nothing (this is the decision itself).

**Status:** planned

## Why

ADR 0034 is explicit: "The Track builder stays a standalone vanilla-TS app... no React. ADR
0008's React-for-Screens decision covers `apps/client` only"
(`docs/adr/0034-track-builder-free-placement.md:48-49`). `TrackBuilder.tsx`
(`test_components/src/screens/TrackBuilder.tsx`), routed at `/builder` in the diff'd `App.tsx`,
folds the builder into `apps/client` as a React screen — exactly the move ADR 0034 declined to
make. ADR 0034 does leave the door open ("folding Track-building into a React [shell]... happens
if/when M4 ships that shell, not before," `docs/research/screens-inventory.md:395-396`) — M4
shipped the shell a while ago, so the precondition for revisiting this now exists. This is a real
architecture call, not a component port.

See `docs/research/test-components-design-screens-gap-analysis.md`, "ADR/architecture conflicts"
§2 and "Backend/domain gaps" (Track builder entry).

## What to change

- [ ] Decide: fold the builder into `apps/client` (superseding ADR 0034), or keep it standalone
      and instead restyle `apps/track-builder`'s own vanilla-TS UI to match the new design
      language (ticket 10 either way)
- [ ] If folding in: what happens to `apps/track-builder`'s existing Rapier-preview/thumbnail
      machinery and its own test suite (`shell.test.ts` etc.) — a migration plan, not just a
      route
- [ ] Record the decision as a new ADR

## Done when

- [ ] A new ADR states which app owns Track building going forward
- [ ] Ticket 10 can start without re-litigating this

## Watch out

- This is a bigger call than it looks: `apps/track-builder` is a separate Vite app with its own
  entry point, tests, and Rapier-preview pipeline (M3 ticket 04/05, M3.5). Folding it in is not a
  file move.
