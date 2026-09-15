# 0063 — The Track builder gets a React shell over a framework-free engine

## Context

The Track builder grew as vanilla DOM: one `index.html` plus an imperative
`main.ts` that built every palette entry, inspector row and motion field by
hand. That was fine for a tool with fifteen Modules and no design — then two
things changed at once:

1. The asset drops took the placeable set from ~20 to 400+ pieces, and the
   palette needed search, filters, packs and per-tile load states — real UI
   state, the kind imperative DOM does badly.
2. The new builder design arrived as React + CSS Modules (`apps/track-builder/new_design`,
   since absorbed into `src/`). Porting it to vanilla DOM by hand would have
   meant maintaining the same design twice, with every future design update
   paying the port cost again.

Meanwhile the client settled the equivalent question years ago (ADR 0008,
M4 ticket 01): React owns the shell, the game loop never runs through React,
and the seam is a mount-a-div boundary (`<GameCanvas>`). The builder is a dev
tool, not the game — but its needs are the same shape: a reactive shell
around a real-time viewport and a frame-clocked motion preview.

## Decision

**The builder is a React app with a framework-free engine.** The cut mirrors
the client's:

- `src/engine.ts` (`BuilderEngine`) owns every fact `main.ts` used to own —
  history, selection, gizmo/axis, status, asset loading, the Motion clock,
  persistence — as plain TypeScript with `subscribe`/`subscribeClock`
  listeners. It touches no DOM at creation, so tests drive it headless.
- React (`main.tsx`, `screens/TrackBuilder`, `components/`) subscribes via
  `useSyncExternalStore` and renders. Structural changes re-render the shell;
  the 60 Hz Motion clock has its own subscription feeding only the Transport,
  so the clock never re-renders the palette.
- The Three.js viewport and the Motion panel stay **imperative islands**
  mounted into React-owned divs via refs (`engine.attachViewport`,
  `engine.attachMotionPanel`) — the `<GameCanvas>` pattern, not a rewrite.
  The motion panel reuses the design's own CSS modules directly.
- The design prototype's presentational components are used as-is wherever
  they had no mock-only state; mock-only state (counts, sentences, tile
  states) is wired to engine facts or derived client-side (search, sort,
  saved queries, favourites in `localStorage`).

`main.ts` is deleted, not kept beside the shell: two entry points would rot
within a week. Its logic moved into the engine 1:1 (same edit paths, same
status texts, same keyboard map), and `engine.test.ts` plus the screen smoke
test cover what `main.contexts.test.ts` used to.

## Consequences

- New builder dependencies, pinned to the client's versions: `react`,
  `react-dom`, `@vitejs/plugin-react`, plus `jsdom`/`@testing-library/*` for
  tests (the builder's `vitest.config.ts` mirrors the client's, including
  the React-plugin-in-both-configs split).
- M10's Compose mode plugs into the same shell: the BUILD/COMPOSE switch is
  already rendered (COMPOSE unwired, titled as M10's), and the engine gains
  a draft + primitive operations without touching the viewport island.
- The light-theme viewport (lavender canvas, brand selection, purple motion
  ghosts) is part of this decision: a dark 3D hole in a light tool would
  have been the port's most visible seam. Marker/tint/guide colors are
  unchanged — they already read on light.
