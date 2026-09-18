# 0090 — One seat per Account in a Match

## Context

Since M9 ticket 11 an `auth` message binds a connection to an Account
(`LobbyPlayer.accountId`). Nothing checked whether that Account was already
sitting in this Match, so two tabs signed into the same Account took two
seats: two Characters, two sets of Score, two rows on the Standings, and — on
the results save — one `match_participants` row for the two of them, since
that table is keyed `(match_id, account_id)`. Found by the user while
playtesting (2026-09-17).

## Decision

**An Account holds at most one seat in a Match, and the newest sign-in is the
one that holds it.** When `auth` resolves an Account already bound to another
live socket in this Match, that older socket is closed with code
`SEAT_TAKEN_OVER_CLOSE_CODE` (4004) and the reason "this account joined the
Match somewhere else". Everything after that is the ordinary disconnect path:
the seat, the Character, and (mid-Round) the DNF are what a `'close'` always
means, never a second mechanism.

The older socket goes, not the newer one, because whoever just signed in is
the one at the keyboard.

Anonymous seats are untouched: with no Account there is nothing to be the
same, and two browsers without a login stay the fastest way to test a Match.

The close reason now reaches the Screen: `LobbyConnection.onClose` carries the
socket's code and reason, and `/lobby` renders it instead of the generic
"connection dropped" — the same path already carries "server is full" (4003)
and a Track that would not load (4002).

## Considered options

- **Refuse the second connection instead** — offered; the user chose takeover.
  It leaves a stale tab holding the seat after a crash or a reload, which is
  exactly the case a takeover fixes.
- **A real reclaim** — the new connection inheriting the old seat's Character,
  Score and place in the Round. That is ADR 0024's `reclaim`, still
  unimplemented: the prediction epoch, the input router and the Round's own
  bookkeeping all key off the connection id. Taking over mid-Round therefore
  costs that Round (a DNF, and the newcomer waits out the Match as a
  spectator, M7 ticket 08), exactly as any other mid-Round reconnect does.
- **Leaving it** — rejected: duplicate seats corrupt Score and the career
  index, quietly.

## Consequences

- One new close code, 4004, and a reason a Player can read.
- A Player who opens the game twice loses the older tab rather than
  discovering two of themselves in the Lobby.
- Reconnecting mid-Round still does not give a Round back; when `reclaim`
  lands (ADR 0024), this is the seam it replaces.
