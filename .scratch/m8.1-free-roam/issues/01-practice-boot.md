# 01 — Practice boot (`?freeroam=1` runs the sim locally, no server)

**What to build:** A client boot path that runs a Track locally — same
`RapierSimulation`, same bytes from track-service, no socket, no Lobby, no
Rounds. Opening `/play?track=X&freeroam=1` spawns the author straight onto
the Track.

**Blocked by:** nothing (grilled contract settled; all sim/render/fetch
pieces exist).

**Status:** planned

## Why

Playtest today means the full match pipeline: `playersToStart` (default 2),
`allReady` from everyone, countdown, timed Rounds, results. An author
iterating on geometry needs spawn-and-run in one click. The sim is already
shared and deterministic, the client already fetches Track + assets — the
only missing piece is a boot that wires them together locally.

## What to change

- [ ] `PlayRoute` reads `?freeroam=1` and boots a practice session instead
      of a match connection (one route, explicit param, bookmarkable —
      grilled decision 5)
- [ ] Practice boot fetches the Track + asset library + visual templates
      through the existing fetchers (same pipe, same fetch-once caching),
      resolves the Track, builds the stage — then steps a local
      `RapierSimulation` instead of opening a socket
- [ ] Ticket 01's visual-escapes-collision warnings still surface (console,
      as in match boot) — the author is exactly who they are for
- [ ] No socket is opened, no Lobby state exists, no snapshot/interp code
      runs — a practice session that accidentally phones the server is a
      bug, not a fallback

## Done when

- [ ] Unit-testable seams: param parsing chooses practice vs match boot;
      practice boot constructs its world with zero socket traffic (assert
      no `WebSocket` construction)
- [ ] Typecheck clean; no server changes whatsoever (this milestone touches
      the client and the builder only)

## Watch out

- GameCanvas teardown discipline (M4 ticket 01) applies to the practice
  session exactly like a match — leaving it must free everything.
- Don't fork fetch/resolve/stage code: practice boot calls the same
  helpers match boot does, up to the socket.
