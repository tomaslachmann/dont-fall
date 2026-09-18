// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import { clearFlashes } from "../lib/flash.js";
import FlashHost from "../ui/FlashHost.js";
import { ProfileRoute } from "./ProfileRoute";

const ACCOUNT = {
  id: "acc-1",
  discordId: null,
  email: "bean@example.com",
  displayName: "Wobbleton",
  avatarUrl: null,
  xp: 1240,
  coins: 55,
  color: 3,
};

const row = (matchId: string, placement: number, trackNames: string[], minutesAgo: number) => ({
  matchId,
  placement,
  score: 190 - placement * 10,
  falls: placement,
  rounds: 2,
  trackNames,
  endedAtMs: Date.now() - minutesAgo * 60_000,
});

const CAREER = {
  stats: { matches: 6, wins: 2, podiums: 4, falls: 9, bestPlacement: 1, cleanMatches: 1 },
  badges: { earned: ["first-steps", "podium", "winner", "flawless"], total: 6 },
  matches: [
    row("m1", 1, ["Green Hills"], 5),
    row("m2", 2, ["Green Hills", "Blue Bay"], 70),
    row("m3", 3, ["Blue Bay"], 60 * 26),
    row("m4", 1, ["Green Hills"], 60 * 50),
    row("m5", 4, ["Green Hills"], 60 * 75),
    row("m6", 2, [], 60 * 100),
  ],
};

const renderAt = (entry: string) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        {/* The shell mounts the flash stack above the routes — this test does the same. */}
        <FlashHost />
        <Routes>
          <Route path="/profile" element={<ProfileRoute />} />
          <Route path="/" element={<div>home</div>} />
          <Route path="/character" element={<div>bean</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe("ProfileRoute", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    clearFlashes();
    localStorage.setItem("df_auth_token", "tok");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/auth/me")) return Response.json(ACCOUNT);
        if (url.endsWith("/career")) return Response.json(CAREER);
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
  });

  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
    globalThis.fetch = realFetch;
  });

  it("maps the Account onto the card — name, level 2 at 1240 XP, 240 into a 2000 span", async () => {
    renderAt("/profile");

    expect(await screen.findByText("Wobbleton")).toBeInTheDocument();
    expect(screen.getByText("LEVEL 2")).toBeInTheDocument();
    expect(screen.getByText("240 / 2 000 XP TO LEVEL 3")).toBeInTheDocument();
    expect(screen.getByText(/SIGNATURE VICTORY POSE/)).toBeInTheDocument();
  });

  it("renders the real career — stat tiles, badge counts, and the newest history rows", async () => {
    renderAt("/profile");
    await screen.findByText("Wobbleton");

    expect(await screen.findByText("MATCHES")).toBeInTheDocument();
    expect(screen.getByText("WINS")).toBeInTheDocument();
    expect(screen.getByText("4 OF 6")).toBeInTheDocument();
    expect(screen.getByTitle("First Steps")).toBeInTheDocument();
    // Newest first, five collapsed rows of six.
    expect(screen.getAllByText("Green Hills")).toHaveLength(3);
    expect(screen.getByText("Green Hills · Blue Bay")).toBeInTheDocument();
    expect(screen.getByText("5 MINUTES AGO")).toBeInTheDocument();
    expect(screen.queryByText("Loading…")).toBeNull();
  });

  it("SEE ALL unfolds the whole page and folds it back", async () => {
    renderAt("/profile");
    await screen.findByText("Wobbleton");
    await screen.findByText("5 MINUTES AGO");

    // Six rows fetched, five shown — the oldest (UNTITLED, no Tracks) is hidden.
    expect(screen.queryByText("UNTITLED TRACK")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "SEE ALL" }));
    expect(screen.getByText("UNTITLED TRACK")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "SHOW LESS" }));
    expect(screen.queryByText("UNTITLED TRACK")).toBeNull();
  });

  it("SHARE CARD copies a text card to the clipboard", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderAt("/profile");
    await screen.findByText("Wobbleton");
    await screen.findByText("5 MINUTES AGO");

    fireEvent.click(screen.getByRole("button", { name: "SHARE CARD" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Card copied to clipboard.");
    expect(writeText).toHaveBeenCalledWith(
      "Wobbleton · LEVEL 2 — DON'T FALL\n6 Matches · 2 Wins · 9 Falls\nBadges 4 of 6",
    );
  });

  it("a career that won't load fails honestly — every section says so, with no notice line left", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/auth/me")) return Response.json(ACCOUNT);
        if (url.endsWith("/career")) return new Response("down", { status: 500 });
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
    renderAt("/profile");
    await screen.findByText("Wobbleton");

    expect(await screen.findAllByText("Couldn't load the career.")).toHaveLength(3);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("back returns to the menu", async () => {
    renderAt("/profile");
    await screen.findByText("Wobbleton");

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("home")).toBeInTheDocument();
  });

  it("EDIT BEAN opens Character Select", async () => {
    renderAt("/profile");
    await screen.findByText("Wobbleton");

    fireEvent.click(screen.getByRole("button", { name: "EDIT BEAN" }));
    expect(screen.getByText("bean")).toBeInTheDocument();
  });
});
