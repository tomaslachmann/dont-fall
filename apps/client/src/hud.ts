/**
 * The in-match overlay (CONTEXT.md: HUD) — plain DOM, drawn by the game
 * itself, never by the Screen framework (ADR 0008). It updates every frame and
 * has no place in a component tree.
 *
 * The game creates and removes these elements rather than reaching for markup
 * in `index.html`: from M4 the page belongs to React (ADR 0008), the game is
 * mounted and unmounted as a route, and a HUD it does not own would either
 * outlive it or have to be reset by whoever did own it. Styles are inline for
 * the same reason — nothing about the HUD leaks into the page's stylesheet.
 */
export interface Hud {
  /** Replace the overlay text. Called once per rendered frame. */
  setText: (text: string) => void;
  /** Show or hide the "click to look around" prompt, following pointer-lock state. */
  setLockPromptVisible: (visible: boolean) => void;
  /** Remove both elements from the page (M4 ticket 01). */
  dispose: () => void;
}

export const createHud = (mount: HTMLElement): Hud => {
  const text = document.createElement("div");
  Object.assign(text.style, {
    position: "fixed",
    top: "12px",
    left: "12px",
    font: "12px/1.4 ui-monospace, monospace",
    color: "#8ba0b8",
    whiteSpace: "pre",
    pointerEvents: "none",
  });

  const lockPrompt = document.createElement("div");
  lockPrompt.textContent = "click to look around · Esc to release";
  Object.assign(lockPrompt.style, {
    position: "fixed",
    inset: "0",
    display: "grid",
    placeItems: "center",
    font: "500 15px/1.4 ui-monospace, monospace",
    color: "#cdd9e5",
    background: "rgba(11, 14, 20, 0.55)",
    letterSpacing: "0.04em",
    pointerEvents: "none",
  });

  mount.append(text, lockPrompt);

  return {
    setText: (value) => {
      text.textContent = value;
    },
    // Toggling `display` directly rather than the `hidden` attribute: the UA's
    // own `[hidden] { display: none }` loses to this element's own `display:
    // grid`, so `hidden` alone would leave the prompt on screen.
    setLockPromptVisible: (visible) => {
      lockPrompt.style.display = visible ? "grid" : "none";
    },
    dispose: () => {
      text.remove();
      lockPrompt.remove();
    },
  };
};
