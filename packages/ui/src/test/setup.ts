import "@testing-library/jest-dom/vitest";

// jsdom doesn't implement matchMedia; every component that calls
// useReducedMotion() needs this to exist. Defaults to "not reduced."
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

