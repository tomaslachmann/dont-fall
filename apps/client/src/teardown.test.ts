import { describe, expect, it, vi } from "vitest";
import { createTeardown } from "./teardown.js";

describe("createTeardown", () => {
  it("runs disposers newest-first, so a resource is released before what it was built from", () => {
    const order: string[] = [];
    const teardown = createTeardown();
    teardown.add(() => order.push("world"));
    teardown.add(() => order.push("stage"));
    teardown.add(() => order.push("loop"));

    teardown.run();

    expect(order).toEqual(["loop", "stage", "world"]);
  });

  it("runs each disposer exactly once, however often run() is called", () => {
    const dispose = vi.fn();
    const teardown = createTeardown();
    teardown.add(dispose);

    teardown.run();
    teardown.run();

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("keeps disposing after one disposer throws — a single leak never strands the rest", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const after = vi.fn();
    const before = vi.fn();
    const teardown = createTeardown();
    teardown.add(before);
    teardown.add(() => {
      throw new Error("renderer already gone");
    });
    teardown.add(after);

    expect(() => teardown.run()).not.toThrow();

    expect(after).toHaveBeenCalledTimes(1);
    expect(before).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("disposes immediately anything registered after run() — an async straggler can't leak", () => {
    const teardown = createTeardown();
    teardown.run();

    const late = vi.fn();
    teardown.add(late);

    expect(late).toHaveBeenCalledTimes(1);
  });

  it("reports whether it has already run, so a bootstrap can abandon work mid-flight", () => {
    const teardown = createTeardown();
    expect(teardown.done).toBe(false);

    teardown.run();

    expect(teardown.done).toBe(true);
  });
});
