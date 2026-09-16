// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import { CharacterSelectRoute } from "./CharacterSelectRoute";

const ACCOUNT = {
  id: "acc-1",
  discordId: null,
  email: "bean@example.com",
  displayName: "Bean",
  avatarUrl: null,
  xp: 0,
  coins: 0,
  bodySkin: 2,
};

const renderAt = (entry: string) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/character" element={<CharacterSelectRoute />} />
          <Route path="/" element={<div>home</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe("CharacterSelectRoute", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    localStorage.setItem("df_auth_token", "tok");
    let skin = ACCOUNT.bodySkin;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/auth/me")) return Response.json({ ...ACCOUNT, bodySkin: skin });
        if (url.endsWith("/auth/me/cosmetics") && init?.method === "PUT") {
          skin = (JSON.parse(init.body as string) as { bodySkin: number }).bodySkin;
          return Response.json({ ...ACCOUNT, bodySkin: skin });
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
  });

  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
    globalThis.fetch = realFetch;
  });

  it("loads the equipped skin off the Account and pre-selects it", async () => {
    renderAt("/character");

    expect(await screen.findByText("SKIN 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skin 3" })).toHaveAttribute("aria-pressed", "true");
  });

  it("SAVE persists the pick and the equipped panel follows", async () => {
    renderAt("/character");
    await screen.findByText("SKIN 3");

    fireEvent.click(screen.getByRole("button", { name: "Skin 1" }));
    fireEvent.click(screen.getByRole("button", { name: "SAVE" }));

    await waitFor(() => expect(screen.getByText("SKIN 1")).toBeInTheDocument());
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/auth/me/cosmetics"),
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ bodySkin: 0 }) }),
    );
  });

  it("SAVE persists the factory base and the panel reads BASE, not SKIN 8", async () => {
    renderAt("/character");
    await screen.findByText("SKIN 3");

    fireEvent.click(screen.getByRole("button", { name: "Base" }));
    fireEvent.click(screen.getByRole("button", { name: "SAVE" }));

    await waitFor(() => expect(screen.getByText("BASE")).toBeInTheDocument());
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/auth/me/cosmetics"),
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ bodySkin: 7 }) }),
    );
  });

  it("back returns to the menu", async () => {
    renderAt("/character");
    await screen.findByText("SKIN 3");

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("home")).toBeInTheDocument();
  });

  it("OPEN SHOP says inline the shop isn't here yet — it has no screen", async () => {
    renderAt("/character");
    await screen.findByText("SKIN 3");

    fireEvent.click(screen.getByRole("button", { name: "OPEN SHOP" }));

    expect(screen.getByRole("status")).toHaveTextContent("The shop isn't here yet.");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a failed SAVE says so inline and keeps the old bean — then clears on the next pick", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/auth/me")) return Response.json(ACCOUNT);
        if (url.endsWith("/auth/me/cosmetics") && init?.method === "PUT") {
          return Response.json({ error: "boom" }, { status: 500 });
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
    renderAt("/character");
    await screen.findByText("SKIN 3");

    fireEvent.click(screen.getByRole("button", { name: "Skin 1" }));
    fireEvent.click(screen.getByRole("button", { name: "SAVE" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Couldn't save your bean"));
    expect(screen.getByText("SKIN 3")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Skin 2" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
