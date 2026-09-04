# 0038 — Time Limit lives on the Revision row

M4 needs a per-Track clock (grilling Q6: a long Track needs more time than a short one), but the
data has no home for it: `Track` is a bare `Segment[]`, and track-service's `tracks` table holds
`trackId, revision, name, authorId, contentHash, data, createdAt` — no time, no metadata of any
kind.

## Decision

- A new `timeLimitMs` column on `tracks`, keyed per `(trackId, revision)` like everything else.
  The `Segment[]` publish contract (`data`) is unchanged.
- The Track builder edits it as a number on the Draft; each publish writes the value with the new
  Revision. The lobby reads it and shows it; it never writes it — no per-Match override in M4.
- Pre-M4 Revisions (including the M1 seed) backfill a default of 180 s, so every existing Track
  resolves and plays unchanged.
- The Match server fetches it with the Track (the existing M3 fetch-by-id path) and enforces it
  from its own Tick; the client never computes the end of a Round.

## Considered options

- **Envelope in `data`** (`{segments, timeLimitMs, …}`) — rejected: it changes the M3
  publish/resolve contract every consumer already parses, to carry something that is naturally a
  row attribute and is never needed by `resolveTrack`.
- **Round config on the Match server** — rejected: it orphans the value from the thing it
  describes (a long Track under a short global clock is unraceable by default) and forces every
  lobby to pick a number it cannot judge.
- **Lobby override on top of a Revision default** — rejected for M4: one source of truth while the
  clock's fairness is still untested; re-open when a real use case (tournaments, custom games)
  asks for it.

## Consequences

- One migration + backfill; the builder publish path writes the column; old clients/servers that
  ignore it see M3 behaviour.
- Clock fairness per Track becomes an authoring concern (builder default now, generator later),
  not a protocol concern.
