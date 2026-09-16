import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// Same convention as apps/client: explicit vitest imports, no globals,
// so @testing-library/react's auto-cleanup needs registering by hand.
afterEach(cleanup);

// three's GLTFLoader reads embedded-Texture blobs through `self.URL` — a
// browser/worker global this jsdom setup doesn't provide. Node's own URL
// backs it; Texture decode still fails down the line (no Image), which the
// loader tolerates with a warning, because no test asserts on Texture
// bitmaps — only meshes and their visual/collision roles.
(globalThis as { self?: typeof globalThis }).self ??= globalThis;

// jsdom has no IntersectionObserver; the engine treats a missing one as
// "everything visible" (production browsers always have it), but the
// palette tests want the real observe/unobserve wiring exercised.
if (typeof window !== "undefined" && !window.IntersectionObserver) {
  window.IntersectionObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof IntersectionObserver;
}
