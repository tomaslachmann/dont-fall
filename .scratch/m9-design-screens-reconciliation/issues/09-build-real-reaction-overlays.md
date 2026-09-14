# 09 — Build the Hit/Dash/Ragdoll/Grab reaction overlays against real mechanics

**What to build:** In-match reaction feedback for Hit, Dash, Ragdoll get-up, and Grab, styled on
`HitFeedback.tsx`/`DashFeedback.tsx`/`Ragdoll.tsx`/`Grabbed.tsx` but redesigned around what the
simulation actually does — this is not a reskin.

**Blocked by:** ticket 01 (plain-DOM-vs-React decision determines the implementation shape
entirely) — decided, see ADR 0060.

**Status:** in progress — Hit-received landed (see below); Dash feedback,
Ragdoll get-up, and Grab hold still pending.

## Hit-received (landed)

Fired off your own `hitReactEpoch` rising on the authoritative snapshot
(`game/hitTaken.ts`, pure `detectHitTaken`, mirrored on the `runEnd`
pattern); `onHitTaken` wired through the loop in `game/index.ts`;
`HitFeedback.tsx` flashes in GameCanvas's `screenOverlay` slot for one beat
(`HIT_FLASH_MS = 1000`, GO! cadence), keyed per landing so back-to-back Hits
replay. Reads YOU GOT HIT, or KNOCKED DOWN when a fresh down episode with
`ragdollCause "Hit"` lands (with the Hit edge in one gap, or the gap after
— the landing and the deferred Ragdoll entry resolve on consecutive ticks,
never the same one) — the only two things the sim says about an incoming
Hit. Attacker name/avatar, direction wedge, damage, combo, and the
stagger meter from the mock stay unbuilt per this ticket's own rule (no such
mechanics exist); attacker attribution would need a protocol change
(replicating the striker id) and is flagged as follow-up, not UI work.
Live verification with two browsers still outstanding (sandbox denies
binding sockets).

## Why

Every one of these four mocks depicts a mechanic that doesn't exist in `packages/shared`:

- `HitFeedback.tsx` invents a damage number, combo counter, and a "stagger, one more and you
  ragdoll" meter. Real Hit (`HitController.ts`, `hitChargeMs` in `CharacterController.ts:1278`)
  is a single charge-fraction-scaled impulse (`RapierSimulation.ts:548`,
  `hitImpactMagnitude`) that either knocks down or doesn't — no persistent damage/HP or combo
  state anywhere.
- `DashFeedback.tsx` shows 2-of-3 stored, independently-recharging dash charges. Real Dash
  (`DashController.ts`) is **one** charge on a single cooldown
  (`DASH_COOLDOWN_MS = 1500`, `DashController.ts:11-77`).
- `Ragdoll.tsx`'s "GET UP — MASH SPACE" is a player-input minigame. Real `GettingUp`
  (`CharacterStateMachine.ts:25`) is uninterruptible and timer-driven: "`GettingUp → Controlled
  (after GETUP_TICKS — uninterruptible…)`".
- `Grabbed.tsx` shows a mash-to-break-free progress meter. `GrabController.ts:18-33` has no
  escape/struggle mechanic — only a hold plus a post-release cooldown.

Wiring these mocks in as-is would mean building four new gameplay mechanics the sim doesn't have,
disguised as a UI ticket. The real task is designing feedback for the mechanics that exist.

See `docs/research/test-components-design-screens-gap-analysis.md`, screen rows 1c/1s/1t/1u and
"Backend/domain gaps" (Hit/Grab/Ragdoll entry).

## What to change

- [ ] Design (not port) feedback for: a single Hit charge-and-release (no damage/combo), a single
      Dash charge-and-cooldown (no multi-charge stock), a timer-driven uninterruptible get-up (no
      mash-to-fill), a Grab hold with its real cooldown (no escape struggle)
- [ ] Source every value from real replicated state (`hitChargeMs`, Dash's cooldown timer,
      `GrabController`'s hold/cooldown state, `CharacterStateMachine`'s current state) — nothing
      hardcoded or invented
- [ ] Implementation shape (plain DOM vs React) follows ticket 01's decision

## Done when

- [ ] Live-verified: charging and releasing a Hit, dashing, getting knocked down and getting up,
      and grabbing/being grabbed all show feedback that matches what actually happened, with
      nothing implying a mechanic (damage numbers, combo, multi-charge, escape struggle) that
      isn't real
- [ ] Typecheck clean

## Watch out

- This is the largest and most design-heavy ticket in the batch — treat it as its own small
  design pass per mechanic, not a single afternoon's reskin.
