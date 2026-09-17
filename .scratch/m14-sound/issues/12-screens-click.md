# 12 — Screens click

**What to build:** menu sounds on the React Screens (ADR 0008). **ADR 0087.**

**Blocked by:** 02, 03

**Status:** done on tests (2026-09-17). Hearing the Screens is the user's check.

## How it behaves after

- Buttons click on press. Confirming actions (Ready, Start, Save) confirm, and
  back/close actions go back. Toggles and sliders tick.
- Sounds play on the ui bus. They follow MASTER only, since there is no UI
  slider.
- Before the first gesture nothing plays, and the press itself resumes the
  context.
- The menu bundle stays free of three.js: the ui sounds use a small player on
  the same `AudioContext`, not the game's engine module.

## What to change

- [x] A tiny `useUiSound()` for `packages/ui` components (or the client shell),
      with the sound player injected so `packages/ui` has no audio files of its
      own
- [x] `Button`, `Toggle`, `Slider`, `Switch`: a `sound` prop defaulting per role
- [x] Tests: each role plays its slot once, nothing when muted, no three.js import
      in the menu bundle (the existing code-split boundary)

## Notes

- Research §10. Interface Sounds: `click_*`, `confirmation_*`, `back_*`,
  `toggle_*`, `tick_*`.

## As built

- **One delegated listener instead of a hook per component.** The Screens have about 50 raw
  `<button>`s besides the kit's controls, and `packages/ui`'s `Button` (the main menu).
  - `audio/uiSounds.ts: installUiSounds(document, play)`, installed once in `main.tsx`, hears
    every `click` (a keyboard press too) and every range `input`.
  - The nearest enabled button, switch or `[data-ui-sound]` element decides the sound
    (`uiSoundOf`):
    - its `data-ui-sound` (`click` / `confirm` / `back` / `toggle` / `tick` / `none`) if it has one;
    - otherwise a `role="switch"` toggles and anything else clicks.
  - Disabled controls are silent. Sliders tick at most every 60 ms, and their own clicks don't also
    click.
  - `packages/ui` needs no change and has no audio of its own.
- **The player:** `createUiSoundPlayer()`, three-free.
  - Nothing is created until the first press, so the page's shared context (ticket 11's
    `sharedContext.ts`) is born inside a gesture.
  - It decodes the five `ui.*` slots and plays them on a small engine of its own, at MASTER only.
    MASTER 0 is silent through the budget.
  - A press on a suspended context resumes it and plays once it runs.
- **Roles, the `sound` prop:**
  - `JellyButton`: `sound` sets the attribute. The default is a click.
  - `Toggle`, `Switch`: `toggle`.
  - `ReadySwitch`: `confirm` when turning Ready on, `toggle` when turning it off.
  - `Slider` and `Stepper`: `tick`.
  - **Confirm:** START MATCH, SAVE, DONE, COLLECT REWARDS, PLAY AGAIN, the Auth submit.
  - **Back:** BACK, the back arrows, the × closes, BACK TO LOBBY, EXIT, LEAVE, LEAVE MATCH, SKIP,
    MAIN MENU.
- **The menu bundle:** `codeSplitBoundary.test.ts` now also fails if any file the shell reaches
  statically imports `three`. `audio/gameAudio.ts`, the one audio file that needs three, stays
  game-side.
- **Tests:** `audio/uiSounds.test.tsx`:
  - roles, including a nested label and `none`;
  - silence when disabled and for non-controls;
  - switches, toggles, Ready and steppers;
  - the slider throttle;
  - uninstall;
  - no context before the first press;
  - a suspended context resumed by the press, then heard.
