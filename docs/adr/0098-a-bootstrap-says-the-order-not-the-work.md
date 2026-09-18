# 0098 — A bootstrap says the order, not the work

## Context

The user, on 2026-09-18, after reading `docs/research/codebase-audit-2026-09.md`,
asked for the three biggest files in the repo to be split and wrote out what
each one should become. The audit's own backlog had named the same three as
tickets 4 (`startGame`) and 6 (`CharacterController`'s per-tick setters); the
Match server's bootstrap was the user's own addition.

All three had the same shape: **one function that both decides the order of
things and does all of them**. `startServer` was 589 lines of config
normalisation, port binding, an HTTP handler, a WebSocket handler and a perf
monitor. `boot` was 1175 lines holding three dozen `let` bindings that the
message handler, the frame loop and the returned handle all closed over at
once. `beginCapsuleTick` was 350 lines of movement in which every step's
correctness depends on where it sits relative to the others — and nothing said
so, because there was nothing to say it about.

## Decision

**Each of the three keeps its name and its boundary, and says only the order.
Every step beside it is a named thing.**

`apps/server/src/matchServer.ts` (589 → 119): `server/config.ts` resolves what
a caller asked for against the environment once, `server/ports.ts` binds,
`server/statusHttp.ts` answers the broker, `server/connections.ts` handles a
connection, `server/seats.ts` says what a connection *is*, `server/perf.ts`
measures.

`apps/client/src/game/index.ts` (1533 → 313): `world.ts` builds the Stage and
the local simulation for a Track, `session.ts` is the state they share,
`serverMessages.ts` is what a snapshot does to it, `frameLoop.ts` is what a
frame draws from it, `types.ts` is ADR 0008's boundary on its own.

`CharacterController.beginCapsuleTick` is ten methods, and the one that remains
reads: which verbs fired, what the movement model makes of them, what rides on
top of that, how far the sweep can go, what the floor does about the arrival.

Three things follow from that, each a decision in its own right.

### A seat is a kind, not a branch

A connection's *role* was three `if`s spread across join and close:
`maxPlayers`, `spectating`, and the DNF/eliminate/remove triple. It is now a
`Seat` — `PLAYER_SEAT` or `SPECTATOR_SEAT`, each with `take` and `release` —
and a third kind (an admin monitor) would be a third object, not a fourth
branch.

Two things deliberately did **not** become seats. The Track Builder's Playtest
(`?track=`) is not a role: it is a step a connection may perform *before*
taking a seat, after which it sits down as an ordinary Player. And the seat is
**re-read at close, never remembered from join** — `resetToFreshLobby` clears
`spectators`, so a spectator who waited out a Match is a seated Player in the
next one, and a seat captured at join would leave that Character's body in the
world forever.

### One ground context, not thirteen setters

`RapierSimulation` called eight setters on every Character every tick, in a
fixed order, before `endTick` meant anything. They are one
`applyGroundContext({ surface, conveyor, volume, slipRoll })`, where `surface`
is the `SurfaceConfig` record that already existed. A Surface property now
costs a field in `SURFACES` and a read — not a setter, a private field and a
line in the tick loop.

**This found a real bug, which is the argument for the whole change.** The
three-value Grab reset beside it (`grabSpeedMultiplier`, `grabTetherWish`,
`grabEngaged`) only ever cleared two. Nothing else cleared `grabEngaged`
outside a knockdown, and the Grab verb is gated on not already being engaged —
so **a Player could Grab exactly once per life**. Every later press read as
"let go" instead and did not even play the reach. `clearHold()` and
`holdWith()` now move all three together, and
`RapierSimulation.test.ts` holds the case.

### The client's Track swap builds before it disposes

`loadTrack` disposed the Stage and then `await`ed its way to a new one, so the
frame loop spent the gap rendering an already-disposed Stage. `swapTrack`
builds the new world first and disposes the old one after, which costs a brief
moment with two Stages alive and buys a live one to draw throughout.

## Consequences

- `startServer`, `startGame` and `beginCapsuleTick` keep their exact
  signatures. `apps/server`'s public exports (`startServer`, `MatchServer`,
  `PortRange`, `StartServerConfig`) are unchanged, and `ServerRuntimeConfig`
  joins them; `apps/client/src/game/index.ts` re-exports ADR 0008's boundary
  types, so the shell still has one import.
- `MatchConfig` now `extends ServerRuntimeConfig`, so the resolved config has
  one definition rather than two that could drift.
- Four hand-written "did this JSON change" caches became one `ChangeGate`.
- The split found dead code the scan could not: twenty unused imports in
  `matchServer.ts`, and `bootStartedAt` / `fetchStats` / `simStartedAt` /
  `simSteps` / `simMs` in the client frame, all left behind when M13 ticket 01's
  `?perf=1` overlay was deleted. None of it was visible to a test or to review,
  so **`noUnusedLocals` is on** in `tsconfig.base.json` — twenty-eight across
  the whole repo were cleared to turn it on, and it is what stops the class
  coming back. (The 2026-09-18 subtraction pass could not have found these: its
  scan looked at *exported* symbols, and every one of these is local.)
- `CharacterController.ts` got *longer* (1752 → 1865), because ten methods need
  ten signatures and ten doc comments. Length was never the complaint; "one
  function nobody can read" was.
- `resolveCollisions` splits into what it found (`betterGroundContact`),
  what that does to this Character (`applyWallImpact`, `adoptGroundContact`)
  and what it reports — but **in one pass**, not by collecting contacts into a
  list first. `computedCollision(i)` allocates, this is the server's measured
  hot path (M13), and a per-tick per-Character array is a real cost for a
  readability gain already had.
- Not done, and deliberately left as their own pass: `CharacterController`
  splitting into Movement/Surface/Interaction/Ragdoll sub-controllers, and a
  per-motion-state strategy object. Both are bigger than everything above put
  together, both touch the code the whole game's feel lives in, and neither is
  made harder by having done this first.

## Extended: `createStage` (2026-09-18, the audit's ticket 9)

The client's renderer bootstrap was the fourth function of the same shape —
`createStage`, 900 lines in one closure — and it now follows the same rule.
`scene.ts` (1303 → 602, most of what remains being the documented `Stage` and
`StageConfig` boundary) says the order the scene graph is built in; the work
is in `render/stage/`:

- `trackVisuals.ts` — everything the Track draws, and what the rest of the
  Stage asks of it (the floor probe, the ice footing, the lowest point);
- `localCharacter.ts` — the local rig, its placement and its animation state
  machine;
- `sounds.ts` — every sound the Stage makes of what it draws;
- `cameraRig.ts` — the spring arm.

Two ordering rules are what the split is shaped around, and each has a
comment where it lives. The local rig is set up before any remote rig is
cloned from it, since the clones inherit its scale and facing. And the mud and
bounce footing frames join the scene *after* the local Character, even on a
silent Stage, because they are scene objects and a Stage's scene must not
depend on whether it can make a sound.

The audit had called `createStage` "the only renderer nobody can test", and
no suite here can rasterise. So it was proven rather than tested: a scratch
harness built a real Stage headlessly — a stub renderer, Environment and
speed lines, the real BLIP rig and Asset GLBs, a fake `AudioContext` — for
four Tracks, drove 170 frames of scripted play through every Stage method in
the frame loop's own order, and hashed the whole scene graph (transforms,
bones, materials, uniforms, geometry) every frame, alongside the camera, every
call the stubs saw and every audio source started. Deterministic across runs,
it caught a one-word shadow-role change on every frame of each Track with
belts, and it was **identical** before and after the split. It was deleted
afterwards rather than committed, under the working agreement that tests
cover new behaviour and this change added none.
