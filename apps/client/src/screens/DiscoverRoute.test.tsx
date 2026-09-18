// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useSearchParams } from "react-router";
import type { TrackListing } from "@dont-fall/shared";
import { DiscoverRoute } from "./DiscoverRoute";

const { useDiscoverTracks } = vi.hoisted(() => ({ useDiscoverTracks: vi.fn() }));
vi.mock("../lib/hooks/useDiscoverTracks.js", () => ({ useDiscoverTracks }));

const ROWS: TrackListing[] = [
  { id: "t1", name: "Wobble Ramp", authorId: "a1", createdAt: 1_000, revision: 1, plays: 12, hasFinishZone: true, hasThumbnail: false },
  { id: "t2", name: "Arena Bowl", authorId: "a1", createdAt: 2_000, revision: 1, plays: 3, hasFinishZone: false, hasThumbnail: false },
];

const loaded = () => {
  useDiscoverTracks.mockReturnValue({ tracks: ROWS, isLoading: false, error: null, retry: () => {} });
};

/** Reads back the query `/play` was reached with — the Practice boot's own params. */
const PlayProbe = () => {
  const [params] = useSearchParams();
  return <div>play:{params.get("track")}|{params.get("freeroam")}</div>;
};

const renderAt = (entry: string) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/discover" element={<DiscoverRoute />} />
        <Route path="/" element={<div>home</div>} />
        <Route path="/play" element={<PlayProbe />} />
      </Routes>
    </MemoryRouter>,
  );

describe("DiscoverRoute", () => {
  it("renders the hooked catalogue — browse mode, nothing pre-selected", () => {
    loaded();
    renderAt("/discover");

    expect(screen.getByText("DISCOVER")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /wobble ramp/i })).toBeInTheDocument();
    expect(screen.queryByText("CURRENT")).not.toBeInTheDocument();
  });

  it("back returns to the menu", () => {
    loaded();
    renderAt("/discover");

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("home")).toBeInTheDocument();
  });

  it("a card boots Practice on that Track — the builder's Playtest link shape", () => {
    loaded();
    renderAt("/discover");

    fireEvent.click(screen.getByRole("button", { name: /arena bowl/i }));
    expect(screen.getByText("play:t2|1")).toBeInTheDocument();
  });

  it("passes loading and error through to the catalogue", () => {
    useDiscoverTracks.mockReturnValue({ tracks: null, isLoading: true, error: null, retry: () => {} });
    const { unmount } = renderAt("/discover");
    expect(screen.getByText("LOADING TRACKS…")).toBeInTheDocument();
    unmount();

    const retry = vi.fn();
    useDiscoverTracks.mockReturnValue({ tracks: null, isLoading: false, error: "down", retry });
    renderAt("/discover");
    expect(screen.getByText("down")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "TRY AGAIN" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
