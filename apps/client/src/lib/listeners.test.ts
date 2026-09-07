import { describe, expect, it, vi } from "vitest";
import { listen } from "./listeners.js";

const fakeTarget = () => {
  const listeners = new Map<string, Set<EventListener>>();
  return {
    listenerCount: (): number => [...listeners.values()].reduce((n, set) => n + set.size, 0),
    dispatch: (type: string): void => {
      for (const listener of listeners.get(type) ?? []) listener({ type } as Event);
    },
    addEventListener: (type: string, listener: EventListener): void => {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener: (type: string, listener: EventListener): void => {
      listeners.get(type)?.delete(listener);
    },
  };
};

describe("listen", () => {
  it("registers the handler and returns the function that removes exactly it", () => {
    const target = fakeTarget();
    const handler = vi.fn();

    const stop = listen(target, "keydown", handler);
    target.dispatch("keydown");
    expect(handler).toHaveBeenCalledTimes(1);

    stop();
    target.dispatch("keydown");

    expect(handler).toHaveBeenCalledTimes(1);
    expect(target.listenerCount()).toBe(0);
  });

  it("is safe to stop twice", () => {
    const target = fakeTarget();
    const stop = listen(target, "click", vi.fn());

    stop();

    expect(() => stop()).not.toThrow();
    expect(target.listenerCount()).toBe(0);
  });
});
