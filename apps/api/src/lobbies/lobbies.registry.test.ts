import { describe, expect, it, vi } from "vitest";
import { LobbyRegistry } from "./lobbies.registry.js";

describe("LobbyRegistry.add", () => {
  it("a private Lobby gets a 6-character code", () => {
    const registry = new LobbyRegistry();
    const entry = registry.add(9000, true);
    expect(entry.code).toMatch(/^[A-Z0-9]{6}$/);
    expect(entry.isPrivate).toBe(true);
    expect(entry.port).toBe(9000);
  });

  it("a public Lobby gets no code — found by browsing/quick-match instead", () => {
    const registry = new LobbyRegistry();
    const entry = registry.add(9000, false);
    expect(entry.code).toBeUndefined();
    expect(entry.isPrivate).toBe(false);
  });

  it("never reuses an in-flight code, even under a forced collision", () => {
    const registry = new LobbyRegistry();
    const randomSpy = vi.spyOn(Math, "random");

    // First add(): every char picks the alphabet's first letter -> "AAAAAA".
    for (let i = 0; i < 6; i += 1) randomSpy.mockReturnValueOnce(0);
    const first = registry.add(9000, true);
    expect(first.code).toBe("AAAAAA");

    // Second add(): its first attempt is mocked to produce the exact same
    // "AAAAAA" (forcing a real collision against `first`), its second
    // attempt is mocked to produce something else entirely — proving the
    // registry's own retry-on-collision loop is what produced the
    // eventually-different code, not luck.
    for (let i = 0; i < 6; i += 1) randomSpy.mockReturnValueOnce(0); // collides with `first`
    for (let i = 0; i < 6; i += 1) randomSpy.mockReturnValueOnce(0.99); // succeeds, distinct
    const second = registry.add(9001, true);

    expect(second.code).not.toBe(first.code);
    randomSpy.mockRestore();
  });

  it("across many Lobbies, every code stays unique (no birthday-paradox collision slipping through)", () => {
    const registry = new LobbyRegistry();
    const codes = new Set<string>();
    for (let i = 0; i < 200; i += 1) codes.add(registry.add(9000, true).code!);
    expect(codes.size).toBe(200);
  });

  it("every Lobby gets its own id, distinct from any other's", () => {
    const registry = new LobbyRegistry();
    const a = registry.add(9000, true);
    const b = registry.add(9001, true);
    expect(a.id).not.toBe(b.id);
  });
});

describe("LobbyRegistry.get / getByCode", () => {
  it("resolves an id back to its entry", () => {
    const registry = new LobbyRegistry();
    const entry = registry.add(9000, false);
    expect(registry.get(entry.id)).toEqual(entry);
  });

  it("resolves a code back to its entry, case-insensitively", () => {
    const registry = new LobbyRegistry();
    const entry = registry.add(9000, true);
    expect(registry.getByCode(entry.code!)).toEqual(entry);
    expect(registry.getByCode(entry.code!.toLowerCase())).toEqual(entry);
  });

  it("an unknown id/code resolves to undefined, not an error", () => {
    const registry = new LobbyRegistry();
    expect(registry.get("nope")).toBeUndefined();
    expect(registry.getByCode("ABCDEF")).toBeUndefined();
  });
});

describe("LobbyRegistry.listPublic", () => {
  it("lists only public Lobbies — private ones are found by code, never browsed", () => {
    const registry = new LobbyRegistry();
    const pub = registry.add(9000, false);
    registry.add(9001, true);
    expect(registry.listPublic().map((e) => e.id)).toEqual([pub.id]);
  });
});

describe("LobbyRegistry.remove", () => {
  it("removes the entry and frees its code for reuse", () => {
    const registry = new LobbyRegistry();
    const entry = registry.add(9000, true);
    registry.remove(entry.id);
    expect(registry.get(entry.id)).toBeUndefined();
    expect(registry.getByCode(entry.code!)).toBeUndefined();
  });

  it("removing an unknown id is a no-op, not an error", () => {
    const registry = new LobbyRegistry();
    expect(() => registry.remove("never-existed")).not.toThrow();
  });
});

describe("LobbyRegistry.touch", () => {
  it("resets lastNonEmptyAt to the given time", () => {
    const registry = new LobbyRegistry();
    const entry = registry.add(9000, false);
    registry.touch(entry.id, 123_456);
    expect(registry.get(entry.id)!.lastNonEmptyAt).toBe(123_456);
  });

  it("touching an unknown id is a no-op, not an error", () => {
    const registry = new LobbyRegistry();
    expect(() => registry.touch("never-existed")).not.toThrow();
  });
});
