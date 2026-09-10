# 10 — Implement the Track builder's design-system fate

**What to build:** Whichever direction ticket 02 decides — either restyle `apps/track-builder`'s
own vanilla-TS UI to match the new design language, or fold Track building into `apps/client` as
a React screen.

**Blocked by:** ticket 02.

**Status:** planned

## Why

This is pure follow-through on ticket 02's decision — listed separately because it's sizable
either way (a full UI restyle of a standalone app, or migrating a whole app's worth of
Rapier-preview/save/publish machinery into `apps/client`) and shouldn't be bundled into the
decision ticket itself.

See `docs/research/test-components-design-screens-gap-analysis.md`, "ADR/architecture conflicts"
§2.

## What to change

- [ ] If staying standalone: restyle `apps/track-builder`'s existing DOM/CSS to match
      `TrackBuilder.tsx`'s visual design, without adopting React (ADR 0034 stands)
- [ ] If folding in: migrate `apps/track-builder`'s placement UI, thumbnail rendering, and
      save/publish flow into an `apps/client` React screen, port its test suite
      (`shell.test.ts` and friends), and formally supersede ADR 0034
- [ ] Either way, the M8.1 ticket 04 Playtest flow (publish-first, opens
      `/play?track=X&freeroam=1`) must keep working unchanged

## Done when

- [ ] Live-verified: place Modules, save, publish, playtest — full author loop works exactly as
      today, with the new visual design
- [ ] Typecheck clean; the builder's existing test suite passes (migrated or in place)

## Watch out

- If folding in: this is the highest-risk ticket in the wiring group for silently breaking
  something, given how much standalone machinery `apps/track-builder` owns. Budget real time for
  it, don't treat it as "just move the files."
