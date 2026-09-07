# 08 — `apps/client/src` gets a shape

**What to build:** Nothing new, and nothing edited. Thirty-six files at the root of
`apps/client/src` move into folders by what they are.

The client grew a React shell, three Screens, a HUD, a netcode stack and a renderer without ever
gaining a structure, so the root now mixes `LobbyScreen.tsx` with `snapshotInterpolation.ts` and
`characterModel.ts`. It also contains a genuine trap: **`src/game.ts` and `src/game/` both exist,
named backwards** — the directory holds `GameCanvas.tsx`, which is React and ships in the menu
bundle, while the file is the game module that must not.

**Blocked by:** M4.5 tickets 01–07, all done. In practice it is blocked on a **clean working tree**
— see the sequencing note below, which matters more than the ordering.

**Status:** done

## The layout

```
src/  main.tsx · App.tsx · app.css
  screens/    MainMenu · Lobby · Results
  components/ GameCanvas.tsx
  game/       index.ts — startGame, the frame loop
  render/     scene · speedLines · characterModel · wobble
  net/        connection · predictionLoop · snapshotInterpolation · timeSync ·
              netMetrics · propPrediction · reconcileGate
  hud/        hud · hudText · matchBanner · roundTimer
  input/      input · camera/lookControls · camera/springArm
  lib/        teardown · listeners
```

Tests move with the files they test. `src/test/setup.ts` stays where the vitest config expects it.

## The one thing this must not break

ADR 0008's code split. `GameCanvas` dynamically imports the game module so the menu does not pay
for Three.js, the Rapier WASM or the character model. Organising by kind rather than by that
boundary was chosen deliberately — but it means the boundary is **no longer visible in the tree**,
so the test below stops being a nicety and becomes the only thing holding it. A static import from
a Screen into the renderer would pull the whole engine into the menu bundle, fail nothing, break no
feature, and be noticed by nobody until someone measures a cold load.

- [x] Files move as above; `game.ts` becomes `game/index.ts`; `GameCanvas.tsx` moves to
      `components/`, since it is React and it is what *performs* the split rather than living
      behind it
- [x] A test asserts that nothing in the shell set (`screens/`, `components/`, `App.tsx`,
      `main.tsx`) statically imports anything in the game set (`game/`, `render/`, `net/`, `hud/`,
      `input/`). The two sets are named in **one** place, so adding a directory forces a decision
      about which side it is on
- [x] The dynamic `import()` in `GameCanvas` still resolves, and the game still loads on demand
- [x] Pure moves. `git mv` plus import paths and nothing else — **no renames of exports, no
      signature changes, no "while I'm here"**. A diff with logic in it is the wrong diff
- [x] Full suite green with no changed assertions (M4.5's standing rule; import paths may change)

## Sequencing — read before starting

Another session commits to this repo continuously. A thirty-six file move conflicts with every
uncommitted edit in the tree, and a conflict in a pure-move commit is miserable to resolve because
every hunk looks identical.

- [x] Start only with a clean `git status`, and land it as **one commit**
- [x] If it must be split, split **by destination directory** — never leave a concern half-moved
