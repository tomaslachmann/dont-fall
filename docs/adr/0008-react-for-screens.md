# 0008 — React for Screens, not for the HUD

The out-of-match UI — menus, lobby, settings, account/registration, results, the
spectator Bet screen — is built with **React**. React owns the top-level app
shell and routing (`react-router`); the "Play" route mounts a `<GameCanvas>`
component that boots the Three.js game and receives its config as props plus
`onMatchEnd` / `onExit` callbacks. The game's fixed-timestep loop never runs
through React.

The **HUD** (the in-match overlay: tick/fps now, later the Round timer, dash
cooldown, Power-up, Checkpoint splits) stays plain DOM, drawn by the game itself.
It updates every frame and has no place in a component tree.

`apps/client` stays a single Vite app with `@vitejs/plugin-react`. The game
module (Three + Rapier WASM) is **code-split behind a dynamic `import()`** so
menus and the account flow load without waiting on the physics engine.

React is adopted **when the first Screen is built** — the M4 match-structure
ticket (lobby / results), or earlier if accounts are pulled forward. M1's
three-line HUD is left as-is.

## Considered options

- **React shell + plain-DOM HUD** (chosen) — familiar, huge ecosystem for the
  form/router/state work that Screens actually are; VDOM cost never lands because
  Screens aren't in the render loop.
- **SolidJS / Svelte** — lighter runtime, better fit *if* the HUD went through the
  framework. It doesn't, so the ecosystem argument wins.
- **Framework for HUD too** — rejected: per-frame values through a component tree
  is friction with no benefit over `element.textContent`.
- **Phase state machine instead of a router** — rejected: a router from the first
  Screen avoids a later rewrite and enables shareable lobby links.

## Consequences

- At adoption, `apps/client` entry flips from booting the game directly to
  rendering `<App>`; the current `main.ts` game bootstrap becomes what
  `<GameCanvas>` calls.
- The game exposes a small typed boundary (config in, `onMatchEnd`/`onExit` out).
  No shared mutable state between React and the loop.
