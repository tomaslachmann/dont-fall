// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { DEFAULT_API_PORT, type PartyMemberView } from "@dont-fall/shared";
import PlaySelect from "./PlaySelect";
import { WithQuery } from "../test/query.js";
import { connectFakeAccountSocket } from "../test/fakeAccountSocket.js";

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
/** Who is signed in — BRINGING shows your own face first (ADR 0112). */
const ACCOUNT = { id: "me", displayName: "Noodle", color: 1, avatarUploadedAt: null, xp: 0 };

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
  const me = { ok: true, status: 200, json: () => Promise.resolve(ACCOUNT) };
  return vi.fn(async (url: unknown) =>
    String(url).endsWith("/game-settings")
      ? settings
      : String(url).endsWith("/auth/me")
        ? me
        : isFriends(url)
          ? friendsAnswer(url)
          : broker,
  );
};

/** Every broker call the mock saw, in order — the settings, account and friends fetches filtered out. */
const brokerCalls = (fetchMock: ReturnType<typeof respond>): unknown[][] =>
  fetchMock.mock.calls.filter(
    ([url]) => !String(url).endsWith("/game-settings") && !String(url).endsWith("/auth/me") && !isFriends(url),
  );

beforeEach(() => {
  localStorage.setItem("df_auth_token", "tok-1");
  vi.stubGlobal("fetch", respond(200, { id: "l1", port: 51234 }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.removeItem("df_auth_token");
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
    // ADR 0110: WHO CAN JOIN and ROUNDS travel with the create.
    fireEvent.click(screen.getByRole("button", { name: "FRIENDS" }));
    fireEvent.click(screen.getByRole("button", { name: /^More/ }));
    fireEvent.click(screen.getByRole("button", { name: /CREATE LOBBY/ }));

    expect(await screen.findByText("landed:/lobby?port=51234&code=PLUMJA&id=l1")).toBeInTheDocument();
    const bodies = brokerCalls(fetchMock).map(([, init]) => JSON.parse((init as RequestInit).body as string));
    expect(bodies).toEqual([{ isPrivate: true, matchLength: 4, privacy: "friends" }]);
  });

  it("resolves a typed join code through the broker before connecting to anything", async () => {
    const fetchMock = respond(200, { id: "l1", port: 51234 });
    vi.stubGlobal("fetch", fetchMock);

    renderPlaySelect();
    fireEvent.click(screen.getByRole("tab", { name: /JOIN PRIVATE LOBBY/ }));
    typeCode("PLUMJA");
    fireEvent.click(screen.getByRole("button", { name: /JOIN LOBBY/ }));

    expect(await screen.findByText("landed:/lobby?port=51234&code=PLUMJA&id=l1")).toBeInTheDocument();
    expect(brokerCalls(fetchMock).map(([url]) => url)).toEqual([`http://localhost:${DEFAULT_API_PORT}/lobbies/join`]);
    expect(brokerCalls(fetchMock).map(([, init]) => JSON.parse((init as RequestInit).body as string))).toEqual([
      { code: "PLUMJA" },
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

describe("PlaySelect — the Party (ADR 0112)", () => {
  const member = (accountId: string, displayName: string, place: PartyMemberView["place"] = "menu"): PartyMemberView => ({
    accountId,
    displayName,
    color: 2,
    skin: null,
    hat: null,
    avatarUploadedAt: null,
    xp: 0,
    joinedAt: 1,
    place,
    online: true,
  });

  let account: ReturnType<typeof connectFakeAccountSocket> | null = null;
  afterEach(() => {
    account?.stop();
    account = null;
  });

  /** Signs the Account socket in as `me`, in a Party `hostAccountId` hosts. */
  const inParty = (hostAccountId: string, members: PartyMemberView[]): void => {
    account = connectFakeAccountSocket("me");
    const { socket } = account;
    act(() =>
      socket.deliver({
        type: "party",
        party: { id: "p1", hostAccountId, members, pending: [], code: null, codeExpiresAt: null, lobby: null },
      }),
    );
  };

  /** Whose faces BRINGING shows, in order, off their pictures' addresses. */
  const faces = (container: HTMLElement): string[] =>
    [...container.querySelectorAll<HTMLImageElement>('img[src*="/avatars/"]')].map((img) =>
      decodeURIComponent(new URL(img.src).pathname.split("/").pop()!),
    );

  it("alone, BRINGING is just you, and the rest of the Lobby is strangers", async () => {
    const { container } = renderPlaySelect();

    expect(await screen.findByText("Just you — invite friends from the menu")).toBeInTheDocument();
    expect(await screen.findByText("Drop into the next race with 9 strangers.")).toBeInTheDocument();
    await waitFor(() => expect(faces(container)).toEqual(["me"]));
  });

  it("the host brings the Party: your face first, then your members', and fewer strangers", async () => {
    inParty("me", [member("me", "Noodle"), member("a2", "Floppo"), member("a3", "Goopy")]);
    const { container } = renderPlaySelect();

    expect(await screen.findByText("2 friends in your party")).toBeInTheDocument();
    expect(await screen.findByText("Drop into the next race with 7 strangers.")).toBeInTheDocument();
    await waitFor(() => expect(faces(container)).toEqual(["me", "a2", "a3"]));
    expect(screen.getByRole("button", { name: /FIND A MATCH/ })).not.toBeDisabled();
  });

  it("the host's FIND A MATCH waits for every member to be back in the menus", async () => {
    inParty("me", [member("me", "Noodle"), member("a2", "Floppo"), member("a3", "Goopy", "match")]);
    renderPlaySelect();

    const find = screen.getByRole("button", { name: /FIND A MATCH/ });
    expect(find).toBeDisabled();
    expect(find).toHaveTextContent("WAITING FOR GOOPY");
    expect(screen.getByText("2 friends in your party")).toBeInTheDocument();

    // Goopy leaves their podium: PLAY is the host's again.
    act(() =>
      account!.socket.deliver({
        type: "party",
        party: {
          id: "p1",
          hostAccountId: "me",
          members: [member("me", "Noodle"), member("a2", "Floppo"), member("a3", "Goopy")],
          pending: [],
          code: null,
          codeExpiresAt: null,
          lobby: null,
        },
      }),
    );
    expect(screen.getByRole("button", { name: /FIND A MATCH/ })).not.toBeDisabled();
  });

  it("a member's FIND A MATCH is the host's call — CREATE and JOIN stay theirs", async () => {
    inParty("a2", [member("a2", "Floppo"), member("me", "Noodle")]);
    renderPlaySelect();

    const find = screen.getByRole("button", { name: /FIND A MATCH/ });
    expect(find).toBeDisabled();
    expect(find).toHaveTextContent("FLOPPO PICKS THE MATCH");
    expect(screen.getByText("1 friend in your party")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /CREATE PRIVATE LOBBY/ }));
    expect(screen.getByRole("button", { name: /CREATE LOBBY/ })).not.toBeDisabled();
  });

  it("lands in the Lobby with the seat the broker reserved", async () => {
    vi.stubGlobal("fetch", respond(200, { id: "l7", port: 61000, reservation: "r-1" }));
    renderPlaySelect();

    fireEvent.click(screen.getByRole("button", { name: /FIND A MATCH/ }));

    expect(await screen.findByText("landed:/lobby?port=61000&id=l7&reservation=r-1")).toBeInTheDocument();
  });
});
