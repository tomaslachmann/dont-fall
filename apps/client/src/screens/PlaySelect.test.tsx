// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { DEFAULT_API_PORT } from "@dont-fall/shared";
import PlaySelect from "./PlaySelect";
import { WithQuery } from "../test/query.js";

/** Renders the Screen with a stand-in `/lobby` that simply prints the URL it was sent to. */
const renderPlaySelect = () => {
  const Landed = () => {
    const { pathname, search } = useLocation();
    return <div>landed:{pathname}{search}</div>;
  };
  return render(
    <MemoryRouter initialEntries={["/play"]}>
      <Routes>
        <Route path="/play" element={<WithQuery><PlaySelect /></WithQuery>} />
        <Route path="/lobby" element={<Landed />} />
      </Routes>
    </MemoryRouter>,
  );
};

const SETTINGS = { maxPlayers: 10, onlinePlayers: 3244 };

/**
 * Routes by URL: the Screen fetches `/game-settings` on mount plus one
 * broker call per user action. A single flat mock would answer the settings
 * fetch with a Lobby (or vice versa), so the broker answer is scripted per
 * test while settings always answer for real.
 */
/** Friends presence (ADR 0110) — nobody in a Lobby unless a test says so. */
let friendsOverview: unknown = { friends: [], online: 0, total: 0, requests: [] };
const isFriends = (url: unknown): boolean => /\/friends(\/|$)/.test(String(url));

const respond = (status: number, body: unknown) => {
  const broker = { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) };
  const settings = { ok: true, status: 200, json: () => Promise.resolve(SETTINGS) };
  const friendsAnswer = (url: unknown) => {
    const path = String(url);
    const payload = path.endsWith("/friends") ? friendsOverview : path.endsWith("/friends/recent") ? { recent: [] } : { code: "ABC123" };
    return { ok: true, status: 200, json: () => Promise.resolve(payload) };
  };
  return vi.fn(async (url: unknown) =>
    String(url).endsWith("/game-settings") ? settings : isFriends(url) ? friendsAnswer(url) : broker,
  );
};

/** Every broker call the mock saw, in order — the settings and friends fetches filtered out. */
const brokerCalls = (fetchMock: ReturnType<typeof respond>): unknown[][] =>
  fetchMock.mock.calls.filter(([url]) => !String(url).endsWith("/game-settings") && !isFriends(url));

beforeEach(() => {
  vi.stubGlobal("fetch", respond(200, { id: "l1", port: 51234 }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  friendsOverview = { friends: [], online: 0, total: 0, requests: [] };
});

const typeCode = (code: string): void => {
  const cells = screen.getAllByLabelText(/Code character/);
  code.split("").forEach((ch, i) => fireEvent.change(cells[i]!, { target: { value: ch } }));
};

describe("PlaySelect (ADR 0054 — every way in goes through the API's lobbies)", () => {
  it("quick-matches through the broker, then connects to the port it named", async () => {
    const fetchMock = respond(200, { id: "l7", port: 61000 });
    vi.stubGlobal("fetch", fetchMock);

    renderPlaySelect();
    fireEvent.click(screen.getByRole("button", { name: /FIND A MATCH/ }));

    expect(await screen.findByText("landed:/lobby?port=61000&id=l7")).toBeInTheDocument();
    expect(brokerCalls(fetchMock).map(([url]) => url)).toEqual([
      `http://localhost:${DEFAULT_API_PORT}/lobbies/quick-match`,
    ]);
  });

  it("creates a private Lobby and carries its join code onto the Lobby Screen", async () => {
    const fetchMock = respond(201, { id: "l1", port: 51234, code: "PLUMJA", isPrivate: true });
    vi.stubGlobal("fetch", fetchMock);

    renderPlaySelect();
    fireEvent.click(screen.getByRole("tab", { name: /CREATE PRIVATE LOBBY/ }));
    fireEvent.click(screen.getByRole("button", { name: /CREATE LOBBY/ }));

    expect(await screen.findByText("landed:/lobby?port=51234&code=PLUMJA&id=l1")).toBeInTheDocument();
    const bodies = brokerCalls(fetchMock).map(([, init]) => JSON.parse((init as RequestInit).body as string));
    expect(bodies).toEqual([{ isPrivate: true }]);
  });

  it("resolves a typed join code through the broker before connecting to anything", async () => {
    const fetchMock = respond(200, { id: "l1", port: 51234 });
    vi.stubGlobal("fetch", fetchMock);

    renderPlaySelect();
    fireEvent.click(screen.getByRole("tab", { name: /JOIN PRIVATE LOBBY/ }));
    typeCode("PLUMJA");
    fireEvent.click(screen.getByRole("button", { name: /JOIN LOBBY/ }));

    expect(await screen.findByText("landed:/lobby?port=51234&code=PLUMJA&id=l1")).toBeInTheDocument();
    expect(brokerCalls(fetchMock).map(([url]) => url)).toEqual([
      `http://localhost:${DEFAULT_API_PORT}/lobbies/code/PLUMJA`,
    ]);
  });

  it("keeps JOIN disabled until the code is complete", () => {
    renderPlaySelect();
    fireEvent.click(screen.getByRole("tab", { name: /JOIN PRIVATE LOBBY/ }));

    expect(screen.getByRole("button", { name: /JOIN LOBBY/ })).toBeDisabled();
    typeCode("PLUMJA");
    expect(screen.getByRole("button", { name: /JOIN LOBBY/ })).not.toBeDisabled();
  });

  it("shows the broker's own refusal and stays put, rather than connecting to nothing", async () => {
    vi.stubGlobal("fetch", respond(404, { error: 'no Lobby with code "ZZZZZZ"' }));

    renderPlaySelect();
    fireEvent.click(screen.getByRole("tab", { name: /JOIN PRIVATE LOBBY/ }));
    typeCode("ZZZZZZ");
    fireEvent.click(screen.getByRole("button", { name: /JOIN LOBBY/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent('no Lobby with code "ZZZZZZ"');
    expect(screen.queryByText(/^landed:/)).not.toBeInTheDocument();
    // Free to try again — the failed attempt released the button.
    await waitFor(() => expect(screen.getByRole("button", { name: /JOIN LOBBY/ })).not.toBeDisabled());
  });

  it("asks the broker once, however fast the button is pressed", async () => {
    const fetchMock = respond(200, { id: "l7", port: 61000 });
    vi.stubGlobal("fetch", fetchMock);

    renderPlaySelect();
    const button = screen.getByRole("button", { name: /FIND A MATCH/ });
    fireEvent.click(button);
    fireEvent.click(button);

    await screen.findByText("landed:/lobby?port=61000&id=l7");
    expect(brokerCalls(fetchMock)).toHaveLength(1);
  });

  it("lists friends waiting in a Lobby, and USE CODE fills their code (ADR 0110)", async () => {
    friendsOverview = {
      friends: [
        {
          accountId: "acc-w",
          displayName: "Wobbletoast",
          avatarUrl: null,
          color: 2,
          friendsSince: 0,
          presence: { status: "in-lobby", slotsOpen: 3, joinable: true, lobby: { kind: "private", code: "PLUMJA" } },
        },
      ],
      online: 1,
      total: 1,
      requests: [],
    };
    renderPlaySelect();
    // The cap less yourself, off /game-settings.
    expect(await screen.findByText("Drop into the next race with 9 strangers.")).toBeDefined();
    fireEvent.click(screen.getByRole("tab", { name: /JOIN PRIVATE LOBBY/ }));

    fireEvent.click(await screen.findByRole("button", { name: /WOBBLETOAST/ }));
    const cells = screen.getAllByLabelText(/Code character/) as HTMLInputElement[];
    expect(cells.map((cell) => cell.value).join("")).toBe("PLUMJA");
  });
});
