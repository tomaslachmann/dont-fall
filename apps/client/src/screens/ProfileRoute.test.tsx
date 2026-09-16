// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import { ProfileRoute } from "./ProfileRoute";

const ACCOUNT = {
  id: "acc-1",
  discordId: null,
  email: "bean@example.com",
  displayName: "Wobbleton",
  avatarUrl: null,
  xp: 1240,
  coins: 55,
  bodySkin: 3,
};

const renderAt = (entry: string) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
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
    localStorage.setItem("df_auth_token", "tok");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/auth/me")) return Response.json(ACCOUNT);
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

  it("stats, badges and history stay honestly empty — no backend tracks them yet", async () => {
    renderAt("/profile");
    await screen.findByText("Wobbleton");

    expect(screen.getByText("Career stats aren't tracked yet.")).toBeInTheDocument();
    expect(screen.getByText("Badges aren't here yet.")).toBeInTheDocument();
    expect(screen.getByText("Match history isn't here yet.")).toBeInTheDocument();
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

  it("SHARE CARD and SEE ALL say inline they aren't here yet", async () => {
    renderAt("/profile");
    await screen.findByText("Wobbleton");

    fireEvent.click(screen.getByRole("button", { name: "SHARE CARD" }));
    expect(screen.getByRole("status")).toHaveTextContent("Sharing isn't here yet.");

    fireEvent.click(screen.getByRole("button", { name: "SEE ALL" }));
    expect(screen.getByRole("status")).toHaveTextContent("Match history isn't here yet.");
  });
});
