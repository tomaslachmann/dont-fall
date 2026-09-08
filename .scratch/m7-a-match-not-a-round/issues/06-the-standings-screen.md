# 06 — The Standings Screen

**What to build:** The Screen between Rounds and at the end of a Match — the Round just played, next
to everyone's running Score.

**Blocked by:** ticket 04 (nothing to stand between). Also needs the visual design below.

**Status:** blocked

## Why

`returnToLobby` after every Round is a button someone has to press, and party games die in the gaps
where everyone waits for the host. ADR 0049 replaces it with a Screen that advances itself.

This Screen is also where **Bet** results will land later (`CONTEXT.md`: a Bet is "a prediction an
eliminated Player makes in Spectator Mode"), so its shape matters beyond M7.

**Visual design:**
<https://claude.ai/code/artifact/6f59296b-63c8-48ae-937e-88a43b15e9f4?org=51b43cec-3008-499c-adb6-1ae9a8b9abae>

Read it before building. The repo has no prior design for this Screen —
`docs/research/screens-inventory.md:96` lists live standings among M4's exclusions and
`m4-screens-visual-design.md:192` among its deferrals.

## What to change

- [ ] A `StandingsScreen`, alongside `LobbyScreen` / `ResultsScreen` / `MainMenuScreen`, React and
      routed like them (ADR 0008)
- [ ] Shows the Round just played — the existing Results ranking — and every Player's running Score
      from `matchScore`, computed client-side from the replicated results (ADR 0049: Score is
      derived, never sent)
- [ ] Between Rounds it advances into the next `COUNTDOWN` on its own, once the next Track has
      loaded. The server owns the transition (ADR 0040); the Screen renders the wait, it does not
      time it
- [ ] On the last Round it names the winner and offers the host the return to the Lobby
- [ ] `ResultsScreen` is either absorbed or reduced to the Round-ranking part this Screen embeds —
      two Screens showing the same table is how they drift

## Done when

- [ ] Component tests: the same Screen renders the between-Rounds state and the Match-end state, and
      only the latter shows a winner and a return-to-Lobby control
- [ ] A Player who dropped mid-Match is still listed with their parked Score (ticket 08)
- [ ] Ties render as ties — two Players on one placement are not silently ordered
- [ ] The menu bundle does not grow: ADR 0008 and `codeSplitBoundary.test.ts` still hold
- [ ] **Live:** two browsers watch the Standings between Rounds one and two, see the same numbers,
      and are carried into the next Countdown without either of them clicking anything

## Watch out for

**Do not put the scoring formula in the Screen.** It is `matchScore` from ticket 03. A Screen that
does its own arithmetic is a Screen that will disagree with the server's winner.

**The wait is not fixed-length.** "Once the next Track has loaded" is a real dependency, not a
timer — a slow track-service fetch must show the Standings longer, not cut it short and start a
Countdown against an unloaded Track.

**HUD is not a Screen** (ADR 0008). A live standings overlay *during* a Round is a separate,
explicitly deferred idea (`screens-inventory.md:85`) — not this ticket.
