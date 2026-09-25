# 03 — A Bot is an input source on the authority

**What to build:** the seam. A `Bot` in `packages/shared/src/bot/` turns a read-only view of
the world into one `SimInputs` per Tick; the Match server runs Bots beside `InputRouter`
(`apps/server/src/net/inputRouter.ts`) and feeds their inputs to the step exactly where a
Player's are consumed. A Bot has a seat with no socket. The first Bot only walks the navmesh
path to the Finish Zone, so the seam is proven end to end before any behaviour is built on it.
ADR 0129.

**Blocked by:** 01

**Status:** done on tests (2026-09-24)

- [x] `BotWorldView`: what a Bot may read. It includes its own Character, other Characters'
      poses and motion states, the resolved Track, the Tick, and the Round's rules. A Bot never
      holds the simulation itself, so nothing it does can write state
- [x] `Bot.think(view): SimInputs`: decisions may run slower than 30 Hz (a Bot's reaction time
      is ticket 08's), but steering produces an input every Tick
- [x] A Bot seat in the server's roster: a `LobbyPlayer` with `accountId: null`, never a
      socket, counted against `maxPlayers` together with sockets and live Reservations
      (`connections.ts`), skipped by the LOADING gate (a Bot is always loaded, ADR 0089),
      Ready by definition
- [x] **Where the flag lives:** the server knows a seat is a Bot; the Snapshot does not carry it
      (ADR 0129: no Screen marks a Bot)
- [x] `facing` produced the way a client produces it: turned toward the run, lagging a change
      (ADR 0085), so a Bot's body reads like a Player's
- [x] Integration test on a real `MatchRuntime`: one Player + one Bot, a Race starts, the
      Bot's Character moves toward the finish
- [x] `pnpm bench:sim` grows a Bots row: 11 Bots on the base race, cost per Tick

## As built

**Shared (`packages/shared/src/bot/`).**

- `Bot.ts` defines `Bot`, `BotWorldView` and `BotTrack`. A `BotTrack` is the resolved Track, its
  navmesh and its `raceTargets`. It is built once per world by `buildBotTrack` and freed by
  `disposeBotTrack`. Recast's objects live outside the JS heap, so every replaced world has to
  hand its navmesh back (`disposeTrackNav`, new in `navMesh.ts`).
- The view is the `SimState` the tick loop built after the last Tick: plain data, a Tick old,
  what a Player with no latency would see. A Bot never holds the simulation.
- `PathBot.ts` is the first Bot. Its goal is the next Checkpoint's target, then the nearest Finish
  Zone. It plans with `navPath`: at once on a new Checkpoint or a Respawn, otherwise every
  `BOT_REPLAN_TICKS`. It steers every Tick toward the first corner further than
  `BOT_CORNER_REACHED_M`, and stops when the path runs out. Neither constant is settled.
- On a default floor a capsule stops dead when its input stops (measured: no glide at walk
  speed), so stopping at the last corner leaves the Bot on the deck. Ice will not stop it like
  that, which is ticket 04's (Surfaces) and 06's (never steps off).
- **`facing` uses the client's own function.** `nextModelYaw`, `facingFromModelYaw` and
  `modelYawFromFacing` moved from `apps/client/src/render/modelFacing.ts` to
  `packages/shared/src/input/bodyFacing.ts`, unchanged. The client file re-exports them. A Bot
  runs the turn once a Tick (`TICK_DT`), starting from its Character's replicated facing.

**Server (`apps/server`).**

- `match/botDriver.ts` (`BotDriver`, `rt.bots`) is the only place that knows a seat is a Bot.
- The loop writes Bot inputs into the same `tickInputs` record right after `InputRouter.takeFor`,
  as raw inputs, so the step locks them as it locks a Player's (ADR 0044).
- `rt.bots.observe(state)` keeps the state the loop builds anyway. After a rebuild the first Tick
  takes one extra `snapshot()`.
- `MatchRuntime.addBot(identity?)` / `removeBot(id)` are the hook ticket 10 calls. `addBot` is
  LOBBY-only and returns `null` when full. A Bot's seat is an ordinary `LobbyPlayer` row: no
  Account, `ready: true`, the next join order. It goes through `seatForJoin`/`seatOf` like a
  Player's, so leaving mid-Round is a DNF and an elimination.
- `seatsTaken()` is sockets + live Reservations + Bots. `ensureCapacity`, `reserveSeats` and
  `/status.playerCount` all read it, so a held Reservation wins over a Bot.
- The LOADING gate (`allLoaded`) reads connections only, so it skips a Bot by construction. But
  the Round loader draws `WAITING FOR PLAYERS loaded/players`, so the Snapshot's `loaded` lists
  every Bot (`loadedIds()`). `standingsReady` does too (`standingsReadyIds()`). The return to
  LOBBY keeps a Bot Ready. Otherwise one Bot left over would block `start` for good.
- **Found:** the API reaps a Lobby only once `/status.playerCount` is 0, so Bots counted there
  would have kept an empty Lobby alive forever. **A Bot leaves with the last connection**
  (`connections.ts`'s close handler).
- The navmesh is built by `worldChanged` on every rebuild, but only on a Match that has a Bot, and
  by the first `add` otherwise. A Lobby without Bots never pays for it.
- `initNavigation()` is awaited in `startServer` next to `initPhysics()`. It takes 20 ms in Node.
- `MatchLoopHooks.timers` lets a test drive the real loop Tick by Tick.
  `match/matchRuntime.bots.test.ts` runs the real connection handler, Lobby messages and loop on
  the base race.

**Bench** (`pnpm bench:sim --players 12`, Apple M4, 1800 measured ticks). A full Lobby: one idle
Player and 11 `PathBot`s on the moving base race.

| | p50 | p95 | p99 | max |
|---|---|---|---|---|
| every Bot's `think`, per tick | 0.010 ms | 0.040 ms | | |
| the tick | 0.630 ms | 1.500 ms | 2.360 ms | 3.840 ms |

- The navmesh took 101 ms to build in the bench, cold, against 42 ms solo in ticket 01.
- 3 Falls in the run. Their cause was not looked into: that is ticket 06's.

**Left for ticket 10:**

- `resolveHostId` takes the lowest join order over every row. A Bot added in LOBBY is ahead of any
  human who joins after it, so it could become host if the humans before it leave. Adding Bots
  at the start and removing them on the return to LOBBY avoids that, and ticket 10 must keep it
  that way.
- `openBettingArgs` lists a Bot as a runner.
- A Bot is called "Player" until ticket 10 names it (`addBot` takes the identity).
- `playersToStart` still counts connections only.

**Until tickets 05/07,** `allQualified` needs every Character across the line, and a `PathBot`'s
path on the base race ends at −65 m. A Race with a Bot in it ends on its Time Limit.

**Open question (conservative choice made):** a Bot leaves when the last connection closes, in
any phase. The ADR says only that Bots leave on the return to LOBBY (ticket 10). Everyone
leaving already forces that return, so the two agree today. The choice was forced by the reaper.
