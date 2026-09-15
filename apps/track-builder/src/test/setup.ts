import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// Same convention as apps/client: explicit vitest imports, no globals,
// so @testing-library/react's auto-cleanup needs registering by hand.
afterEach(cleanup);

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
