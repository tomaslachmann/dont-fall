// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { TrackListing } from "@dont-fall/shared";
import Discover, { featuredTrack, filterDiscoverTracks, formatPlays, isNewTrack } from "./Discover";

const row = (overrides: Partial<TrackListing> & { id: string }): TrackListing => ({
  name: null,
  authorId: "a1",
  createdAt: 1_000,
  revision: 1,
  plays: 0,
  hasFinishZone: false, hasThumbnail: false,
  ...overrides,
});

const NOW = 8 * 24 * 60 * 60 * 1000; // a week past the epoch — old rows read old, fresh rows read fresh
const OLD = 1_000;
const FRESH = NOW - 1_000;

describe("formatPlays", () => {
  it("keeps small counts bare and compacts thousands with a K", () => {
    expect(formatPlays(0)).toBe("0");
    expect(formatPlays(12)).toBe("12");
    expect(formatPlays(999)).toBe("999");
    expect(formatPlays(1_000)).toBe("1K");
    expect(formatPlays(12_000)).toBe("12K");
    expect(formatPlays(12_300)).toBe("12.3K");
  });
});

describe("isNewTrack", () => {
  it("is new within a week of publishing, old after", () => {
    expect(isNewTrack(FRESH, NOW)).toBe(true);
    expect(isNewTrack(OLD, NOW)).toBe(false);
  });
});

describe("filterDiscoverTracks", () => {
  const tracks = [
    row({ id: "old-hot", name: "Old Hot", plays: 10, createdAt: OLD, hasFinishZone: true, hasThumbnail: false }),
    row({ id: "new-hot", name: "New Hot", plays: 10, createdAt: FRESH, hasFinishZone: false, hasThumbnail: false }),
    row({ id: "cold", name: "Cold", plays: 1, createdAt: FRESH, hasFinishZone: true, hasThumbnail: false }),
    row({ id: "unnamed", plays: 50, createdAt: OLD, hasFinishZone: false, hasThumbnail: false }),
  ];

  it("TRENDING ranks by heat — plays desc, newest first on ties", () => {
    expect(filterDiscoverTracks(tracks, "TRENDING").map((t) => t.id)).toEqual([
      "unnamed",
      "new-hot",
      "old-hot",
      "cold",
    ]);
  });

  it("NEW ranks by recency", () => {
    expect(filterDiscoverTracks(tracks, "NEW").map((t) => t.id)).toEqual([
      "new-hot",
      "cold",
      "old-hot",
      "unnamed",
    ]);
  });

  it("RACE keeps only raceable Tracks, hottest first", () => {
    expect(filterDiscoverTracks(tracks, "RACE").map((t) => t.id)).toEqual(["old-hot", "cold"]);
  });

  it("SURVIVAL lists the whole catalogue A–Z — every Track supports Survival, unnamed sorts last", () => {
    expect(filterDiscoverTracks(tracks, "SURVIVAL").map((t) => t.id)).toEqual([
      "cold",
      "new-hot",
      "old-hot",
      "unnamed",
    ]);
  });
});

describe("featuredTrack", () => {
  it("features the hottest Track, newest on ties — and nothing when the catalogue is empty", () => {
    const tracks = [
      row({ id: "a", plays: 3, createdAt: OLD }),
      row({ id: "b", plays: 3, createdAt: FRESH }),
    ];
    expect(featuredTrack(tracks)?.id).toBe("b");
    expect(featuredTrack([])).toBeNull();
  });
});

describe("Discover", () => {
  // Rendered badges read the real clock (`isNewTrack` defaults `nowMs` to
  // it), so fresh/old are relative to today — unlike the pure-function
  // cases above, which pin their own now.
  const TRACKS = [
    row({ id: "t1", name: "Wobble Ramp", plays: 12, createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000, hasFinishZone: true, hasThumbnail: false }),
    row({ id: "t2", name: "Arena Bowl", plays: 3, createdAt: Date.now() - 1_000, hasFinishZone: false, hasThumbnail: false }),
  ];

  const renderDiscover = (props: Partial<React.ComponentProps<typeof Discover>> = {}) =>
    render(
      <Discover tracks={TRACKS} isLoading={false} error={null} onSelect={() => {}} onBack={() => {}} {...props} />,
    );

  /** Card order as shown, read off each card's own accessible name — TRENDING's ranking when untouched. */
  const cardNames = (): string[] =>
    screen.getAllByRole("button", { name: /plays?/ }).map((card) => card.getAttribute("aria-label") ?? "");

  it("renders one card per Track — name, mode chip, plays, NEW only when fresh", () => {
    renderDiscover();

    const ramp = screen.getByRole("button", { name: /wobble ramp/i });
    expect(within(ramp).getByText("RACE")).toBeInTheDocument();
    expect(within(ramp).getByText("12 PLAYS")).toBeInTheDocument();
    expect(within(ramp).queryByText("NEW")).not.toBeInTheDocument();

    const arena = screen.getByRole("button", { name: /arena bowl/i });
    expect(within(arena).getByText("SURVIVAL")).toBeInTheDocument();
    expect(within(arena).getByText("3 PLAYS")).toBeInTheDocument();
    expect(within(arena).getByText("NEW")).toBeInTheDocument();
  });

  it("falls back to UNTITLED TRACK for an unnamed publish — and never shows an author or a rating", () => {
    renderDiscover({ tracks: [row({ id: "t9" })] });

    // Twice: the card and the featured band, which plays the only Track there is.
    expect(screen.getAllByText("UNTITLED TRACK")).toHaveLength(2);
    expect(screen.queryByText(/by /i)).not.toBeInTheDocument();
    expect(screen.queryByText(/★/)).not.toBeInTheDocument();
  });

  it("switches tabs — RACE narrows to raceable Tracks, SURVIVAL lists everything A–Z", () => {
    renderDiscover();
    expect(cardNames()[0]).toMatch(/wobble ramp/i);

    fireEvent.click(screen.getByRole("button", { name: "RACE" }));
    expect(cardNames()).toHaveLength(1);
    expect(cardNames()[0]).toMatch(/wobble ramp/i);

    fireEvent.click(screen.getByRole("button", { name: "SURVIVAL" }));
    expect(cardNames()).toHaveLength(2);
    expect(cardNames()[0]).toMatch(/arena bowl/i);
  });

  it("a card click selects that Track", () => {
    const onSelect = vi.fn();
    renderDiscover({ onSelect });

    fireEvent.click(screen.getByRole("button", { name: /arena bowl/i }));
    expect(onSelect).toHaveBeenCalledWith("t2");
  });

  it("the featured band plays the hottest Track — TRY IT selects it", () => {
    const onSelect = vi.fn();
    renderDiscover({ onSelect });

    expect(screen.getByText("TODAY’S FEATURED CHAOS")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "TRY IT" }));
    expect(onSelect).toHaveBeenCalledWith("t1");
  });

  it("has no TRY IT from the Lobby — the featured band still names the Track, nothing launches Practice", () => {
    const onSelect = vi.fn();
    renderDiscover({ selectedId: "t2", onSelect });

    expect(screen.getByText("TODAY’S FEATURED CHAOS")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "TRY IT" })).not.toBeInTheDocument();
  });

  it("badges the picked Track CURRENT in pick mode", () => {
    renderDiscover({ selectedId: "t2" });

    const arena = screen.getByRole("button", { name: /arena bowl/i });
    expect(within(arena).getByText("CURRENT")).toBeInTheDocument();
    expect(screen.getAllByText("CURRENT")).toHaveLength(1);
  });

  it("loading shows no cards and no featured band", () => {
    renderDiscover({ tracks: [], isLoading: true });

    expect(screen.getByText("LOADING TRACKS…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /plays?/ })).not.toBeInTheDocument();
    expect(screen.queryByText("TODAY’S FEATURED CHAOS")).not.toBeInTheDocument();
  });

  it("an error shows the API's own words with a retry — and no cards", () => {
    const onRetry = vi.fn();
    renderDiscover({ tracks: [], error: "Could not reach the API. Is it running?", onRetry });

    expect(screen.getByText("Could not reach the API. Is it running?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "TRY AGAIN" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /plays?/ })).not.toBeInTheDocument();
  });

  it("an empty catalogue says so — and a RACE tab with nothing raceable says why", () => {
    const { rerender } = render(
      <Discover tracks={[]} isLoading={false} error={null} onSelect={() => {}} />,
    );
    expect(screen.getByText(/NO TRACKS YET/)).toBeInTheDocument();

    rerender(<Discover tracks={[row({ id: "t1", name: "Arena" })]} isLoading={false} error={null} onSelect={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "RACE" }));
    expect(screen.getByText(/NOTHING RACEABLE YET/)).toBeInTheDocument();
  });

  it("shows the captured screenshot on a card whose Revision has one, stripes otherwise (ADR 0085)", () => {
    renderDiscover({
      tracks: [
        row({ id: "shot", name: "Shot", hasThumbnail: true }),
        row({ id: "bare", name: "Bare", hasThumbnail: false }),
      ],
    });

    // Decorative (`alt=""`), so read off the DOM, not the accessible tree.
    const shot = screen.getByRole("button", { name: /shot/i });
    // Pinned to the listed Revision (ADR 0105) — the URL sign-in preloaded.
    expect(shot.querySelector("img")?.getAttribute("src")).toBe("http://localhost:8081/tracks/shot/thumbnail?revision=1");

    const bare = screen.getByRole("button", { name: /bare/i });
    expect(bare.querySelector("img")).toBeNull();
  });

  it("a screenshot that fails to load hides itself — the stripes under it show through", () => {
    renderDiscover({ tracks: [row({ id: "shot", name: "Shot", hasThumbnail: true })] });

    const card = screen.getByRole("button", { name: /shot/i });
    const img = card.querySelector("img")!;
    fireEvent.error(img);

    expect(img).not.toBeVisible();
    expect(card.getAttribute("aria-label")).toMatch(/shot/i); // the card itself still reads fine
  });
});
