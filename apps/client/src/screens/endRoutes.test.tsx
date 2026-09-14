// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { ErrorBoundary } from "../components/ErrorBoundary.js";
import { WithQuery } from "../test/query.js";
import { RewardsRoute } from "./RewardsRoute.js";
import { ScoreboardRoute } from "./ScoreboardRoute.js";

const ROWS = [{ placement: 1, playerCount: 4, score: 120 }];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RewardsRoute", () => {
  it("without a Match behind it, goes home instead of showing numbers for nothing", async () => {
    render(
      <MemoryRouter initialEntries={["/rewards"]}>
        <Routes>
          <Route path="/" element={<div>Main Menu</div>} />
          <Route path="/rewards" element={<RewardsRoute />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Main Menu")).toBeInTheDocument();
  });

  it("claims the Match once and renders the credit, not the mock", async () => {
    const fetchMock = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ gainedXp: 300, gainedCoins: 40, xpBefore: 760, xpAfter: 1060, coinsBefore: 0, coinsAfter: 40 }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemoryRouter initialEntries={[{ pathname: "/rewards", state: { matchId: "m1", rounds: ROWS } }]}>
        <Routes>
          <Route path="/" element={<div>Main Menu</div>} />
          <Route
            path="/rewards"
            element={
              <ErrorBoundary>
                <WithQuery>
                  <RewardsRoute />
                </WithQuery>
              </ErrorBoundary>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("MATCH REWARDS")).toBeInTheDocument();
    expect(screen.getByText("+300")).toBeInTheDocument();
    expect(screen.getByText("+40")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:8081/rewards/claim");
  });

  it("a refused claim surfaces through the boundary, not a banner", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "down" }), { status: 500 })));

    render(
      <MemoryRouter initialEntries={[{ pathname: "/rewards", state: { matchId: "m1", rounds: ROWS } }]}>
        <Routes>
          <Route path="/" element={<div>Main Menu</div>} />
          <Route
            path="/rewards"
            element={
              <ErrorBoundary>
                <WithQuery>
                  <RewardsRoute />
                </WithQuery>
              </ErrorBoundary>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("SOMETHING BROKE")).toBeInTheDocument();
  });
});

describe("ScoreboardRoute", () => {
  it("without rows behind it, goes home", async () => {
    render(
      <MemoryRouter initialEntries={["/scoreboard"]}>
        <Routes>
          <Route path="/" element={<div>Main Menu</div>} />
          <Route path="/scoreboard" element={<ScoreboardRoute />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Main Menu")).toBeInTheDocument();
  });

  it("renders the carried rows with totals", async () => {
    const rows = [
      { name: "GOOPY", skin: "mint" as const, gained: 120, total: 120 },
      { name: "NOODLE", skin: "pink" as const, gained: 40, total: 40, you: true as const },
    ];
    render(
      <MemoryRouter initialEntries={[{ pathname: "/scoreboard", state: { rows, title: "FINAL STANDINGS" } }]}>
        <Routes>
          <Route path="/" element={<div>Main Menu</div>} />
          <Route path="/scoreboard" element={<ScoreboardRoute />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("FINAL STANDINGS")).toBeInTheDocument();
    expect(screen.getByText("GOOPY")).toBeInTheDocument();
    expect(screen.getByText("120")).toBeInTheDocument();
  });
});
