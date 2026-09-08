# 0049 — A Match is scored, not survived

`CONTEXT.md` has always defined a **Match** as "one full session from Lobby to a single winner, made
of several Rounds", and **Round** as ending with "whoever Qualified advances to the next Round".
Neither has ever been true of the code: M4 runs one Round and hands control back to the host, who
clicks a button to return everyone to the Lobby. The central term of the ubiquitous language names a
thing that does not exist.

Building it the way the glossary describes means Fall Guys' structure — each Round eliminates the
Players who did not Qualify, the field narrows, the last Round decides. That is the reference this
project has named for match structure since M1. This ADR rejects it.

## Decision

**Elimination stops being a property of the Match and becomes a property of a Round.** Nobody is
knocked out of a Match. Every Round every Player is in pays out **Score**, and the Match is won by
the highest total after a fixed number of Rounds.

- **Placement pays, not raw time.** A Round ranks its Players (`buildResults` already does this:
  Qualified by finish tick, the rest by progress) and the placement is what converts to Score.
- **The conversion is percentile-normalised to a fixed maximum**: `(1 − (placement−1)/(N−1)) × MAX`
  over the `N` Players in that Round. First place always takes `MAX`, last always takes zero,
  whatever `N` is.
- **Qualification survives, redefined.** It stops meaning "advances to the next Round" — everyone
  advances — and becomes the top scoring tier: a flat bonus on top of the placement Score.
- **A Match is a fixed number of Rounds**, set in the Lobby, defaulting to three. Not a Score
  target.
- **Score is Match-scoped and derived, not stored.** The server replicates the list of completed
  Round results; Score is a pure function of that list in `packages/shared`, the same discipline
  `buildResults` and `qualificationPlacement` already follow.

## Considered options

- **Elimination between Rounds, as the glossary says and Fall Guys does.** Rejected on the numbers
  this project actually has. Fall Guys starts with sixty; the field can afford to halve three times.
  ADR 0011 architected for twelve and everything to date has been verified with two. A Match that
  eliminates half the field in Round one is, at two Players, a single Round with extra ceremony —
  and at twelve it hands eight people nothing to do but leave. Scoring keeps a two-Player Match a
  real Match, which is the size this game is actually played at today.
- **Raw time as Score** — the first instinct, and it does not survive contact with two Round types.
  Forty seconds survived in Survival and a forty-second Race finish are not the same forty seconds,
  so the two would need cross-calibrating; a longer Track would pay everyone more, making Track
  selection decide the Match; and "you have 37 points" would not be readable from anything on
  screen. Placement normalises all three away, and ADR 0043 already bought exactly this — a Round
  type is data, not a branch — which a raw-time formula would spend again.
- **A fixed points table by placement** (1st = 10, 2nd = 8, …). Rejected because the field size
  varies both between Matches and *within* one: a Player who disconnects in Round two leaves Round
  three ranking fewer people, and a fixed table would quietly make that Round worth less. The
  percentile form is field-size independent by construction.
- **A Score target rather than a Round count** — rejected for party-game reasons, not technical
  ones. Matches of unpredictable length are fine in a league and bad in a living room.
- **Keeping the last Round special** (a `Final Race`, or Survival down to one). Deferred, not
  rejected: it is a second idea, and it needs an answer to "what if someone is already uncatchable
  going into the final" that scoring alone does not provide. `Final Race` and `Skyfall` stay in the
  glossary as intended, unbuilt concepts.

## Consequences

- **Four glossary terms are rewritten** — `Match`, `Round`, `Qualification`, `Elimination` — and
  three added: `Score`, `Standings`, `Match length`. This is the largest single change to the
  ubiquitous language since it was written, and it is a correction: the words now describe the game
  that exists.
- **Spectator Mode stops being an epilogue and becomes load-bearing.** A Player out of a Round still
  has the whole rest of the Match ahead of them. That makes `Bet` (glossary: "a prediction an
  eliminated Player makes in Spectator Mode") reachable for the first time, and it makes a dead
  spectator screen expensive in a way it was not when the Match ended anyway.
- **`returnToLobby` changes meaning** from "this Round is over" to "this Match is over". Between
  Rounds there is a Standings Screen that advances on its own once the next Track has loaded, not a
  button someone has to press.
- **A Survival Round becomes rankable for the first time.** Today `eliminated` is a boolean
  (`RapierSimulation.ts:86`) and non-Qualified Characters rank by Checkpoint progress — which on the
  arena Module, one flat platform with no Checkpoints, orders nobody. Placement-based Score needs a
  real order, so the tick a Character was eliminated becomes replicated state.
- **A disconnect can no longer be forgotten at the next Countdown.** `rt.dnf` is cleared every
  Round (`matchLoop.ts:112`); Score cannot be, or the standings lose a Player mid-Match. Their Score
  is parked and they score zero for Rounds they miss. Real reconnection (`reclaim`, ADR 0024, still
  unimplemented) is left alone — this decision only ensures scoring does not block it later.
- **The Round type seam gets its second real test.** ADR 0043 said a Round type is data the shared
  step reads fields of. Scoring is the first thing that has to treat Race and Survival results as
  the same kind of thing without knowing which is which.
