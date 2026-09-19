// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { WithQuery } from "../test/query.js";
import { LeaderboardsRoute } from "./LeaderboardsRoute";

const TRACKS = [
  { id: "t1", name: "Wobble Ramp", authorId: "a", createdAt: 1, revision: 1, hasThumbnail: false, plays: 0, playsThisWeek: 0, playsToday: 0, hasFinishZone: true },
  { id: "arena", name: "Arena", authorId: "a", createdAt: 1, revision: 1, hasThumbnail: false, plays: 0, playsThisWeek: 0, playsToday: 0, hasFinishZone: false },
  { id: "t2", name: "Slip Stream", authorId: "a", createdAt: 1, revision: 1, hasThumbnail: false, plays: 0, playsThisWeek: 0, playsToday: 0, hasFinishZone: true },
];
const row = (rank: number, accountId: string, displayName: string, value: number) => ({ rank, accountId, displayName, color: 0, value });

afterEach(() => vi.unstubAllGlobals());

describe("LeaderboardsRoute (ADR 0110)", () => {
  it("shows each board, your own row below the top, and walks the Race board's Tracks", async () => {
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        asked.push(url);
        if (url.endsWith("/tracks")) return Response.json(TRACKS);
        if (url.endsWith("/leaderboards/wins")) {
          return Response.json({ board: "wins", rows: [row(1, "a1", "Floppo", 12)], you: row(40, "me", "Mushy", 1) });
        }
        if (url.includes("/leaderboards/race/")) {
          const trackId = url.split("/").pop();
          return Response.json({ board: "race", trackId, rows: [row(1, "a1", "Floppo", trackId === "t1" ? 79_904 : 61_000)], you: null });
        }
        if (url.endsWith("/leaderboards/survival")) return Response.json({ board: "survival", rows: [row(1, "me", "Mushy", 371_400)], you: row(1, "me", "Mushy", 371_400) });
        return Response.json({});
      }),
    );
    render(
      <MemoryRouter>
        <WithQuery>
          <LeaderboardsRoute />
        </WithQuery>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Floppo")).toBeInTheDocument();
    expect(screen.getByText("Mushy")).toBeInTheDocument(); // your row, 40th, under the top
    expect(screen.getByText("40")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "RACE TIMES" }));
    expect(await screen.findByText("01:19.904")).toBeInTheDocument();
    expect(screen.getByText("WOBBLE RAMP")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "NEXT" }));
    expect(await screen.findByText("SLIP STREAM")).toBeInTheDocument();
    await waitFor(() => expect(asked.some((url) => url.endsWith("/leaderboards/race/t2"))).toBe(true));

    fireEvent.click(screen.getByRole("tab", { name: "SURVIVAL" }));
    expect(await screen.findByText("06:11")).toBeInTheDocument();
  });
});
