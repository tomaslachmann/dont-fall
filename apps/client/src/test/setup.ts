import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// @testing-library/react's own auto-cleanup relies on detecting a global
// `afterEach` (Jest, or Vitest with `globals: true`); this project keeps
// the explicit-import convention (`import { it } from "vitest"`, no
// globals), so cleanup between tests needs registering by hand here
// instead — otherwise a second `render()` in the same file piles its DOM
// on top of the first one's.
afterEach(cleanup);

// jsdom doesn't implement matchMedia; @dont-fall/ui's useReducedMotion()
// needs this to exist wherever it renders. Defaults to "not reduced."
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}
