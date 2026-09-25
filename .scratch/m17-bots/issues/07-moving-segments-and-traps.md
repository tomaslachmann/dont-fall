# 07 — Moving Segments and traps, timed by difficulty

**What to build:** a Bot crosses what moves. On the authority every Motion, Ramp, trap door,
Shooter and punching glove is a pure function of the Tick (ADR 0061/0117/0119/0121/0123),
so a Bot can ask where a body will be. How far ahead it looks, and how exactly, is its
difficulty (08). A Bot waits for a sweeper to pass, hops a turntable when it is under it,
rides a carousel, crosses a trap door while it is shut and does not stand on a fragile floor
on its third crack.

**Split (the user, 2026-09-24; re-cut by the lead the same evening):** too big for one agent.
This file keeps the original checklist as the whole ticket's definition of done. Each part owns
a slice, its own files, and its own suite. Parts a, b and c run in parallel once the groundwork
below has landed; e and f follow (or run beside them: their files are disjoint too).

Research behind the split: the three Races with Motion running have **no trap doors, fragile
floors, Shooters or gloves**. What moves there is sweepers that hit you (spin bars, hammers,
trap balls, slide walls, spiked circles), floors you ride (slide rows, turntables, spinning
squares, Spin Cycle's carousels) and belts.

**Why the acceptance moved off Race legs (the lead, 2026-09-24).** Almost every leg mixes
hazard classes: Spin Cycle leg 0 is sweepers *and* carousels, leg 2 is turntables *and*
hammers, leg 7 a carousel *with* a bar on it; the base race's spinning squares are a ride with
a spiked sweeper. A part measured on such a leg fails on the other part's work. So each part
proves itself on **small Tracks built from `authoring.ts`** (build 10–100 ms, a 12-Bot run
0.3–1 s wall) plus the **one real leg that has only its own hazard class**. The mixed legs are
07d's, with every part in.

| Part | What | Acceptance on | Wall clock |
|---|---|---|---|
| 07a | Timing sweepers: hold hook | small Tracks (bar, wrecking ball, slide wall) + base race leg 1 | 45 min |
| 07b | Riding a moving floor from still floor and back (walk-on, jump-on): ride hook + planner | small Tracks (slide row, turntable) + base race leg 2 | 45 min |
| 07c | Belts: push hook + drift in the guard | small Tracks (against, across) + Slip Stream leg 0; leg 6 diagnosed only | 30 min |
| 07e | Moving-to-moving transfers (carousels, turntables, spinning squares, sliding stones) | small Tracks + Spin Cycle legs 0, 2; base race leg 3 | after b |
| 07f | Traps on test Tracks: trap door, fragile floor, Shooter lane, glove | small Tracks only | 45 min, after groundwork |
| 07d | Integration: every Race with Motion running, the level ordering, Falls per section | all three Races | after a–f |

Legs are numbered by the Checkpoint they run to, counted from 0 as `checkpointIndex` does
(ticket 04): base race leg 1 is Checkpoint 0 → 1, the wrecking balls; leg 2 the moving rows;
Slip Stream leg 6 the final run.

## Baselines (the lead, 2026-09-24, 12 Bots, aggression 0, Motion running, 60 s cap, one Round a level; 06b was in flux, so ±)

Passed / 12, stranded (no more than 1 m moved in the last 10 s), Falls by cause. Wall is one
Round's wall-clock in vitest on an M4.

| Leg | EASY | NORMAL | HARD | wall |
|---|---|---|---|---|
| base 0 sweepers | 12, 0, — | 10, 0, Obstacle 2 WallImpact 1 | 11, 0, Obstacle 1 WallImpact 1 | 2 s |
| base 1 wrecking balls | 2, 1, Obstacle 36 WallImpact 10 Bump 5 | 4, 2, Obstacle 54 WallImpact 12 Bump 4 | 3, 0, Obstacle 61 WallImpact 5 Bump 2 | 4–8 s |
| base 2 moving rows | 0, 2, Obstacle 9 Bump 7 | 0, 7, Obstacle 4 Bump 3 | 0, 7, Obstacle 6 Bump 7 | 3–8 s |
| base 3 spinning squares | 0, 8, contact 3 Bump 5 | 0, 6, contact 2 | 0, 11, — | 3 s |
| base 5 belt climb | 2, 0, Stagger 4 Bump 4 (mean pass 53 s) | 3, 0, Stagger 3 Bump 3 | 5, 0, Stagger 4 Bump 3 (55 s) | 1 s |
| base 7 hammer alley | 4, 4, pushed 5 | 1, 3, Obstacle 4 | 5, 4, Obstacle 1 | 2–3 s |
| Spin 0 gates + carousels | 0, 0, Bump 13 | 0, 1, Bump 12 | 0, 2, Bump 11 | 6 s |
| Spin 2 turntables + hammers | 0, 0, Stagger 5 | 0, 0, Stagger 6 | 0, 0, Stagger 5 | 4 s |
| Spin 4 sweeper gauntlet | 0, 0, Obstacle 3 WallImpact 1 Bump 3 | 0, 0, WallImpact 7 Bump 6 | 0, 1, Obstacle 7 | 5–7 s |
| Slip 0 cross belts | 8, 0, pushed 5 Bump 3 | 12, 0, pushed 1 | 12, 0, — | 1 s |
| Slip 6 final run (belt against + balls) | 0, 7, contact 2 | 0, 7, Bump 8 | 0, 9, Bump 3 | 3 s |

Other numbers: library load 0.4–0.7 s once per suite file; `buildBotTrack` with Motion
running 0.7 s (base), 0.56 s (Spin), 2.7 s (Slip); `resolveTrack` 30–110 ms;
`movingSegmentPose` 0.3–0.8 µs a call (base race 32 moving bodies, Spin Cycle 142, Slip
Stream 31); think 7–24 µs per Bot per Tick, EASY highest, with 60–70 µs outliers where Bots
are stuck replanning. A small Track (start deck, one sweeper deck, arch, finish) builds in
11 ms and a 12-Bot pass takes 0.2–0.3 s wall; one Bot 10 ms.

## Groundwork (the main session, once 06b lands; nothing below is a part's to build)

### 1. `BotWorldView` (`bot/Bot.ts`)

```ts
/** The Motion Clock (ADR 0123): the Tick the Round runs from, or null before it runs. Never delayed: it is the Round's own, like `tick`. */
readonly runningFromTick: MotionClock;
/** Every fragile floor that is not intact (`SimState.fragile`, ADR 0118). Delayed with `self`/`characters` by `withPerceptionDelay`. Absent or empty: all intact. */
readonly fragile?: readonly Readonly<FragileState>[] | undefined;
```

Filled by `BotDriver.inputsFor(tick, rules, clock, snapshot, inputs)` from the runtime's
`sim.motionClock` and `state.fragile`, by `bench-simulation.ts`, and by the harness below.
`perceptionDelay.ts`: `Perceived` gains `fragile`; `runningFromTick` passes through.

### 2. `bot/movingWorld.ts` — the moving bodies, once per `BotTrack`

```ts
export type MovingRole = "floor" | "sweeper" | "gate" | "fragile";

export interface MovingBody {
  readonly index: number;                       // into resolved.movingSegments
  readonly config: MovingSegmentConfig;
  readonly role: MovingRole;
  /** Horizontal footprint, local frame: one oriented 2D box per box/solid, trimeshes as their local AABB, each with its local y range. Sweeper occupancy tests against these. */
  readonly hitboxes: readonly { cx: number; cz: number; hx: number; hz: number; yaw: number; yMin: number; yMax: number }[];
  /** Radius of the smallest disc about the local origin holding every hitbox: the `near` test. */
  readonly radius: number;
  /** Floors only: the walkable top's convex hull in the local XZ plane, and its local y. */
  readonly deck: { hull: readonly { x: number; z: number }[]; y: number } | null;
  readonly spiked: boolean;
}

/** Floor bodies moving as one: Spin Cycle's carousel is eight quarter pieces with one spin. */
export interface Platform {
  readonly index: number;
  readonly bodies: readonly MovingBody[];
  /** `bodies[0]`'s frame is the platform frame; the hull is every body's deck hull, in it. */
  readonly deck: { hull: readonly { x: number; z: number }[]; y: number };
  /** Ticks of one whole cycle at pace 1 (a spin: one turn; back-and-forth: the period), for phase tables. */
  readonly periodTicks: number;
}

export interface MovingWorld {
  readonly bodies: readonly MovingBody[];
  readonly floors: readonly MovingBody[];
  readonly sweepers: readonly MovingBody[];     // role sweeper, gloves included
  readonly gates: readonly MovingBody[];        // trap door leaves
  readonly fragile: readonly MovingBody[];
  readonly platforms: readonly Platform[];
  /** World pose of body `i` at `tick`. Cached per (body, tick) in a ring of BOT_LOOK_AHEAD_TICKS_MAX + 2 Ticks; a new clock flushes it. */
  poseAt(i: number, tick: number, clock: MotionClock): MotionPose;
  /** World velocity of world point `p` on body `i` over tick → tick + 1 (`motionPointVelocity`'s rule, through the pose cache). */
  velocityAt(i: number, tick: number, clock: MotionClock, p: Vec3): Vec3;
  /** Whether body `i` is solid at `tick`: a trap door shut, a glove out, a fragile floor standing by `fragile`, everything else always. */
  solidAt(i: number, tick: number, fragile: readonly FragileState[] | undefined): boolean;
  /** Whether world point `p` (a capsule centre) is inside body `i`'s hitboxes at `tick`, grown by `grow` metres across; the y test uses the capsule's own height range. */
  occupies(i: number, tick: number, clock: MotionClock, p: Vec3, grow: number): boolean;
  /** Bodies whose origin path over [tick, tick + window] comes within `radius + reach` of `p`, from the pose cache. Most Ticks: none. */
  near(p: Vec3, reach: number, tick: number, window: number, clock: MotionClock, roles?: readonly MovingRole[]): readonly MovingBody[];
  /** The platform whose deck hull holds world point `p` at `tick`, within `NAV_AGENT_CLIMB` of its top, or null. */
  platformUnder(p: Vec3, tick: number, clock: MotionClock): Platform | null;
  /** World → platform-local (and back) at `tick`, for the ride hook. */
  toLocal(platform: Platform, tick: number, clock: MotionClock, p: Vec3): Vec3;
  toWorld(platform: Platform, tick: number, clock: MotionClock, local: Vec3): Vec3;
}

export const movingWorldOf = (resolved: ResolvedTrack, nav: TrackNav): MovingWorld;
```

Rules, all measured or fixed here:
- **Role.** `fragile` if `config.fragile`; `gate` if `config.trapDoor`; `sweeper` if `config.punch`
  or a `hazard`; else **floor iff** the body's top face at rest lies within
  `BOT_RIDE_TOP_TOLERANCE_M` (0.6) of a navmesh floor point found by `navFloorWithin` within
  `BOT_RIDE_NEAR_FLOOR_M` (3) of its rest footprint, and its top area is at least
  `BOT_RIDE_DECK_MIN_M2` (4); else sweeper. (A bar's top is 1.8 m up, a sliding wall's 3 m, a
  hanging ball's higher; a slide row over the void has still rows 2 m away at its own height.)
- **Deck hull**: the convex hull of the hitbox corners whose y is within `NAV_AGENT_CLIMB` of
  the body's top. **Platform grouping**: floors whose Motions have the same kind, speed/period,
  phase and the same world-space axis line (spin/swing) or offset (slide) are one platform.
- **Cost.** Build: one `navFloorWithin` per body, hulls of a few dozen points: ≤ 5 ms per Track.
  Runtime: the pose cache fills `bodies × 1` new Tick per Tick (base race 32 × 0.5 µs = 16 µs per
  Tick for the whole Lobby, not per Bot); `near` is a loop over `bodies` reading the cache.
- `BotTrack` gains `readonly moving: MovingWorld`, built in `botTrackOf` on the loop (cheap).

### 3. Gated floors on the navmesh (`bot/navInput.ts`, `bot/navMesh.ts`, `bot/Bot.ts`)

A trap door's leaves and a fragile block are bodies (they can be switched off), so today they
are holes in the navmesh, and nothing can route over them at all. `BotStillWorld` gains
`gatedFloors: { segmentIndex: number; boxes: OrientedBox[]; surfaces: SurfaceId[]; trimeshes: StaticTrimesh[] }[]`
(rest pose, world space; packed like `staticTrimeshes`), rasterised walkable by
`trackNavInput`. After the build `markGatedPolys(nav, gatedFloors)` sets `GATED_FLAG = 8` on
every polygon whose centre lies in a gated footprint and fills `TrackNav.gated: Map<polyRef,
segmentIndex>`. The default filter includes them; `BROKEN_FLAG = 16` is excluded by every
filter and `LAST_CRACK_FLAG = 32` by none (07f's `planFilterFlags` asks for it);
`MovingWorld.syncFragile(nav, fragile)` (called once per Tick by the driver, from the
**undelayed** state) sets/clears both on a block's polygons with `setPolyFlags`: BROKEN while
`hits ≥ entries`, LAST_CRACK while `hits === entries − 1`. The
ground probe (`markVoidEdges`) sees no border between a deck and a shut leaf, so nothing there
reads as a drop.

### 4. Hooks in `PathFollower` (`bot/PathBot.ts`, `bot/hooks.ts`)

```ts
// bot/hooks.ts
export interface HookContext {
  readonly tick: number;                      // the Tick the input is for; poses are exact at every tick, only `self` is late
  readonly view: BotWorldView;                // track.moving, runningFromTick, fragile
  readonly self: Readonly<CharacterSnapshot>;
  readonly profile: BotProfile;               // lookAheadTicks, timingErrorTicks
  readonly stale: StaleWindow;                // how late `self` may be (EdgeGuard.stale)
  readonly seed: string;                      // for `botDraw` timing jitter
  readonly path: readonly NavCorner[];
  readonly corner: number;                    // the corner being steered for
}
/** 07a, 07f: may replace a move with a stand, a retreat, or leave it. Applied in order; the first that changes the move wins. */
export interface HoldHook { hold(ctx: HookContext, steering: Steering): Steering; }
/** 07b: owns the Bot while it boards, rides and alights. */
export interface RideHook {
  /** A path from `from` to `goal` through platforms, when the navmesh alone does not join them; null if none. Corners with `ride` set start a ride. */
  planAcross(ctx: Pick<HookContext, "view" | "seed">, from: Vec3, goal: Vec3): NavCorner[] | null;
  /** Non-null when the Bot is boarding, aboard or alighting: the whole Steering for this Tick (committed, so the guard and the other hooks leave it alone). */
  steer(ctx: HookContext): Steering | null;
}
/** 07c: bends the move for the floor's own flow and tells the guard the drift. */
export interface PushHook { compensate(ctx: HookContext, steering: Steering): Steering; }
export interface PathHooks {
  hold?: readonly HoldHook[];
  ride?: RideHook;
  push?: PushHook;
  /** 07f: extra polygon flags the *first* plan excludes (`navFilterFor`); the never-stranded second plan drops them, as `plan()` already does for EDGE_STRIP_FLAG. */
  planFilterFlags?: (ctx: Pick<HookContext, "view">) => number;
}
/** One line per part is added here, nothing else: `defaultHooks` is what `TreeBot` installs. */
export const defaultHooks = (profile: BotProfile, seed: string): PathHooks => ({});
```

`NavCorner` gains `readonly ride?: number` (an index into the ride hook's own table; null
elsewhere). `Steering` gains `readonly drift?: Vec3` (the belt flow under the Bot, 07c).
`PathFollower`'s constructor becomes `(guard, hooks: PathHooks, profile: BotProfile, seed: string)`.
`EdgeGuard.guard(view, move, dash, props, drift: Vec3 | null = null)` adds `drift · TICK_DT` to
every played Tick's position, including the stop; `TreeBot.think` passes `steering.drift`.

Where each hook is called in `follow()`, in order:

```
1. link replay continuing                     → return committed             (unchanged)
2. landing wait                                                                (unchanged)
3. ride.steer(ctx)  — if non-null → steering = it (committed), skip to 8    (07b)
4. replan decisions → plan(); if the plan does not join the goal
   (last corner > BOT_LEG_JOINED_M from it) and ride.planAcross gives a path → use it   (07b)
5. unstall                                                                     (unchanged)
6. steering = steer()                                                          (unchanged; a corner with `ride` set is handed to ride.steer next Tick)
7. for hook of hold: if !steering.committed → steering = hook.hold(ctx, steering)   (07a, 07f)
   if !steering.committed → steering = push.compensate(ctx, steering)              (07c)
8. noteStall (a zero move from a hold is "waiting", not a stall, as today)
```

A hold never sets `committed`; the guard still runs over its output. A ride's output is
committed: the guard has no edges on a moving deck, and the rider owns edge safety aboard.

### 5. Shared corridor sampling (`bot/hooks.ts`)

```ts
/** Sample points along the Bot's next stretch of path, with the Tick it reaches each at its floor's walk speed from where it sees itself. */
export const corridorAhead = (ctx: HookContext, metres: number, step: number): { p: Vec3; arriveTick: number }[];
```
07a and 07f read it; it is one loop over corners, no allocation beyond the array.

### 6. The section harness (`bot/sectionHarness.ts`, tests import it)

```ts
export const loadTestLibrary = (): Promise<Record<string, Module>>;   // the assetsRoot boilerplate every suite copies today
export interface SectionRun {
  track: Track; library: Record<string, Module>; botTrack: BotTrack;   // botTrack built once per suite file, Motion running unless `atRest(track)` was passed
  /** Spawn on Checkpoint `leg - 1`'s Respawn deck in a 4 × 3 grid (1.1 m apart; the Respawn lies before its arch, so the first thing every Bot does is cross it for real); the Start for leg 0. Pass = `checkpointIndex ≥ leg`, or `finishTick` past the last Checkpoint. */
  leg: number;
  level: BotLevel; seed: string; bots?: number /* 12 */; capSeconds: number;
  /** Default: `botProfile(level, seed)` with aggression 0. */
  profile?: (level: BotLevel, seed: string) => BotProfile;
}
export interface SectionOutcome {
  passed: number; stranded: number; slow: number;   // stranded: unpassed and < 1 m moved over the last 10 s at the cap; slow: the rest
  falls: Record<string, number>;                    // ticket 06's classifier: ragdollCause | Bump | Stagger | contact | pushed | belt | step-off
  passTicks: number[]; thinkUsPerBotTick: number; where: string[];
}
export const playSection = (run: SectionRun): Promise<SectionOutcome>;
export const ownFalls = (falls: Record<string, number>): number;       // everything but Bump, contact, pushed, belt
export const obstacleFalls = (falls: Record<string, number>): number;  // Obstacle + WallImpact + Stagger + pushed + Spiked
```
The view it builds carries `runningFromTick: sim.motionClock` and `fragile: state.fragile`, and
it calls `syncFragile` each Tick. **The quick loop** every part's suite has:
`describe.skipIf(!process.env.BOT_QUICK)("quick", …)` running one leg, one level, one seed from
`BOT_LEG`/`BOT_LEVEL`/`BOT_SEED`, logging the outcome and `where`. The acceptance `describe`
runs the fixed set.

### 7. Tuning (`tuning/bots.ts`, a new "Moving Segments (M17 ticket 07)" block)

Groundwork adds `BOT_LOOK_AHEAD_TICKS_MAX` (read off `BOT_LEVEL_SPREADS.*.lookAheadTicks.max`,
never copied), `BOT_RIDE_TOP_TOLERANCE_M`, `BOT_RIDE_NEAR_FLOOR_M`, `BOT_RIDE_DECK_MIN_M2`. Each
part adds its own constants under its own comment; none is copied into a test.

### Built (2026-09-24, the main session)

§1–§7 are in, every suite green (`neverStepsOff -t "every Motion stopped"`: 0 own Falls, base race
12/12/12, Spin Cycle 12/12/12, Slip Stream 8/12/12, as before; `links`, `edgeGuard`, `neverStranded`,
`TreeBot`, `navMesh`, `fight`, `matchRuntime.bots`, `matchRuntime.botFill` all pass; typecheck clean in
`packages/shared`, `apps/server`, `apps/track-builder`). Files, and what a part may rely on:

- `bot/Bot.ts` — `BotWorldView.runningFromTick?: MotionClock` and `.fragile?`. **Deviation:**
  `runningFromTick` is *optional* (absent reads as `null`, no Ramp runs) so the dozens of views the
  suites and the bench build stay valid; `HookContext.clock` is the resolved value. `BotTrack.moving:
  MovingWorld`. `botStillWorldOf(resolved)` (the still world plus `gatedFloors`) and `gatedFloorsOf`;
  `buildBotTrack` and the server's `botTracks.ts` go through it. Filled by `BotDriver.inputsFor(tick,
  rules, clock, snapshot, inputs)` (`matchLoop.ts` passes `rt.simulation.motionClock`), by
  `scripts/bench-simulation.ts`, and by the harness. `perceptionDelay.ts` delays `fragile`.
- `bot/movingWorld.ts` — as specified: `MovingRole`, `Hitbox`, `MovingBody`, `Platform`,
  `MovingWorld` (`poseAt` / `velocityAt` / `solidAt` / `occupies` / `near` / `platformUnder` /
  `toLocal` / `toWorld` / `syncFragile`), `movingWorldOf`, plus `convexHull` and `inHull` exported
  for 07b. Details settled building it: `deck` is filled for `gate` and `fragile` bodies too (07f
  wants a leaf's hull), `platforms` come from floors only; a solid turned on its side becomes its
  rotated corners' AABB (yaw 0); `near` samples every Tick of the window only for bodies whose origin
  moves (`originMoves`), a spin about its own origin is checked once; `periodTicks` is the longest
  component when a Motion has several kinds; a glove's every piece is solid by `punchLanded`.
  **Inventory** (the role test logs it): base race 5 floors / 27 sweepers, five platforms of one;
  Spin Cycle 14 floors / 128 sweepers, seven platforms (2, 2, 2, 2, 1, 1, 4) — the carousel groups
  as four, not eight; 07b/07e, check which pieces before trusting the count.
- `bot/navInput.ts`, `bot/navMesh.ts` — `BotStillWorld.gatedFloors?: GatedFloor[]` (optional;
  `botStillWorldOf` fills it), rasterised walkable **with area ids of their own** (Recast never merges
  regions across areas, so the polygons stop at the floor's edge — without this a block butted
  between two lanes was one polygon with them and nothing was flagged; `NavInput.surfaces` may now
  repeat a Surface). `GATED_FLAG = 8` / `BROKEN_FLAG = 16` / `LAST_CRACK_FLAG = 32`;
  `markGatedPolys(nav, gatedFloors)` fills `TrackNav.gated: Map<polyRef, segmentIndex>`;
  `TrackNavData.gated` carries it across the worker (flags travel in Detour's own data). The default
  filter and every `navFilterFor` exclude `BROKEN_FLAG`. `NavCorner.ride?: number`;
  `keepOffEdges` keeps it.
- `bot/hooks.ts` — `HookContext` (with `clock`), `HoldHook`, `RideHook`, `PushHook`, `PathHooks`,
  `defaultHooks(profile, seed)` (returns `{}`; one line per part), `corridorAhead(ctx, metres, step)`
  (first sample is the Bot's own spot at `tick`; stops at a link's start).
- `bot/PathBot.ts` — `PathFollower(guard, hooks = {}, profile?, seed = "")` (profile defaults to
  NORMAL's on the seed) and **`follow(view, route, others)`** (was `(tick, self, nav, route,
  others)`; `TreeBot` and the two tests that called it are updated). Order in `follow()` as §4:
  ride.steer before the replan (committed), `planFilterFlags` on the first plan and
  `ride.planAcross` when neither plan joins the goal, then steer, holds in order (first change wins),
  push — none of it on a committed Steering. `Steering.drift?: Vec3`. With no hook registered no
  context is even built.
- `bot/edgeGuard.ts` — `EdgeGuard.guard(view, move, dash, props, drift = null)`: `drift · TICK_DT` on
  every played Tick, the stop included (on ice, over the braking run's Ticks); the early-out reach
  grows by the drift's speed. `TreeBot.think` passes `steering.drift`.
- `bot/sectionHarness.ts` — `loadTestLibrary`, `SectionRun`, `SectionOutcome`, `playSection`,
  `ownFalls`, `obstacleFalls` (Blast counted too), plus `sectionBotTrack(track, library)`.
  **Deviations:** `library` and `botTrack` are optional (built once per Track *object* and kept —
  pass the same `Track` value from a suite's top level, and `atRest(track)` once, not per call); the
  sim is built with `motionClock: 0` so Ramps run as in a Round; for `leg > 0` each Bot's *view*
  carries `checkpointIndex ≥ leg − 1` (the simulation has no setter and the Race goal would otherwise
  run back to Checkpoint 0). `BOT_QUICK`'s `describe.skipIf` loop is each part's own, as specified.
- `tuning/bots.ts` — the block "Moving Segments (M17 ticket 07)": `BOT_LOOK_AHEAD_TICKS_MAX` (from
  the spread table), `BOT_RIDE_TOP_TOLERANCE_M`, `BOT_RIDE_NEAR_FLOOR_M`, `BOT_RIDE_DECK_MIN_M2`.
- Tests: `bot/movingWorld.test.ts` (poses vs `movingSegmentPose` at rest and under a Ramp on two
  clocks; roles on both Races; a trap door and a glove posed and solid/not over a period; a fragile
  block on the mesh, flagged, and off every route once broken), `bot/sectionHarness.test.ts` (one
  base-race section, 4 Bots, 20 s, in ~1.2–1.7 s wall).

**Performance** (M4, quiet): pose cache **24.6 µs per new Tick** for the base race's 32 bodies
(target 20 — missed; a cache hit is 0.026 µs, so the cost is `movingSegmentPose` itself at ~0.77 µs a
call here against the 0.5 the target assumed; the fix, if wanted, is in `movingSegmentPose`'s array
spread, not the cache); `follow()` with no hooks 1.8–2.7 µs against 2.6 µs with no-op hooks
registered (≤ 1 µs, within noise); Slip Stream's build 150–160 ms warm (2.0 s cold), of which
`gatedFloorsOf` + `markGatedPolys` + `movingWorldOf` are 0.6 ms (≪ 10%).

## Blocked by: 06b

**Status:** planned; groundwork spec written 2026-09-24

- [ ] Moving bodies as navmesh obstacles over a time window: "is this corridor stretch clear
      from t to t + crossing time"
- [ ] Riding: a moving deck as a link whose ends move; board when the ends meet
- [ ] Trap door (open = hole), fragile floor (replicated state, ADR 0118), belts (a conveyor
      is a cost or a gift along its direction), Shooter lanes, glove reach
- [ ] Look-ahead = `lookaheadSeconds` × timing error from the Bot's profile (08); EASY
      misjudges by design, but the misjudgement can never be "step into the void" (06)
- [ ] Suite: the four authored Tracks and the base race **with Motion running**; a HARD Bot
      finishes every Race, and Falls are counted per section and reported (ticket 11 reads them)
      — **07d built the suite (`bot/races.test.ts`, gated by `BOT_RACES=1`) and the report
      (`playRace` → `RaceReport`) and it is red: HARD finishes 1/12 on the base race, 0/12 on Spin
      Cycle, 8/12 on Slip Stream; the per-section Falls table is in 07d's "As built"**
- [ ] **Re-measure the level ordering once look-ahead is in** (the user's question, 2026-09-24).
      **Measured by 07d (2026-09-24): inverted.** One Bot, Checkpoint 4 → finish, 16 seeds a level:
      EASY 86.6 s / 1 unfinished, NORMAL 132.6 s / 10, HARD 144.2 s / 14; obstacle Falls 0.25 / 0.44 /
      0.50. A HARD Bot stands at Checkpoint 4's deck for the cap in a hold that never clears —
      `lookAheadTicks` separates the levels the wrong way there (07d's "As built", §3).
      `difficulty.test.ts` asserts the strict order and is red.
      Ticket 08 found HARD falling more than NORMAL (3 vs 1, n = 12), with only reaction time and
      clumsiness in play: `lookAheadTicks` and `timingErrorTicks` were read by nothing yet, and no
      edge guard existed (06). Here, with both in, log Falls by cause and assert the strict order
      EASY > NORMAL > HARD in finish time **and** in Falls from obstacles, over enough seeds for
      the difference to beat run-to-run noise (ticket 08's `difficulty.test.ts` asserts only
      `easy ≥ normal ≥ hard`; tighten it here)
- [ ] **Belts in the guard and in steering** (moved from 06 by the user, 2026-09-24): a Bot on a belt
      compensates its push, a belt across it near an edge never carries it off, and any Fall 06
      logged as "belt" is gone
