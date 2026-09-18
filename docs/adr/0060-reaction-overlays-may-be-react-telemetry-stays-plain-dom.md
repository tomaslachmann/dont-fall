# 0060 — Reaction overlays may be React; every-frame telemetry stays plain DOM

> **Superseded in part by ADR 0088 (2026-09-17):** the Round HUD — `RaceHUD.tsx`
> included — is now a React overlay too, fed deduplicated display values rather
> than per-frame ones. The event-feedback contract below stands.
>
> **Amended 2026-09-18 (the user's call):** the incoming-Hit flash splits by
> outcome. A Hit that leaves you standing is only a light red tint at the edges,
> for 0.6 s, with no word on screen (a screen-reader label only), no crack and
> no black snap. A knockout keeps the whole flash: KNOCKED DOWN, the snap, the
> bleed and the bloom. Its crack now paints itself from the point of impact,
> trunk, branch and hairline in turn, then holds and fades over 1.6 s.

## Context

ADR 0008 is explicit: "The HUD... stays plain DOM, drawn by the game itself. It
updates every frame and has no place in a component tree."
`apps/client/src/hud/hud.ts` quotes this verbatim, and the in-match overlay
(telemetry text, pointer-lock prompt, countdown banner) honors it.

Meanwhile production grew four React overlays over the live `<GameCanvas>` —
Countdown, FinishedOrOut, the Spectator panel, BetweenRounds (`GameCanvas.tsx`'s
`screenOverlay` slot) — each driven by a discrete phase or event edge, none by
per-frame state. ADR 0051 blessed the Countdown-shaped half of this ("Only
Countdown and Running ever show the live Match") without ruling on the
React-vs-DOM question itself.

M9 ticket 01 (`.scratch/m9-design-screens-reconciliation/issues/01-decide-the-hud-boundary-for-reaction-overlays.md`)
existed to settle exactly this for the reaction overlays (Hit taken, Dash,
Ragdoll get-up, Grab): decide from ADR 0008's original reasoning, not from
"the mock happens to be React."

## Decision

**Every-frame telemetry stays plain DOM; occasional event feedback may render
as React overlays over the live canvas.** The line is update cadence, which is
ADR 0008's own reasoning ("updates every frame and has no place in a component
tree"):

- Stays plain DOM in `hud.ts`: anything recomputed per rendered frame
  (telemetry text, prompts, banners tracking live values). `RaceHUD.tsx`'s
  wholesale duplication of the HUD as a routed component stays out of scope
  for any carve-out — it is per-frame telemetry wearing a component tree.
- May be React in the `screenOverlay` slot: feedback fired off a discrete sim
  edge (a verdict, a phase entry, an Epoch rise), mounted on the edge and
  dismissed by phase change or a display timer. It must render no Stage
  background/field/sheen (the Countdown rule: the live game stays visible
  underneath) and must be pointer-transparent where it floats over live
  gameplay.

The first instance is the incoming-Hit flash (M9 ticket 09, Hit-received):
fired off the local Character's `hitReactEpoch` rising, reading YOU GOT HIT
(or KNOCKED DOWN when the same snapshot downs with cause `"Hit"`), dismissed
after one beat.

## Considered options

- **Everything in-match stays plain DOM, no exceptions** — rejected: it would
  require rebuilding four shipped overlays (Countdown included) as DOM for no
  behavioral gain, against the Countdown/Running-live-match shape ADR 0051
  already settled.
- **Reaction overlays as plain DOM alongside `hud.ts`, new code only** —
  considered: keeps one technology for everything in-match, but splits the
  overlay surface in two (four React precedents plus new DOM siblings) and
  abandons the tested `screenOverlay` slot for styling the design system
  already expresses as components.
- **Full React HUD including telemetry** — rejected outright: it is exactly
  what ADR 0008 forbids, and per-frame React re-renders of telemetry would
  reintroduce the cost the plain-DOM rule exists to avoid.

## Consequences

- M9 ticket 01 is decided; this ADR is its record.
- The rest of M9 ticket 09 (Dash feedback, Ragdoll get-up, Grab hold —
  Hit-received already landed on this contract) builds React overlays the
  same way: discrete sim edge in, no Stage chrome, pointer-transparent,
  timer-or-phase dismissal.
- `hud.ts` keeps its contract unchanged — the next per-frame readout still
  goes there, never into a component.
