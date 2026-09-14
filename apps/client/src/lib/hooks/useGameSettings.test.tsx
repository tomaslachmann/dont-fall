import { describe, expect, it, vi, afterEach } from "vitest";
import * as React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useGameSettings } from "./useGameSettings.js";
import { WithQuery } from "../../test/query.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useGameSettings", () => {
  it("resolves to the live settings once they arrive", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ maxPlayers: 10, onlinePlayers: 42 }), { status: 200 })),
    );

    const { result } = renderHook(() => useGameSettings(), { wrapper: ({ children }: { children: React.ReactNode }) => <WithQuery>{children}</WithQuery> });
    expect(result.current).toBeNull();

    await waitFor(() => expect(result.current).toEqual({ maxPlayers: 10, onlinePlayers: 42 }));
  });

  it("stays null when the API can't be reached — callers fall back, never crash", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "down" }), { status: 500 })),
    );

    const { result } = renderHook(() => useGameSettings(), { wrapper: ({ children }: { children: React.ReactNode }) => <WithQuery>{children}</WithQuery> });

    await act(async () => {});
    expect(result.current).toBeNull();
  });
});
