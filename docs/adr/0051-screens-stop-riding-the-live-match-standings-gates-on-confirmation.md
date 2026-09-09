# 0051 — Screens stop riding the live Match; Standings gates on confirmation, not a timer

This corrects two things M7 ticket 06 got wrong, both because the actual decision was only ever
made verbally across earlier sessions and never landed in a doc — so the next session (and the
next `/implement`) had nothing to build against but a guess. Writing it down is the point of this
ADR as much as the decision itself.

**1. Lobby and Results have overlaid the live, connected `<GameCanvas>` since M4 ticket 07** — a
translucent "content over a live scene" treatment, reused for Standings when ticket 06 built it.
This was never actually specified. `docs/research/screens-wireframes-and-components.md` §3.3
(Countdown) is explicit that Countdown alone "must render on top of a live game view, not instead
of it" — precisely because Characters are already spawned and cameras already live at that point.
Main Menu's own background (§3.1) is "a cut-down `<GameCanvas>` mode, or a pre-rendered loop... a
real performance trade-off worth its own spike, not decided here" — a decorative, disconnected
render, never the live Match. Neither the Lobby (§3.2) nor Results (§3.5) sections say anything
about a live scene at all. The overlay-on-live-canvas treatment on those two was an implementation
drift nobody caught, not a decision.

**2. ADR 0049 says Standings "advances on its own once the next Track has loaded, not a button
someone has to press."** That was superseded verbally, in a later session, by a different design —
Standings should gate the next Round on every connected Player confirming, not a bare server
timer. That supersession never made it back into a doc, so ticket 06 built to the stale ADR 0049
line, verified live, and was wrong the moment it was checked against what had actually been agreed.

## Decision

**Only Countdown and Running ever show the live Match.** Lobby, the new Loading screen (below),
and Standings each get their own non-live background — exact content is explicitly undecided
(same open question Main Menu's own background already carries; not resolved here). The
connection and the underlying game/simulation session still stay alive continuously for the whole
Match — Lobby's live roster/ready/Track-pick sync already depends on that socket, and tearing it
down and reconnecting per phase would reopen the tick-epoch bug class ADR 0027 and M5 ticket 08
already paid to fix once. What changes is the 3D canvas's **visibility** across phases, never the
connection's lifecycle.

**The per-Round flow becomes:**

```
Lobby → Loading → Countdown+Running (the game) → Standings → Loading → Countdown+Running → Standings → ...
```

**Standings gates the advance on confirmation, with a timeout ceiling, not a bare timer.** Between
Rounds, Standings shows the Round just played plus the running Score, with a one-shot "Ready for
next Round" per Player (no un-ready — unlike the Lobby's toggle, there's no reason to change your
mind once you've confirmed). It advances into Loading once every *currently connected* Player has
clicked it, or a timeout ceiling elapses, whichever comes first — the ceiling exists purely as a
safety net against an AFK Player freezing a multi-Round Match, not as the expected path. A Player
who disconnects mid-Standings is dropped from the gate the instant they leave, recomputed live —
the same discipline the Lobby's own `allReady`/`sockets.size` gate already uses.

**Match end has no group action at all.** The final Standings offers each Player, independently,
a return to the **Main Menu** — not a synchronized "everyone/host returns to the Lobby together."
`returnToLobby`, and the whole "same group replays without going back through the Main Menu" path,
is retired. A fresh Match only ever starts from the Main Menu.

## Considered options

- **Pure server timer (today's ADR 0049 line, and what ticket 06 shipped)** — rejected: with
  `nextRoundReady` typically already true by the time a Round ends (the next Track's fetch was
  kicked off at Match start and usually long since resolved), the between-Round Standings phase
  lasts about one server tick — visually indistinguishable from no screen at all. Confirmed live.
- **Host-gated advance, mirroring the old single-Round `returnToLobby`** — rejected: this is
  exactly the "everyone waits for the host" failure ADR 0049 named as the reason to stop using a
  button in the first place, just re-added on a hot path every Match now takes on every Round.
- **Pure indefinite confirmation gate, no timeout** — rejected: moves the "everyone waits" failure
  from one Player (the host) to all of them, worse the moment anyone tabs out or drops without a
  clean disconnect.
- **Everyone-confirms gate at Match end too, landing in a shared Lobby** — considered, rejected:
  Match end is "each Player leaves independently, in their own time" — nobody is blocked on anybody
  else finishing reading the standings.

## Consequences

- **Protocol**: `ReturnToLobbyMessage`/`returnToLobby` (host-only, RESULTS-only) is removed, along
  with `lobby.ts`'s gate enforcing it. A new client→server message is needed for the between-Round
  Ready click (RESULTS-phase only, no host restriction — every connected Player sends their own).
- **Phase machine**: `advanceMatchPhase`'s `RESULTS → COUNTDOWN` transition, currently gated only
  on `roundsRemaining && nextRoundReady`, needs an additional "everyone confirmed, or timed out"
  condition. Whether that needs a distinct `LOADING` `MatchPhase` value, or stays inside `RESULTS`
  server-side with `LOADING` existing only as a client-rendered wait state once the Ready-gate has
  cleared but the Track hasn't finished loading, is **left open** — a real implementation decision
  for whichever ticket builds this, not settled here.
- **Match end**: `StandingsScreen`'s host-only "Back to Lobby" action (M4 ticket 08, carried through
  ticket 06) is removed, replaced by an unconditional per-Player "Main Menu" action that behaves
  like today's `onExit`/`onMatchEnd` hand-off, not like `returnToLobby`.
- **Screens**: `LobbyScreen`, the new `LoadingScreen`, and `StandingsScreen` stop using the
  `LiveOverlay isSceneLive` "content over a live scene" pattern. `<GameCanvas>`'s mount needs a way
  to hide the live 3D view without unmounting it (still-open: exact visual treatment, tracked as
  the same undecided background question Main Menu already carries).
- **Ticket 06, as shipped, is superseded by this ADR** and needs redoing: `StandingsScreen` gets
  the Ready-gate and drops the auto-advance hint text and the host-only Match-end button;
  `GameCanvas` stops overlaying Lobby/Standings on the live canvas; a `LoadingScreen` gets built;
  `returnToLobby` gets removed end to end (protocol, server, client).
