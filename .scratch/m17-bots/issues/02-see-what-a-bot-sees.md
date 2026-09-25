# 02 — See what a Bot sees

**What to build:** a NAVMESH viewport toggle in the Track builder, beside the Environment
toggle, drawing the draft's navmesh, its jump links (ticket 05, once they exist) and one
start→finish path. It is the only way anyone, whether the user, the builder's author or an
MCP agent, can tell *why* a Bot runs where it runs. Every later ticket is debugged through it.

**Blocked by:** 01

**Status:** done on tests (2026-09-24)

- [x] The navmesh is generated in the builder from the same `packages/shared` code as the server;
      nothing builder-only decides where a Bot can walk
- [x] Drawn as a translucent overlay: walkable polygons, link arcs, the path as a line
      (link arcs are ticket 05's — not built here, but the overlay is structured so drawing
      them is one more loop over `overlay.legs`, not a redesign)
- [x] Regenerated when the draft changes (debounced; generation cost from 01 decides how)
- [x] MCP: `screenshot_draft` can include the overlay (an option), so an agent building a
      Track can see where Bots cannot go

## As built

**The toggle.** `apps/track-builder/src/components/Transport/Transport.tsx` grew a NAVMESH
button right beside ENVIRONMENT, built from the exact same `.preview`/`.previewOn` CSS (no new
visual style) and wired to `engine.setBotNavVisible`/`engine.botNavVisible`.

**The build seam.** `apps/track-builder/src/bot/`:
- `botRoute.ts` — pure: `botRouteTargets(resolved, track, modules)` is the route's own
  waypoints (the Start's slot-0 spawn, every Checkpoint's Respawn in `resolveTrack`'s own
  order, then the first Finish Zone's centre, reading `gate.center`/`trigger.center` the same
  way `LiveRace.ts` already does); `buildBotLegs(nav, targets)` runs one `navPath` query per
  consecutive pair and marks a leg `complete` by comparing `navPath`'s last corner to the
  target on the ground plane (`NAV_AGENT_RADIUS * 3` — a corner sits at floor height, a
  Respawn a capsule's clearance above it, so comparing all three axes would flag every
  ordinary leg as short).
- `buildBotNav.ts` — orchestration: `initNavigation()` → `resolveTrack` → `trackNavInput` →
  `buildTrackNav` → `buildBotLegs`, `null` for an empty Track (Recast refuses one outright).

**The draw.** `apps/track-builder/src/scene/viewport.ts` gained `TrackViewport.setBotNav`,
built the same way `showLaunchArc` is: a `THREE.Group` holding the navmesh's own triangulation
(`getNavMeshPositionsAndIndices`, cyan, translucent, `polygonOffset` against the floor it sits
on) plus one `THREE.Line` per leg with an end marker reusing the Course overlay's own palette —
`COURSE.start.hex` (go-green) when the leg reaches its target, `COURSE.problem.hex` (the same
pink "nowhere to respawn" already means) when it stops short, including a leg with no path at
all (`navPath` returning `null`), which still gets a marker at its start.

**The debounce.** `apps/track-builder/src/engine.ts`: `scheduleBotNavRebuild()` runs from
`syncTrackView` (every structural and transform-only edit alike — a drag changes collision
too), so it fires on every edit but only actually rebuilds `BOT_NAV_DEBOUNCE_MS` (400 ms) of
quiet later, and only while the toggle is on — nothing is built while it's off. A generation
counter drops a build that resolves after a later edit, or the toggle, already moved on. The
last build is cached and re-sent on a viewport remount (StrictMode) while a fresh one runs
behind it in case the Track moved on meanwhile. `buildBotNav` is injectable
(`createBuilderEngine({ buildBotNav })`), so the engine's own tests stub it instead of paying
for Recast's real WASM.

**The MCP option.** `apps/mcp-track-builder/src/tools/screenshot.ts`'s `screenshot_draft` grew
an optional `navmesh: boolean` argument (off by default), threaded through
`ScreenshotDeps.render`/`createChromeRenderer`/`captureDraftScreenshot` as `&nav=1` on the
thumbnail page's own URL. `apps/track-builder/src/thumbnail/main.ts` reads it, builds the
overlay after `setTrack`, and calls `viewport.setBotNav` before capturing — a failed build
(an unresolvable Track) is warned to the console and skipped rather than failing the whole
screenshot.

**Dependency.** `recast-navigation` (already in `packages/shared`, from ticket 01) is now also
a direct dependency of `apps/track-builder` — `getNavMeshPositionsAndIndices` is the library's
own, not something `packages/shared` wraps, and the builder cannot resolve a package it
doesn't declare in a strict pnpm workspace. `pnpm install --store-dir <the recorded global
store> --offline` linked it from the store with no download (`pnpm-lock.yaml` gained one new
importer entry).

**Tests.** `apps/track-builder/src/bot/botRoute.test.ts` (new, 9 tests): `botRouteTargets`
against synthetic `ResolvedTrack`s (empty, Checkpoints-then-Finish, Survival's no-Finish, and
both Finish Zone shapes), and `buildBotLegs` against a stubbed `TrackNav` (`navPath` only ever
calls `query.computePath`, so no real WASM is needed) — one leg per pair, complete on a path
that reaches its target, incomplete on `success: false` and on Detour's own real finding from
ticket 01 (a partial path that lands well short). `apps/track-builder/src/engine.test.ts`
gained a "the NAVMESH overlay" block (5 tests) covering the debounce, the toggle, edit
coalescing and the stale-build guard, all against an injected fake build (fast, no WASM).
`apps/mcp-track-builder/src/tools/screenshot.test.ts` gained a case proving the option is off
by default and threads through when asked. `npx vitest run` on both packages: 822 and 22 tests
green.

**Typecheck.** `apps/track-builder`: clean. `apps/mcp-track-builder`: pre-existing failures in
files this ticket didn't touch (`src/tools.ts`, `segments.ts`, `sugar.ts`, the new
`mechanics.test.ts`) from a zod v4 install already in this dirty tree — `screenshot.ts` picks
up the same "no overload matches" against `server.tool`'s zod-v4-typed overloads that the
file's *unchanged* base version already called the same way, so it predates this ticket. Left
alone (fixing the SDK/zod mismatch is out of scope, and not this ticket's dependency to touch);
the runtime behaviour is unaffected — every `screenshot_draft` test passes.

**Open question — none blocking.** The line/marker colours (cyan mesh, white lines,
Course-palette markers) and the debounce window (400 ms) are first guesses, first compiled
here (no WebGL in this repo's suites) — the same "waiting on the user" position every other
M12+ visual milestone in `CLAUDE.md` is in. Nothing about the *data* (which legs, which
endpoints, when a leg counts as short) is a guess; only how it's drawn is.
