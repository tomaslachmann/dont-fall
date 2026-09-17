import { PERF_COPY_KEY } from "./perfText.js";

/**
 * The performance overlay's panel (M13 ticket 01) — plain DOM like the rest of
 * the HUD (ADR 0008), created only when the overlay was asked for. It owns
 * its element and the two ways to copy a recorded run: a button, and a key.
 * The button is the one that always works: on a Mac, F8 is the media
 * play/pause key unless fn is held, and the browser never sees it. What the
 * panel shows is the caller's.
 */
export interface PerfOverlay {
  setText: (text: string) => void;
  /** A short-lived line under the button, e.g. "copied". */
  flash: (message: string) => void;
  dispose: () => void;
}

const FLASH_MS = 2500;

/** Under the button — how to reach it, since the mouse is locked while playing. */
export const PERF_COPY_HINT = `Esc, then click · or ${PERF_COPY_KEY} (fn+${PERF_COPY_KEY} on a Mac)`;

export const createPerfOverlay = (mount: HTMLElement, onCopy: () => void): PerfOverlay => {
  const panel = document.createElement("div");
  Object.assign(panel.style, {
    position: "fixed",
    right: "12px",
    bottom: "12px",
    padding: "8px 10px",
    font: "11px/1.45 ui-monospace, monospace",
    color: "#d7e3ef",
    background: "rgba(11, 14, 20, 0.72)",
    borderRadius: "6px",
    whiteSpace: "pre",
    pointerEvents: "none",
    zIndex: "10",
  });
  const text = document.createElement("div");

  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = "copy run";
  Object.assign(copy.style, {
    marginTop: "6px",
    padding: "2px 8px",
    font: "inherit",
    color: "#0b0e14",
    background: "#d7e3ef",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
    // The panel lets clicks through to the game; the button is the one part that takes them.
    pointerEvents: "auto",
  });
  // Clickable only with the mouse released, when the game ignores buttons anyway.
  copy.addEventListener("click", () => onCopy());

  const hint = document.createElement("span");
  hint.textContent = `  ${PERF_COPY_HINT}`;
  hint.style.color = "#8ba0b8";

  const note = document.createElement("div");
  note.style.color = "#9fd89f";
  const footer = document.createElement("div");
  footer.append(copy, hint);
  panel.append(text, footer, note);
  mount.append(panel);

  let flashTimer: ReturnType<typeof setTimeout> | undefined;
  const onKey = (event: KeyboardEvent): void => {
    if (event.code !== PERF_COPY_KEY || event.repeat) return;
    event.preventDefault();
    onCopy();
  };
  window.addEventListener("keydown", onKey);

  return {
    setText: (value) => {
      text.textContent = value;
    },
    flash: (message) => {
      note.textContent = message;
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => {
        note.textContent = "";
      }, FLASH_MS);
    },
    dispose: () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(flashTimer);
      panel.remove();
    },
  };
};
