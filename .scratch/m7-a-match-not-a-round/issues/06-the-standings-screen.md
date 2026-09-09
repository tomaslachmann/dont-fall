# 06 — The Standings Screen

**What to build:** The Screen between Rounds and at the end of a Match — the Round just played, next
to everyone's running Score.

**Blocked by:** ticket 04 (nothing to stand between). Also needs the visual design below.

**Status:** superseded by ADR 0051 — live verification found this shipped to a stale spec (a
verbal supersession of ADR 0049's auto-advance line, and the artifact's actual Results design,
neither of which had ever been written down). The rework is tickets 09-12. This file stays as the
record of what actually shipped under this ticket; do not re-open it.

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

- [x] A `StandingsScreen`, alongside `LobbyScreen` / `ResultsScreen` / `MainMenuScreen`, React and
      routed like them (ADR 0008)
- [x] Shows the Round just played — the existing Results ranking — and every Player's running Score
      from `matchScore`, computed client-side from the replicated results (ADR 0049: Score is
      derived, never sent)
- [x] Between Rounds it advances into the next `COUNTDOWN` on its own, once the next Track has
      loaded. The server owns the transition (ADR 0040); the Screen renders the wait, it does not
      time it
- [x] On the last Round it names the winner and offers the host the return to the Lobby
- [x] `ResultsScreen` is either absorbed or reduced to the Round-ranking part this Screen embeds —
      two Screens showing the same table is how they drift

## Done when

- [x] Component tests: the same Screen renders the between-Rounds state and the Match-end state, and
      only the latter shows a winner and a return-to-Lobby control
- [x] A Player who dropped mid-Match is still listed with their parked Score (ticket 08)
- [x] Ties render as ties — two Players on one placement are not silently ordered
- [x] The menu bundle does not grow: ADR 0008 and `codeSplitBoundary.test.ts` still hold
- [ ] **Live:** two browsers watch the Standings between Rounds one and two, see the same numbers,
      and are carried into the next Countdown without either of them clicking anything

## Implementation notes

**The linked visual design artifact has no Standings mockup.** It's the M4-era "Screens Test"
(Lobby/Results podium/Settings/Countdown/Bet) — grepped for "Standing"/"matchScore"/"winner" and
found none. Confirmed with the user before building; built from established patterns instead:
`ResultsScreen`'s own ranked-list panel (`Row`/`Panel`, gold/silver/bronze medal classes) reused
verbatim for "This Round", a second `Row`-based panel added for "Match Score", and the winner
banner reuses `<ExtrudedText>` (already a real `packages/ui` component, used for the wordmark)
colored with `--df-color-go`/`--df-color-go-depth` — Go-green, not Host-gold, since a Match winner
and "host authority" are a different role even though both are "first."

**Data layer** (`apps/client/src/game/index.ts`): `onResults` renamed `onStandings`, now carrying a
`StandingsSnapshot` (`results` — unchanged — plus `standings: StandingsRow[]` and `winners:
MatchWinner[]`). `standings` is built from `matchScore(message.roundResults)` — the arithmetic is
never reimplemented in the Screen, only laid out for display and tie-ranked via the existing
`rankWithTies` — unioned with currently-connected `lobby.players` (so a 0-score joiner still shows)
and tagged `gone` per ticket 08's own contract: "appears in some `RoundResult`'s rows AND is absent
from `lobby.players`". Nicknames for a Player who's since dropped come from a new session-scoped
`knownNicknames` map (id → nickname, updated from `lobby.players` and `dnf` every snapshot, never
cleared) — `RoundResultRow` itself carries no nickname, and `dnf` is Round-scoped, cleared each
fresh Countdown.

**`ResultsScreen` was absorbed, not reduced** — deleted outright; `StandingsScreen` embeds its exact
ranked-list markup as one of its two panels rather than composing the two components, since nothing
else ever rendered `ResultsScreen` on its own.

**Verification actually run here:** `apps/client` typecheck clean, full monorepo typecheck clean,
`apps/client` test suite green (271 tests, including 11 new `StandingsScreen` tests covering the
between-Rounds/Match-end split, ties, and a gone Player), `codeSplitBoundary.test.ts` still green.
`/code-review` (medium) ran clean, no findings. No sockets involved on the client side, so nothing
here shares ticket 08's sandbox-networking gap — but the **Live** check below is still genuinely
unverified (needs two real browsers).

**Note on git history:** while this was in progress, a concurrently-running session sharing this
same working directory committed unrelated M8 work and, in doing so, swept this ticket's
then-uncommitted `game/index.ts` changes (`onStandings`/`StandingsSnapshot`) and the `ResultsScreen`
deletion into its own commits (`708408f`, `a6247ce`) rather than into a ticket-06 commit. Not
rewritten here — `main` was already 15 commits ahead of `origin/main` under active concurrent
development, and rebasing shared history out from under another session is a worse outcome than a
misattributed commit. Only the remaining files (`GameCanvas.*`, the new `StandingsScreen.*`) landed
in this ticket's own commit.

## Watch out for

**Do not put the scoring formula in the Screen.** It is `matchScore` from ticket 03. A Screen that
does its own arithmetic is a Screen that will disagree with the server's winner.

**The wait is not fixed-length.** "Once the next Track has loaded" is a real dependency, not a
timer — a slow track-service fetch must show the Standings longer, not cut it short and start a
Countdown against an unloaded Track.

**HUD is not a Screen** (ADR 0008). A live standings overlay *during* a Round is a separate,
explicitly deferred idea (`screens-inventory.md:85`) — not this ticket.
