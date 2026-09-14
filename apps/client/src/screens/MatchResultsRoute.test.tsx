// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { MatchResultsRoute } from "./MatchResultsRoute";
import { RewardsRoute } from "./RewardsRoute.js";
import { ScoreboardRoute } from "./ScoreboardRoute.js";
import { WithQuery } from "../test/query.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const RESULT = {
  matchId: "m1",
  results: [
    {
      rows: [
        { id: "a", placement: 1, qualified: true },
        { id: "b", placement: 2, qualified: true },
        { id: "c", placement: 3, qualified: false },
      ],
    },
    {
      rows: [
        { id: "b", placement: 1, qualified: true },
        { id: "a", placement: 2, qualified: true },
      ],
    },
  ],
  nicknames: { a: "Mushy", b: "Rival", c: "Third" },
  totalFalls: { a: 2, b: 5, c: 1 },
  endedAtMs: 60_000,
}; // totals: Rival 190, Mushy 140, Third 0

const TWO_PLAYER = {
  matchId: "m2",
  results: [
    {
      rows: [
        { id: "a", placement: 1, qualified: true },
        { id: "b", placement: 2, qualified: false },
      ],
    },
  ],
  nicknames: { a: "Mushy", b: "Rival" },
  totalFalls: { a: 0, b: 4 },
  endedAtMs: 60_000,
}; // totals: Mushy 120, Rival 0

const stubApi = (seen: { claimBodies: unknown[] }, results: Record<string, unknown>): void => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init: RequestInit = {}) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      const method = (init.method ?? "GET").toUpperCase();
      if (url.endsWith("/rewards/claim")) {
        seen.claimBodies.push(JSON.parse(String(init.body)));
        return Response.json({ gainedXp: 240, gainedCoins: 36, xpBefore: 100, xpAfter: 340, coinsBefore: 10, coinsAfter: 46 });
      }
      if (method === "GET" && /\/matches\/[^/]+$/.test(url)) {
        const id = url.substring(url.lastIndexOf("/") + 1);
        const result = results[id];
        if (result === undefined) return new Response(JSON.stringify({ error: "no finished Match" }), { status: 404 });
        return Response.json(result);
      }
      throw new Error(`unstubbed API call in test: ${url}`);
    }),
  );
};

const renderAtMatch = (entry: string) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <WithQuery>
        <Routes>
          <Route path="/" element={<div>Main Menu</div>} />
          <Route path="/play" element={<div>Play</div>} />
          <Route path="/match/:matchId" element={<MatchResultsRoute />} />
          <Route path="/rewards" element={<RewardsRoute />} />
          <Route path="/scoreboard" element={<ScoreboardRoute />} />
        </Routes>
      </WithQuery>
    </MemoryRouter>,
  );

describe("MatchResultsRoute", () => {
  it("renders the fetched Match — podium, your line, and your stats", async () => {
    stubApi({ claimBodies: [] }, { m1: RESULT });
    renderAtMatch("/match/m1?me=b");

    expect(await screen.findByText("Rival TAKES THE CROWN")).toBeInTheDocument();
    expect(screen.getByText("YOU FINISHED 1ST · 190 PTS")).toBeInTheDocument();
    expect(screen.getByText("TIED AT THE TOP")).toBeInTheDocument();
    expect(screen.getByText("Mushy")).toBeInTheDocument();
    expect(screen.getByText("Third")).toBeInTheDocument();
  });

  it("a two-Player Match renders a two-place podium — simply no 3rd", async () => {
    stubApi({ claimBodies: [] }, { m2: TWO_PLAYER });
    renderAtMatch("/match/m2?me=b");

    expect(await screen.findByText("Mushy TAKES THE CROWN")).toBeInTheDocument();
    expect(screen.getByText("YOU FINISHED 2ND · 0 PTS")).toBeInTheDocument();
    expect(screen.getByText("120 POINTS OFF THE CROWN")).toBeInTheDocument();
    expect(screen.queryByText("3RD")).not.toBeInTheDocument();
  });

  it("COLLECT banks the Match's own claim rows with its id on /rewards", async () => {
    const seen = { claimBodies: [] as unknown[] };
    stubApi(seen, { m1: RESULT });
    renderAtMatch("/match/m1?me=b");

    fireEvent.click(await screen.findByRole("button", { name: "COLLECT REWARDS" }));
    expect(await screen.findByText("MATCH REWARDS")).toBeInTheDocument();
    expect(seen.claimBodies).toHaveLength(1);
    expect(seen.claimBodies[0]).toEqual({
      matchId: "m1",
      rounds: [
        { placement: 2, playerCount: 3, score: 70 },
        { placement: 1, playerCount: 2, score: 120 },
      ],
    });
  });

  it("FULL SCOREBOARD opens the fetched table as FINAL STANDINGS", async () => {
    stubApi({ claimBodies: [] }, { m1: RESULT });
    renderAtMatch("/match/m1?me=a");

    fireEvent.click(await screen.findByRole("button", { name: "FULL SCOREBOARD" }));
    expect(await screen.findByText("FINAL STANDINGS")).toBeInTheDocument();
    expect(screen.getByText("Rival")).toBeInTheDocument();
    expect(screen.getByText("Mushy")).toBeInTheDocument();
  });

  it("a spectator sees the podium but no you-line and no COLLECT", async () => {
    stubApi({ claimBodies: [] }, { m1: RESULT });
    renderAtMatch("/match/m1?me=spectator");

    expect(await screen.findByText("Rival TAKES THE CROWN")).toBeInTheDocument();
    expect(screen.queryByText(/YOU FINISHED/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "COLLECT REWARDS" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "FULL SCOREBOARD" })).toBeInTheDocument();
  });

  it("an unknown id lands on not-found, with a way home", async () => {
    stubApi({ claimBodies: [] }, {});
    renderAtMatch("/match/nope?me=b");

    expect(await screen.findByText("/match/nope")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "MAIN MENU" }));
    expect(await screen.findByText("Main Menu")).toBeInTheDocument();
  });

  it("a failed fetch shows the error with a retry, not a dead page", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        if (calls === 1) return new Response(JSON.stringify({ error: "boom" }), { status: 500 });
        return Response.json(RESULT);
      }),
    );
    renderAtMatch("/match/m1?me=b");

    expect(await screen.findByText("The game tripped over itself.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "TRY AGAIN" }));
    expect(await screen.findByText("Rival TAKES THE CROWN")).toBeInTheDocument();
  });
});
