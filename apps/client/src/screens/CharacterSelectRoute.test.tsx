// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import { xpLevelStart } from "@dont-fall/shared";
import { clearFlashes } from "../lib/flash.js";
import FlashHost from "../ui/FlashHost.js";
import { CharacterSelectRoute } from "./CharacterSelectRoute";

const ACCOUNT = {
  id: "acc-1",
  discordId: null,
  email: "bean@example.com",
  displayName: "Bean",
  avatarUrl: null,
  xp: 0,
  coins: 0,
  color: 2,
  skin: null as string | null,
  hat: null as string | null,
  emote: "wobble",
  victoryPose: "win",
};

const renderAt = (entry: string) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        {/* The shell mounts the flash stack above the routes — this test does the same. */}
        <FlashHost />
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
  /** The Account's XP — level 1 unless a test levels it up first. */
  let xp = 0;

  beforeEach(() => {
    clearFlashes();
    localStorage.setItem("df_auth_token", "tok");
    let saved = { color: ACCOUNT.color, skin: ACCOUNT.skin, hat: ACCOUNT.hat };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/auth/me")) return Response.json({ ...ACCOUNT, xp, ...saved });
        if (url.endsWith("/auth/me/cosmetics") && init?.method === "PUT") {
          saved = { ...saved, ...(JSON.parse(init.body as string) as Partial<typeof saved>) };
          return Response.json({ ...ACCOUNT, xp, ...saved });
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
  });

  afterEach(() => {
    xp = 0;
    localStorage.clear();
    vi.unstubAllGlobals();
    globalThis.fetch = realFetch;
  });

  it("loads the equipped color off the Account and pre-selects it", async () => {
    renderAt("/character");

    expect(await screen.findByText("COLOUR 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Colour 3" })).toHaveAttribute("aria-pressed", "true");
  });

  it("SAVE persists the pick and the equipped panel follows", async () => {
    renderAt("/character");
    await screen.findByText("COLOUR 3");

    fireEvent.click(screen.getByRole("button", { name: "Colour 1" }));
    fireEvent.click(screen.getByRole("button", { name: "SAVE" }));

    await waitFor(() => expect(screen.getByText("COLOUR 1")).toBeInTheDocument());
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/auth/me/cosmetics"),
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ color: 0 }) }),
    );
  });

  it("SAVE persists the factory base and the panel reads BASE, not COLOUR 8", async () => {
    renderAt("/character");
    await screen.findByText("COLOUR 3");

    fireEvent.click(screen.getByRole("button", { name: "Base" }));
    fireEvent.click(screen.getByRole("button", { name: "SAVE" }));

    await waitFor(() => expect(screen.getByText("BASE")).toBeInTheDocument());
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/auth/me/cosmetics"),
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ color: 7 }) }),
    );
  });

  it("back returns to the menu", async () => {
    renderAt("/character");
    await screen.findByText("COLOUR 3");

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("home")).toBeInTheDocument();
  });

  it("OPEN SHOP flashes the shop isn't here yet — it has no screen", async () => {
    renderAt("/character");
    await screen.findByText("COLOUR 3");

    fireEvent.click(screen.getByRole("button", { name: "OPEN SHOP" }));

    expect(screen.getByRole("status")).toHaveTextContent("The shop isn't here yet.");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a failed SAVE flashes why and keeps the old bean — the failure waits, it never clears on its own", async () => {
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
    await screen.findByText("COLOUR 3");

    fireEvent.click(screen.getByRole("button", { name: "Colour 1" }));
    fireEvent.click(screen.getByRole("button", { name: "SAVE" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Couldn't save your bean"));
    expect(screen.getByText("COLOUR 3")).toBeInTheDocument();

    // An error flash is sticky: picking another color must not clear it —
    // only an explicit dismiss does.
    fireEvent.click(screen.getByRole("button", { name: "Colour 2" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't save your bean");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  describe("hats (ADR 0083)", () => {
    const openHats = async () => {
      renderAt("/character");
      await screen.findByText("COLOUR 3");
      fireEvent.click(screen.getByRole("tab", { name: "HAT" }));
    };

    it("unlocks tiles off the Account's own level", async () => {
      xp = xpLevelStart(5);
      await openHats();

      expect(await screen.findByRole("button", { name: "POT" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "BUCKET" })).toBeNull();
      expect(screen.getByText("LV 9")).toBeInTheDocument();
    });

    it("SAVE puts the picked hat on with the color, and the equipped panel names it", async () => {
      xp = xpLevelStart(20);
      await openHats();

      fireEvent.click(await screen.findByRole("button", { name: "CROWN" }));
      fireEvent.click(screen.getByRole("button", { name: "SAVE" }));

      await waitFor(() => expect(screen.getByText("COLOUR 3 · CROWN")).toBeInTheDocument());
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/auth/me/cosmetics"),
        expect.objectContaining({ method: "PUT", body: JSON.stringify({ color: 2, hat: "crown" }) }),
      );
      expect(screen.getByRole("button", { name: "CROWN" })).toHaveAttribute("aria-pressed", "true");
    });

    it("SAVE takes the hat off for NONE", async () => {
      xp = xpLevelStart(2);
      await openHats();
      fireEvent.click(await screen.findByRole("button", { name: "TRAFFIC CONE" }));
      fireEvent.click(screen.getByRole("button", { name: "SAVE" }));
      expect(await screen.findByText("COLOUR 3 · TRAFFIC CONE")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "No hat" }));
      fireEvent.click(screen.getByRole("button", { name: "SAVE" }));

      await waitFor(() => expect(screen.getByText("COLOUR 3")).toBeInTheDocument());
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/auth/me/cosmetics"),
        expect.objectContaining({ body: JSON.stringify({ color: 2, hat: null }) }),
      );
    });

    it("a color-only change leaves the hat out of the save", async () => {
      renderAt("/character");
      await screen.findByText("COLOUR 3");

      fireEvent.click(screen.getByRole("button", { name: "Colour 5" }));
      fireEvent.click(screen.getByRole("button", { name: "SAVE" }));

      await waitFor(() => expect(screen.getByText("COLOUR 5")).toBeInTheDocument());
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/auth/me/cosmetics"),
        expect.objectContaining({ body: JSON.stringify({ color: 4 }) }),
      );
    });
  });

  describe("skins (ADR 0091)", () => {
    const openSkins = async () => {
      renderAt("/character");
      await screen.findByText("COLOUR 3");
      fireEvent.click(screen.getByRole("tab", { name: "SKIN" }));
    };

    it("unlocks tiles off the Account's own level, like hats", async () => {
      xp = xpLevelStart(6);
      await openSkins();

      expect(await screen.findByRole("button", { name: "TIGER" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "SUNSET STRIPES" })).toBeNull();
      expect(screen.getByText("LV 8")).toBeInTheDocument();
    });

    it("SAVE paints the picked skin on, and the equipped panel names it instead of the color", async () => {
      xp = xpLevelStart(6);
      await openSkins();

      fireEvent.click(await screen.findByRole("button", { name: "TIGER" }));
      fireEvent.click(screen.getByRole("button", { name: "SAVE" }));

      // The skin is the whole body: the color underneath is no longer drawn,
      // so it is no longer what the panel calls the bean (ADR 0091).
      await waitFor(() => expect(screen.getByText("TIGER")).toBeInTheDocument());
      expect(screen.queryByText("COLOUR 3")).toBeNull();
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/auth/me/cosmetics"),
        expect.objectContaining({ method: "PUT", body: JSON.stringify({ color: 2, skin: "tiger" }) }),
      );
    });

    it("SAVE takes the skin off for NONE, and the color shows again", async () => {
      xp = xpLevelStart(6);
      await openSkins();
      fireEvent.click(await screen.findByRole("button", { name: "TIGER" }));
      fireEvent.click(screen.getByRole("button", { name: "SAVE" }));
      await screen.findByText("TIGER");

      fireEvent.click(screen.getByRole("button", { name: "No skin" }));
      fireEvent.click(screen.getByRole("button", { name: "SAVE" }));

      await waitFor(() => expect(screen.getByText("COLOUR 3")).toBeInTheDocument());
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/auth/me/cosmetics"),
        expect.objectContaining({ body: JSON.stringify({ color: 2, skin: null }) }),
      );
    });
  });

  describe("emotes and a victory pose (ADR 0110)", () => {
    it("SAVE stores a new emote beside the colour, and leaves an unchanged pose out", async () => {
      renderAt("/character");
      await screen.findByText("COLOUR 3");
      fireEvent.click(screen.getByRole("tab", { name: "EMOTES" }));

      fireEvent.click(screen.getByRole("button", { name: "PUNCH" }));
      fireEvent.click(screen.getByRole("button", { name: "SAVE" }));

      await waitFor(() =>
        expect(globalThis.fetch).toHaveBeenCalledWith(
          expect.stringContaining("/auth/me/cosmetics"),
          expect.objectContaining({ method: "PUT", body: JSON.stringify({ color: 2, emote: "punch" }) }),
        ),
      );
      await waitFor(() => expect(screen.getByRole("button", { name: "PUNCH" })).toHaveAttribute("aria-pressed", "true"));
    });

    it("VICTORY POSE steps to the next pose and SAVE stores it", async () => {
      renderAt("/character");
      await screen.findByText("COLOUR 3");

      fireEvent.click(screen.getByRole("button", { name: "VICTORY POSE · WIN" }));
      expect(screen.getByRole("button", { name: "VICTORY POSE · SHRUG" })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "SAVE" }));

      await waitFor(() =>
        expect(globalThis.fetch).toHaveBeenCalledWith(
          expect.stringContaining("/auth/me/cosmetics"),
          expect.objectContaining({ body: JSON.stringify({ color: 2, victoryPose: "shrug" }) }),
        ),
      );
    });
  });
});
