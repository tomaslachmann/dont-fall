// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearFlashes } from "../lib/flash.js";
import FlashHost from "../ui/FlashHost.js";
import Settings from "./Settings";

// jsdom has no canvas: the crop is `avatarImage.test.ts`'s; here only what the pane does with it.
vi.mock("../lib/avatarImage.js", () => ({
  AVATAR_ACCEPT: "image/png,image/jpeg,image/webp",
  avatarFromFile: vi.fn(async () => "data:image/webp;base64,UklGRgAAAABXRUJQ"),
}));

const ACCOUNT = {
  id: "acc-1",
  discordId: null,
  email: "bean@example.com",
  displayName: "Bean",
  avatarUrl: null,
  avatarUploadedAt: null as number | null,
  xp: 12_000,
  coins: 0,
  color: 3,
  skin: null,
  hat: null,
  bindings: null,
};

describe("Settings ACCOUNT (ADR 0110)", () => {
  const realFetch = globalThis.fetch;
  let account: typeof ACCOUNT;
  let puts: string[];

  beforeEach(() => {
    clearFlashes();
    localStorage.setItem("df_auth_token", "tok");
    account = { ...ACCOUNT };
    puts = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/auth/me")) return Response.json(account);
        if (url.endsWith("/auth/me/avatar") && init?.method === "PUT") {
          puts.push((JSON.parse(init.body as string) as { image: string }).image);
          account = { ...account, avatarUploadedAt: 9_000 };
          return Response.json(account);
        }
        if (url.endsWith("/auth/me/avatar") && init?.method === "DELETE") {
          account = { ...account, avatarUploadedAt: null };
          return Response.json(account);
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

  const openAccount = async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/settings"]}>
          <FlashHost />
          <Routes>
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByText(/Bean · LVL/);
    fireEvent.click(screen.getByRole("tab", { name: "ACCOUNT" }));
    await screen.findByText("AVATAR");
    return view;
  };

  it("shows the real level, the name and Discord, and uploads a picture that then shows", async () => {
    const view = await openAccount();
    expect(screen.queryByText(/LVL 42/)).toBeNull();
    expect(screen.getByText("Not linked")).toBeDefined();
    expect(screen.getByText("Your bean’s colour · upload a picture to change it")).toBeDefined();
    expect(screen.queryByRole("button", { name: "REMOVE" })).toBeNull();

    const input = screen.getByLabelText("Avatar picture") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "me.png", { type: "image/png" })] } });

    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toMatch(/^data:image\/webp;base64,/);
    await screen.findByRole("button", { name: "REMOVE" });
    const img = view.container.querySelector("img");
    expect(img?.getAttribute("src")).toMatch(/\/avatars\/acc-1\?v=9000$/);
  });

  it("REMOVE takes the upload off", async () => {
    account = { ...ACCOUNT, avatarUploadedAt: 5_000 };
    await openAccount();
    fireEvent.click(screen.getByRole("button", { name: "REMOVE" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "REMOVE" })).toBeNull());
  });

  it("GAMEPLAY holds the nameplates, stored per device (ADR 0110)", async () => {
    await openAccount();
    fireEvent.click(screen.getByRole("tab", { name: "GAMEPLAY" }));
    expect(screen.getByText("SHOW OTHER BEANS’ NAMES")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "OFF" }));
    expect(JSON.parse(localStorage.getItem("dontfall.gameplay.v1")!)).toMatchObject({ nameplates: false });
  });
});
