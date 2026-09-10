# 01 — Decide the HUD boundary for in-match reaction overlays

**What to build:** An ADR decision (superseding or clarifying ADR 0008) on whether Hit/Dash/
Ragdoll/Grab reaction feedback (`HitFeedback.tsx`, `DashFeedback.tsx`, `Ragdoll.tsx`,
`Grabbed.tsx` in `apps/client/src/test_components/src/screens/`) must stay plain DOM like the
rest of the HUD, or gets the Countdown/Spectate precedent — a React overlay sitting on top of a
live `<GameCanvas>` (ADR 0051's "content over a live scene" carve-out).

**Blocked by:** nothing (this is the decision itself).

**Status:** planned

## Why

ADR 0008 is explicit and unambiguous: "The HUD... stays plain DOM, drawn by the game itself. It
updates every frame and has no place in a component tree" (`docs/adr/0008-react-for-screens.md:10-12`).
`apps/client/src/hud/hud.ts:1-11`'s own docstring quotes this verbatim. `RaceHUD.tsx`
(`test_components/src/screens/RaceHUD.tsx:28-77`) is a routed React component rendering exactly
the per-frame telemetry — position, clock, checkpoint pips — ADR 0008 says must never be a
component. Ticket 09 (the real reaction-overlay build) cannot start until this is settled, because
"React or plain DOM" changes the shape of that work entirely, not just its styling.

See `docs/research/test-components-design-screens-gap-analysis.md`, "ADR/architecture conflicts"
§1.

## What to change

- [ ] Grill/decide: does ADR 0008's plain-DOM rule extend to per-event reaction overlays (Hit
      landed, Dash charged, Grab held, Ragdoll get-up), or is there a principled line between
      "every-frame telemetry" (stays plain DOM) and "occasional event feedback" (may be React)?
- [ ] Record the decision as a new ADR (or an amendment noting what ADR 0008 still covers and
      what it doesn't)
- [ ] `RaceHUD.tsx` itself is out of scope for a carve-out — it duplicates `hud.ts`/`hudText.ts`
      wholesale and has no reason to exist as a second implementation; the decision is about the
      *reaction* overlays only, not the whole HUD

## Done when

- [ ] A new or amended ADR states, in one sentence, which in-match feedback may render as React
      and which must stay plain DOM
- [ ] Ticket 09 can start without re-litigating this

## Watch out

- Don't let "the mock happens to be React" bias the decision — decide from ADR 0008's original
  reasoning (every-frame, no place in a component tree), not from what's already built.
