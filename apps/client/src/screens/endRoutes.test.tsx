// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { xpLevelStart } from "@dont-fall/shared";
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
          <Route
            path="/rewards"
            element={
              <WithQuery>
                <RewardsRoute />
              </WithQuery>
            }
          />
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

describe("RewardsRoute hat unlocks (ADR 0083)", () => {
  const ACCOUNT = { id: "acc-1", discordId: null, email: null, displayName: "Bean", avatarUrl: null, coins: 0, bodySkin: 0, bindings: null };

  const renderRewards = (claim: { xpBefore: number; xpAfter: number }) => {
    let hat: string | null = null;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/rewards/claim")) {
        return Response.json({ gainedXp: claim.xpAfter - claim.xpBefore, gainedCoins: 10, coinsBefore: 0, coinsAfter: 10, ...claim });
      }
      if (url.endsWith("/auth/me/cosmetics") && init?.method === "PUT") {
        hat = (JSON.parse(init.body as string) as { hat: string | null }).hat;
        return Response.json({ ...ACCOUNT, xp: claim.xpAfter, hat });
      }
      if (url.endsWith("/auth/me")) return Response.json({ ...ACCOUNT, xp: claim.xpAfter, hat });
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <MemoryRouter initialEntries={[{ pathname: "/rewards", state: { matchId: "m1", rounds: ROWS } }]}>
        <Routes>
          <Route
            path="/rewards"
            element={
              <WithQuery>
                <RewardsRoute />
              </WithQuery>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    return fetchMock;
  };

  afterEach(() => {
    localStorage.clear();
  });

  it("announces the hat the Match's XP unlocked, and EQUIP NEW HAT puts it on", async () => {
    localStorage.setItem("df_auth_token", "tok");
    const fetchMock = renderRewards({ xpBefore: xpLevelStart(2) - 50, xpAfter: xpLevelStart(2) + 50 });

    expect(await screen.findByText("TRAFFIC CONE")).toBeInTheDocument();
    expect(screen.getByText("UNLOCKED AT 2")).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "EQUIP NEW HAT" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:8081/auth/me/cosmetics",
        expect.objectContaining({ method: "PUT", body: JSON.stringify({ hat: "cone" }) }),
      ),
    );
    // Worn now: nothing left to equip.
    await waitFor(() => expect(screen.queryByRole("button", { name: "EQUIP NEW HAT" })).toBeNull());
  });

  it("names only the last hat when one Match crossed several levels", async () => {
    renderRewards({ xpBefore: 0, xpAfter: xpLevelStart(9) });

    expect(await screen.findByText("BUCKET")).toBeInTheDocument();
    expect(screen.queryByText("TRAFFIC CONE")).toBeNull();
  });

  it("announces nothing when no hat's level was crossed", async () => {
    renderRewards({ xpBefore: 0, xpAfter: 500 });

    expect(await screen.findByText("MATCH REWARDS")).toBeInTheDocument();
    expect(screen.queryByText(/UNLOCKED AT/)).toBeNull();
    expect(screen.queryByRole("button", { name: "EQUIP NEW HAT" })).toBeNull();
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
