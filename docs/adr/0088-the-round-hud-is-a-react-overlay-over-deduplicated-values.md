# 0088 — The Round HUD is a React overlay over deduplicated values

## Context

ADR 0008 kept the HUD plain DOM because "it updates every frame and has no
place in a component tree". ADR 0060 drew the line at update cadence: event
feedback may be React in `GameCanvas`'s `screenOverlay` slot, per-frame
telemetry may not. It named `RaceHUD.tsx` as out of scope for that carve-out.

What `hud.ts` actually drew by 2026-09 was a developer's text block: position,
fps, prediction tick, net metrics, ASCII Dash/Hit bars. Nothing a Player was
meant to read. The designed HUDs, `RaceHUD.tsx` (mock 1b) and
`SurvivalHud.tsx` (mock 1d), show a live placement, the Round clock, Checkpoint
progress with a split, a Personal Best, who is right behind you, how many are
left, and a danger warning. Half of that the game did not have.

The user's call (2026-09-17):

- Both designed HUDs are wired, as React overlays over the live game — the same
  way every other in-Round screen already is.
- What the mock shows but the game lacks is built on the server, not hidden.
- The debug text block is deleted outright.

## Decision

**The Round HUD is React, in the `screenOverlay` slot, fed display-rounded
values the game emits only when they change.** No per-frame value reaches
React: the game builds a `RoundHudSnapshot` off each server snapshot, rounds
every number to what is drawn (the race clock to tenths, the survival clock to
whole seconds), and raises `onRoundHud` only when its JSON differs from the
last one it raised — the discipline `onSpectate` already follows. React
re-renders at most at the snapshot rate, and in practice ~10 times a second.

The overlay renders no Stage background, field or sheen (the Countdown rule),
and is pointer-transparent: a click must still reach the canvas for pointer
lock.

What the mocks show, and where it comes from:

| Shown | Source |
|---|---|
| **Placement** (race) | Server, `liveRace.places`: finished Characters by `finishTick`, then everyone still running by Checkpoint reached and straight-line distance to the next target (the next Checkpoint, else the Finish Zone), then the Eliminated. Placement in this Round, ties shared. |
| **Split** (race) | Server, `liveRace.splits`: the server records the Tick each Character reaches each Checkpoint. A Character's split is its gap to whoever reached its latest Checkpoint first. The first to arrive reads negative — its lead over the second — once a second arrives, and has no split until then. |
| **Personal Best** (race) | API, per Account and Track (every Revision). The match server reports each finished run's time, `(finishTick − roundStartTick) × TICK_MS`, when a Race Round ends; the API keeps the minimum. The client reads its own through `GET /tracks/:id/personal-best`. An anonymous seat has none, and the line hides. |
| **Right behind you** (race) | Client, from `liveRace.places` and the snapshot's positions: the Character placed directly behind you, still running, within `HUD_THREAT_RADIUS_M`. |
| **Beans left, started with, who's alive, last out** (survival) | Client, from replicated state: `eliminated`/`eliminatedTick` and the Lobby roster. Nothing new on the wire. |
| **Critical zone** (survival) | Client, `survivalCritical`: survivors within `CRITICAL_SURVIVORS_ABOVE_TARGET` of the Survivor Target, or under `CRITICAL_TIME_LEFT_MS` on the clock. A warning read off real state. It is not a zone and no mechanic sits behind it. |

Survival shows no placement: its measure is how many are left. The mocks'
"GAMEPLAY FEED" caption was a placeholder for the game view and is dropped.

`hud.ts` keeps what is not a Round readout: the pointer-lock prompt and the
match banner.

## Considered options

- **Port the design into `hud.ts` as plain DOM** — rejected by the user. It
  would duplicate `Pips`, `Avatar`, `Pill` and `Chip` as DOM builders beside
  the React originals.
- **React fed every frame** — rejected. This is what ADR 0008 warned against,
  for no visible gain: nothing on this HUD changes faster than a snapshot.
- **Hide what the game lacks** — rejected by the user in favour of building it.
- **A live, continuously estimated time gap** instead of a Checkpoint split —
  rejected. It is imprecise around moving Segments and Respawns. A split is
  exact.
- **Personal Best per Revision** — rejected. `PersistedMatchResult` carries
  no Revision, and a republish would silently wipe every record.

## Consequences

- Supersedes ADR 0060's exclusion of `RaceHUD.tsx`, and ADR 0008's "the HUD
  stays plain DOM" for the Round readout. CLAUDE.md invariant 5 is amended.
- `SnapshotMessage` gains `liveRace: LiveRace | null`: `null` outside a
  running Race Round.
- The server keeps Round-scoped Checkpoint arrival Ticks, cleared on RUNNING
  entry.
- The API gains a `personal_bests` table, `POST /internal/personal-bests`
  (service token) and `GET /tracks/:id/personal-best` (Bearer).
- `formatHudText` and the whole debug block are gone. (The `?perf=1` overlay
  went with it a few hours later, on the user's call — measurement lives on
  the server's tick log and `pnpm bench:sim`.)
