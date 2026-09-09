# 12 — Standings redone: the Ready gate, independent Match-end exit

**What to build:** Rework `StandingsScreen`'s footer for ADR 0051 — a "Ready for next Round" button
(ticket 10) with a per-Player confirmed/not-yet indicator between Rounds, and an unconditional,
per-Player "Main Menu" action at Match end, replacing the host-only "Back to Lobby." The artifact's
podium + personal-outcome-banner rebuild for the "Round just played" panel is **split out to ticket
13** — real scope (Three.js/GLTFLoader inside a Screen, crossing the code-split boundary) that
doesn't block this ticket's own mechanic.

**Blocked by:** ticket 09 (non-live surface), ticket 10 (the Ready message this screen sends),
ticket 11 (Loading is what Ready hands off to).

**Status:** implemented — live verification pending; podium/banner split to ticket 13

## Why

ADR 0051 changes both the between-Round and Match-end behavior of the Screen ticket 06 shipped:
gate the advance on confirmation (not a bare auto-advance message) and drop the host-only "go back
to Lobby" for an unconditional per-Player exit.

## What to change

- [x] **Between-Round footer.** Replaced "More Rounds to play — advancing automatically…" with a
      "Ready for next Round" button (ticket 10's `standingsReady` message) plus a per-Player
      confirmed/not-yet indicator (`Row` + `ActivityDot`, the Lobby's own presence-dot language, not
      a new one). Sending it hands off to `LoadingScreen` (ticket 11, wired in `GameCanvas.tsx`).
- [x] **Match-end footer.** Replaced the host-only `onReturnToLobby`/"Back to Lobby" with an
      unconditional "Main Menu" action any Player can click independently — wired through a new
      `goToMainMenu` in `GameCanvas.tsx` onto `onMatchEnd` (declared since M4 ticket 01, never
      raised until now; `App.tsx` now wires it to `navigate("/")`, same as `onExit`).
- [x] **DNF row border color — investigated, not changed.** The audit flagged real `Row.dnf`
      recoloring its border to `--df-color-fall` where the artifact leaves it unrecolored. Read
      `Row.module.css`'s own comment on that line: it's a deliberate, reasoned later revision
      ("§2.5's own anti-slop line... the one place color legitimately marks this row"), not drift.
      Left alone — the audit found a discrepancy, not a defect.
- [ ] **Podium + `<PersonalResultBanner>` — split to ticket 13.** Real scope of its own (Three.js
      GLTFLoader inside a Screen, the code-split boundary, an SVG fallback) that would have
      bundled two very different kinds of work into one commit.

## Done when

- [x] Component tests: the Ready button fires the new message; the Match-end Main Menu button is
      available to every Player (not just the host) and fires independently.
- [x] `codeSplitBoundary.test.ts` still holds — nothing in this ticket's own diff touches the
      game/render bundle at all.
- [ ] **Live:** two browsers — clicking Ready on one does not advance the other until it also
      clicks (or the timeout fires); at Match end each browser independently leaves to the Main
      Menu without affecting the other.

## Implementation notes

`StandingsScreenProps` dropped `isHost`/`onReturnToLobby`, gained `onStandingsReady`/`onMainMenu`.
`StandingsRow` (`game/index.ts`) gained `confirmed: boolean`, read off a new replicated
`SnapshotMessage.standingsReady: string[]` (Round-scoped exactly like `dnf`, populated in
`matchLoop.ts` from `MatchRuntime.standingsReady`) — without this the Screen had no way to show
progress or confirm a Player's own click actually registered, so it's load-bearing, not polish.
`GameCanvas.tsx` never renders a "waiting for others" sub-state on `StandingsScreen` itself: the
instant this client's own Ready fires, it swaps straight to `LoadingScreen` (ticket 11).

Verification: `packages/shared`/`apps/server`/`apps/client` typecheck clean across the whole
monorepo; `packages/shared` (652), `packages/ui` (21), `apps/client` (302, including the rewritten
`StandingsScreen.test.tsx`) all green. Server-side `standingsReady` replication is protocol/server
work covered by ticket 10's own (unrunnable-here) socket tests.

## Watch out for (for ticket 13, carried forward)

**Don't build a second copy of `characterModel.ts`'s GLTF-loading logic for the podium.** Reuse it.

**The podium's own Three.js scene must not become a view into the live Match.** It's a small,
self-contained render (like the artifact's own embedded demo), independent of the actual running
simulation — ticket 09's "no live Match behind the Screen" rule stays intact; this is a *different*,
deliberately separate 3D scene, not an exception to that rule.

**Reuse `matchScore`/`matchWinner` exactly as ticket 06 left them** — the podium and banner are new
presentation over old, already-correct data. Do not recompute placement or Score anywhere in that
ticket; the "no arithmetic in the Screen" rule from ticket 06 still applies.
