// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BINDINGS, type KeyBindings } from "@dont-fall/shared";
import { clearFlashes } from "../lib/flash.js";
import FlashHost from "../ui/FlashHost.js";
import Settings from "./Settings";

const ACCOUNT = {
  id: "acc-1",
  discordId: null,
  email: "bean@example.com",
  displayName: "Bean",
  avatarUrl: null,
  xp: 0,
  coins: 0,
  color: 0,
  bindings: null as KeyBindings | null,
};

const renderAt = (entry: string) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        {/* The shell mounts the flash stack above the routes — this test does the same. */}
        <FlashHost />
        <Routes>
          <Route path="/settings" element={<Settings />} />
          <Route path="/" element={<div>home</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe("Settings CONTROLS tab", () => {
  const realFetch = globalThis.fetch;
  let stored: KeyBindings | null;
  let puts: unknown[];

  beforeEach(() => {
    clearFlashes();
    localStorage.setItem("df_auth_token", "tok");
    stored = null;
    puts = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/auth/me")) return Response.json({ ...ACCOUNT, bindings: stored });
        if (url.endsWith("/auth/me/bindings") && init?.method === "PUT") {
          stored = (JSON.parse(init.body as string) as { bindings: KeyBindings }).bindings;
          puts.push(stored);
          return Response.json({ ...ACCOUNT, bindings: stored });
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

  const openControls = async () => {
    renderAt("/settings");
    fireEvent.click(screen.getByRole("tab", { name: "CONTROLS" }));
    await screen.findByText("MOVE FORWARD");
  };

  it("lists every action with its current controls", async () => {
    await openControls();

    for (const label of ["MOVE FORWARD", "MOVE BACK", "MOVE LEFT", "MOVE RIGHT", "JUMP", "DASH", "HIT", "GRAB", "SPECTATE NEXT"]) {
      expect(screen.getByText(label)).toBeDefined();
    }
    expect(screen.getByText("W")).toBeDefined();
    expect(screen.getByText("Space")).toBeDefined();
  });

  it("replaces a control on keypress and persists the whole record", async () => {
    await openControls();
    fireEvent.click(screen.getByText("Space"));
    expect(screen.getByText(/press a key/i)).toBeDefined();

    fireEvent.keyDown(window, { code: "KeyJ" });

    await waitFor(() => expect(screen.queryByText("Space")).toBeNull());
    expect(screen.getByText("J")).toBeDefined();
    expect(puts).toHaveLength(1);
    expect(puts[0]).toMatchObject({ ...DEFAULT_BINDINGS, jump: ["KeyJ"] });
    expect(JSON.parse(localStorage.getItem("dontfall.bindings.v1:acc-1")!)).toMatchObject({ jump: ["KeyJ"] });
  });

  it("binds mouse buttons, and Escape cancels the capture", async () => {
    await openControls();
    fireEvent.click(screen.getByText("F"));
    fireEvent.mouseDown(window, { button: 0 });
    await waitFor(() => expect(screen.getByText("Left Click")).toBeDefined());

    fireEvent.click(screen.getByText("G"));
    fireEvent.keyDown(window, { code: "Escape" });
    expect(screen.queryByText(/press a key/i)).toBeNull();
    expect(screen.getByText("G")).toBeDefined();
  });

  it("warns on conflicts instead of forbidding them", async () => {
    await openControls();
    fireEvent.click(screen.getByText("F"));
    fireEvent.keyDown(window, { code: "KeyG" });

    await waitFor(() => expect(screen.getAllByText(/also drives/i)).toHaveLength(2));
  });

  it("unbinds a control through its remove button", async () => {
    await openControls();
    fireEvent.click(screen.getByLabelText("unbind Jump control 1"));

    await waitFor(() => expect(screen.getByText("Unbound")).toBeDefined());
    expect(puts.at(-1)).toMatchObject({ jump: [] });
  });

  it("flashes when the save fails, instead of pretending", async () => {
    localStorage.setItem("df_auth_token", "tok");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/auth/me")) return Response.json({ ...ACCOUNT, bindings: null });
        return Response.json({ message: "boom" }, { status: 500 });
      }),
    );
    renderAt("/settings");
    fireEvent.click(screen.getByRole("tab", { name: "CONTROLS" }));
    await screen.findByText("MOVE FORWARD");

    fireEvent.click(screen.getByText("Space"));
    fireEvent.keyDown(window, { code: "KeyJ" });

    await waitFor(() => expect(screen.getByText(/couldn't save controls/i)).toBeDefined());
    // The draft still applies locally — the mirror wrote, only the API failed.
    expect(JSON.parse(localStorage.getItem("dontfall.bindings.v1:acc-1")!)).toMatchObject({ jump: ["KeyJ"] });
  });

  it("resets the tab to defaults", async () => {
    await openControls();
    fireEvent.click(screen.getByText("Space"));
    fireEvent.keyDown(window, { code: "KeyJ" });
    await waitFor(() => expect(screen.getByText("J")).toBeDefined());

    fireEvent.click(screen.getByText("RESET"));
    await waitFor(() => expect(screen.getByText("Space")).toBeDefined());
    expect(puts.at(-1)).toEqual(DEFAULT_BINDINGS);
  });

  it("works fully offline for guests — localStorage only, no PUT", async () => {
    localStorage.removeItem("df_auth_token");
    renderAt("/settings");
    fireEvent.click(screen.getByRole("tab", { name: "CONTROLS" }));
    await screen.findByText("MOVE FORWARD");

    fireEvent.click(screen.getByText("Space"));
    fireEvent.keyDown(window, { code: "KeyJ" });

    await waitFor(() => expect(screen.getByText("J")).toBeDefined());
    expect(puts).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem("dontfall.bindings.v1:guest")!)).toMatchObject({ jump: ["KeyJ"] });
  });
});
