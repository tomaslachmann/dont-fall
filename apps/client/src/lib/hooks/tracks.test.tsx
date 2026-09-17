// @vitest-environment jsdom
import * as React from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { WithQuery } from "../../test/query.js";
import { useDiscoverTracks } from "./useDiscoverTracks.js";
import { useTrackDetail } from "./useTrackDetail.js";
import { useTrackList } from "./useTrackList.js";

const wrapper = ({ children }: { children: React.ReactNode }) => <WithQuery>{children}</WithQuery>;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useTrackList", () => {
  it("reads id+name pairs off /tracks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify([{ id: "t1", name: "Wobble Ramp" }]), { status: 200 })),
    );

    const { result } = renderHook(() => useTrackList(), { wrapper });
    await waitFor(() => expect(result.current).toEqual([{ id: "t1", name: "Wobble Ramp" }]));
  });
});

describe("useDiscoverTracks", () => {
  const ROWS = [
    { id: "t1", name: "Wobble Ramp", authorId: "a1", createdAt: 1000, plays: 12, hasFinishZone: true, hasThumbnail: false },
    { id: "t2", name: null, authorId: "a1", createdAt: 2000, plays: 0, hasFinishZone: false, hasThumbnail: false },
  ];

  it("reads full listing rows off /tracks — the same cached key the Lobby's picker reads", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(ROWS), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useDiscoverTracks(), { wrapper });
    await waitFor(() => expect(result.current.tracks).toEqual(ROWS));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8081/tracks", expect.anything());
  });

  it("surfaces the API's own refusal as the error, with nothing listed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "nope" }), { status: 500 })));

    const { result } = renderHook(() => useDiscoverTracks(), { wrapper });
    await waitFor(() => expect(result.current.error).toBe("nope"));
    expect(result.current.tracks).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it("fetches nothing when disabled — a non-host never pays for the list", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(ROWS), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useDiscoverTracks(false), { wrapper });
    expect(result.current.tracks).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("useTrackDetail", () => {
  it("fetches one Track's detail by id", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ id: "t1", name: "Wobble Ramp", track: { checkpoints: [{}, {}] } }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useTrackDetail("t1"), { wrapper });
    await waitFor(() => expect(result.current).toMatchObject({ id: "t1" }));
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8081/tracks/t1", expect.anything());
  });

  it("fetches nothing without an id", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useTrackDetail(undefined), { wrapper });
    expect(result.current).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
