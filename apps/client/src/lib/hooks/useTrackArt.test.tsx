// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { WithQuery } from "../../test/query.js";
import { useTrackArt } from "./useTrackArt.js";

const { preloadTrackArt } = vi.hoisted(() => ({ preloadTrackArt: vi.fn() }));
vi.mock("../trackArt.js", () => ({ preloadTrackArt }));

const wrapper = ({ children }: { children: React.ReactNode }) => <WithQuery>{children}</WithQuery>;

afterEach(() => {
  vi.unstubAllGlobals();
  preloadTrackArt.mockReset();
});

describe("useTrackArt (ADR 0105)", () => {
  it("is ready only once the listing is in and every picture it names has settled", async () => {
    const listing = [{ id: "spin-cycle", revision: 3, hasThumbnail: true }];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(listing), { status: 200 })));
    let release!: () => void;
    preloadTrackArt.mockReturnValue(new Promise<void>((resolve) => (release = resolve)));

    const { result } = renderHook(() => useTrackArt(true), { wrapper });

    await waitFor(() => expect(preloadTrackArt).toHaveBeenCalledWith(listing));
    expect(result.current).toBe(false);
    await act(async () => release());
    expect(result.current).toBe(true);
  });

  it("never holds anything up when the listing itself fails — the fallbacks take over", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "down" }), { status: 500 })));

    const { result } = renderHook(() => useTrackArt(true), { wrapper });

    await waitFor(() => expect(result.current).toBe(true));
    expect(preloadTrackArt).not.toHaveBeenCalled();
  });

  it("asks for nothing before sign-in", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const { result } = renderHook(() => useTrackArt(false), { wrapper });

    expect(result.current).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});
