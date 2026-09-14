import { afterEach, describe, expect, it, vi } from "vitest";
import { httpAccountResolver } from "./accountResolution.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("httpAccountResolver", () => {
  it("resolves a session token to its Account id via the API's own /auth/me", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: "acc-1", displayName: "Wobble" }) });
    const resolver = httpAccountResolver("http://api:9999", fetchMock as unknown as typeof fetch);

    await expect(resolver.resolveAccount("tok-abc")).resolves.toBe("acc-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe("http://api:9999/auth/me");
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({
      headers: { Authorization: "Bearer tok-abc" },
    });
  });

  it("a refused token resolves to null — the connection plays anonymous, never closed", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    const resolver = httpAccountResolver("http://api:9999", fetchMock as unknown as typeof fetch);

    await expect(resolver.resolveAccount("stale")).resolves.toBeNull();
    expect(error).toHaveBeenCalled();
  });

  it("a down API resolves to null — degraded presence, never a dead Match", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const resolver = httpAccountResolver("http://api:9999", (() => Promise.reject(new Error("down"))) as never);

    await expect(resolver.resolveAccount("tok-abc")).resolves.toBeNull();
    expect(error).toHaveBeenCalled();
  });

  it("a malformed account payload resolves to null — never a throw out of the socket handler", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ displayName: "no-id" }) });
    const resolver = httpAccountResolver("http://api:9999", fetchMock as unknown as typeof fetch);

    await expect(resolver.resolveAccount("tok-abc")).resolves.toBeNull();
    expect(error).toHaveBeenCalled();
  });
});
