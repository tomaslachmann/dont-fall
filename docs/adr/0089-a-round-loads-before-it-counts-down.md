# 0089 — A Round loads before it counts down

## Context

A Match went `LOBBY → COUNTDOWN` the Tick the host's `start` was validated,
and `RESULTS → COUNTDOWN` between Rounds. Nothing waited for the clients.

Each client then had to fetch the Track, load its Assets, build its Stage,
physics world and Character models — seconds of work, inside a three-second
Countdown. What the Player actually saw was the tail of the count: "1", then
GO, then a Round already moving.

Worse, the client was not necessarily building the *right* world. The game
booted on `welcome.trackId` (ADR 0024: one welcome per socket, sent when the
Lobby screen opened it), and reloaded only while the phase still read LOBBY.
So a host's Track pick after the players joined, and every Round a Match draws
after its first, left the client drawing one Track while the server simulated
another. Live (2026-09-17) that read as Characters standing inside a block and
never falling: the server had them on their own Track's start platform, while
the client drew scenery that was not where they were.

## Decision

**A Round loads before it counts down.** A new phase, `LOADING`, sits between
the start and the Countdown:

- `LOBBY --start--> LOADING`, and `RESULTS --next Round--> LOADING`. The next
  Round's world is built on the server at that transition, so the snapshot
  names the Track every client must load.
- Each client builds its world and sends `{ type: "loaded", trackId,
  trackRevision }` — the game itself sends it, since only the game knows when
  its Stage, physics world and models are actually there. The report names the
  Track built, so one that crossed a Track change counts for nothing.
- `LOADING --> COUNTDOWN` only once every connected client is in the
  snapshot's `loaded` list. **There is no timeout**: a Round waits for the
  people in it. What it does not wait for is somebody who left — the gate
  counts live sockets, so a client that drops while loading stops holding the
  Round, and everyone dropping falls back to a fresh Lobby as before.
- The client reports **level-triggered, off the snapshot**, not once at boot:
  every Round clears the list server-side, and a Round that replays the Track
  a client already has loads nothing and would otherwise never report again.
- While a Round loads, the client shows the Round loader full-screen: the
  Track's own screenshot (ADR 0085) and its name, then the count of who is
  still missing. The game's canvas mounts underneath — that mount is what
  loads — but nothing of the Round shows through until it stands.
- The game boots on the Track the snapshot names, never the welcome's, and
  reloads whenever the two differ **in any phase**.

The base race, being code-owned (ADR 0078), carries its own screenshot with
it: `assets/base_race.jpg`, published with the seed by the API.

## Considered options

- **A timeout that starts the Round anyway** — offered and rejected by the
  user: a Player dropped into a Round they cannot see is worse than a wait
  everyone can see the reason for.
- **Dropping whoever fails to load** — rejected for the same reason.
- **Waiting inside LOBBY instead of a new phase** — rejected: a Match's later
  Rounds never pass through the Lobby, so the wait between Rounds would have
  had to live somewhere else anyway, and a phase everyone can render is what
  makes the wait legible.
- **Keeping the Countdown as the loading window** — what the game did. It
  means the Countdown is not a Countdown: whoever loads slowest sees a number
  or two of it.

## Consequences

- `MatchPhase` gains `LOADING`. Input is locked and physics does not step
  there (both already followed from "not RUNNING" / "not COUNTDOWN or
  RUNNING"). The music keeps playing the Lobby's playlist — the Round's own
  starts with its Countdown.
- `SnapshotMessage` gains `loaded: string[]`; `ClientMessage` gains
  `LoadedMessage`.
- Every Round now starts with the whole Countdown visible, which was the
  point.
- A test client must answer the gate: the server suites report a built world
  per LOADING episode, the same way a real client does.
