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

// three's GLTFLoader reads embedded-Texture blobs through `self.URL` — a
// browser/worker global this jsdom setup doesn't provide. Node's own URL
// backs it; Texture decode still fails down the line (no Image), which the
// loader tolerates with a warning, because no test asserts on Texture
// bitmaps — only meshes and their visual/collision roles. Same shim as the
// track-builder's setup (textured kaykit GLBs parse in node or nowhere).
(globalThis as { self?: typeof globalThis }).self ??= globalThis;

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
