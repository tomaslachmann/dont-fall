import { describe, expect, it } from "vitest";
import { PERF_FLAG_STORAGE_KEY, resolvePerfFlag } from "./perfFlag.js";

const memoryStorage = () => {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
};

const throwing = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

describe("resolvePerfFlag (M13 ticket 01)", () => {
  it("is off by default", () => {
    expect(resolvePerfFlag(new URLSearchParams(""), memoryStorage())).toBe(false);
    expect(resolvePerfFlag(new URLSearchParams(""), null)).toBe(false);
  });

  it("turns on with ?perf=1 and remembers it for a later visit without the param", () => {
    const storage = memoryStorage();
    expect(resolvePerfFlag(new URLSearchParams("perf=1&freeroam=1"), storage)).toBe(true);
    expect(storage.values.get(PERF_FLAG_STORAGE_KEY)).toBe("1");
    expect(resolvePerfFlag(new URLSearchParams("port=4000"), storage)).toBe(true);
  });

  it("turns off with ?perf=0 and forgets", () => {
    const storage = memoryStorage();
    resolvePerfFlag(new URLSearchParams("perf=1"), storage);
    expect(resolvePerfFlag(new URLSearchParams("perf=0"), storage)).toBe(false);
    expect(storage.values.has(PERF_FLAG_STORAGE_KEY)).toBe(false);
    expect(resolvePerfFlag(new URLSearchParams(""), storage)).toBe(false);
  });

  it("still honours the URL when storage throws, and never throws itself", () => {
    expect(resolvePerfFlag(new URLSearchParams("perf=1"), throwing)).toBe(true);
    expect(resolvePerfFlag(new URLSearchParams("perf=0"), throwing)).toBe(false);
    expect(resolvePerfFlag(new URLSearchParams(""), throwing)).toBe(false);
  });
});
