// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { WithQuery } from "../test/query.js";
import MainMenu from "./MainMenu";

const ACCOUNT = {
  id: "acc-1",
  discordId: null,
  email: "bean@example.com",
  displayName: "Wobbleton",
  avatarUrl: null,
  avatarUploadedAt: null,
  xp: 0,
  coins: 0,
  color: 0,
  skin: null,
  hat: null,
  bindings: null,
};
const STATS = { matches: 9, wins: 4, podiums: 6, falls: 12, bestPlacement: 1, cleanMatches: 2, bestSurvivalMs: 371_400, grabsBroken: 17 };

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("MainMenu (ADR 0110)", () => {
  it("draws the career's own BEST SURVIVAL, WINS and GRABS BROKEN", async () => {
    localStorage.setItem("df_auth_token", "tok");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.endsWith("/auth/me")) return Response.json(ACCOUNT);
        if (url.endsWith("/career")) return Response.json({ stats: STATS, badges: { earned: [], total: 6 }, matches: [] });
        if (url.endsWith("/game-settings")) return Response.json({ maxPlayers: 10, onlinePlayers: 3 });
        if (url.endsWith("/friends")) return Response.json({ friends: [], online: 0, total: 0, requests: [] });
        if (url.endsWith("/friends/recent")) return Response.json({ recent: [] });
        if (url.endsWith("/friends/code")) return Response.json({ code: "ABC123" });
        return Response.json({});
      }),
    );
    render(
      <MemoryRouter>
        <WithQuery>
          <MainMenu />
        </WithQuery>
      </MemoryRouter>,
    );

    expect(await screen.findByText("06:11")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("17")).toBeInTheDocument();
    expect(screen.queryByText("137")).toBeNull();
  });
});
