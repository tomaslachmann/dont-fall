// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { PartyMemberView, PartyPendingView, PartyView } from "@dont-fall/shared";
import { WithQuery } from "../test/query.js";
import { connectFakeAccountSocket } from "../test/fakeAccountSocket.js";
import { clearFlashes, getFlashesSnapshot } from "../lib/flash.js";
import MainMenu from "./MainMenu";

const ACCOUNT = {
  id: "me",
  discordId: null,
  email: "bean@example.com",
  displayName: "Noodle",
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

const partyOf = (hostAccountId: string, members: PartyMemberView[], pending: PartyPendingView[] = []): PartyView => ({
  id: "p1",
  hostAccountId,
  members,
  pending,
  code: hostAccountId === "me" && members.length + pending.length < 4 ? "4K7NQX" : null,
  codeExpiresAt: null,
  lobby: null,
});

/** Every call the menu made that is a Party action, as `METHOD path`. */
const partyCalls = (fetchMock: ReturnType<typeof vi.fn>): string[] =>
  fetchMock.mock.calls
    .map(([input, init]) => `${(init as RequestInit | undefined)?.method ?? "GET"} ${new URL(String(input)).pathname}`)
    .filter((call) => call.includes("/party"));

let fetchMock: ReturnType<typeof vi.fn>;
let account: ReturnType<typeof connectFakeAccountSocket> | null = null;

beforeEach(() => {
  localStorage.setItem("df_auth_token", "tok");
  fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/auth/me")) return Response.json(ACCOUNT);
    if (url.endsWith("/game-settings")) return Response.json({ maxPlayers: 10, onlinePlayers: 3 });
    if (url.endsWith("/friends")) return Response.json({ friends: [], online: 5, total: 9, requests: [] });
    if (url.endsWith("/friends/recent")) return Response.json({ recent: [] });
    if (url.endsWith("/friends/code")) return Response.json({ code: "ABC123" });
    if (url.endsWith("/career")) return Response.json({ stats: STATS, badges: { earned: [], total: 6 }, matches: [] });
    if (url.endsWith("/party/candidates")) return Response.json({ candidates: [], friendCount: 0 });
    if (url.includes("/party/") && (init?.method === "DELETE" || url.endsWith("/leave"))) return new Response(null, { status: 204 });
    return Response.json({});
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  account?.stop();
  account = null;
  vi.unstubAllGlobals();
  localStorage.clear();
  clearFlashes();
});

const inParty = (party: PartyView): void => {
  account = connectFakeAccountSocket("me");
  const { socket } = account;
  act(() => socket.deliver({ type: "party", party }));
};

const renderMenu = () =>
  render(
    <MemoryRouter>
      <WithQuery>
        <MainMenu />
      </WithQuery>
    </MemoryRouter>,
  );

describe("MainMenu alone keeps its stat tiles (ADR 0110, and the user's call on ADR 0112)", () => {
  it("a party of one: QUICK MATCH, the tiles, and no strip", async () => {
    inParty(partyOf("me", [member("me", "Noodle")]));
    renderMenu();

    expect(await screen.findByText("QUICK MATCH · 3 BEANS ONLINE")).toBeInTheDocument();
    expect(screen.getByText("BEST SURVIVAL")).toBeInTheDocument();
    expect(screen.getByText("WINS")).toBeInTheDocument();
    expect(screen.getByText("GRABS BROKEN")).toBeInTheDocument();
    expect(screen.getByText(/IDLE \+ YOUR EMOTE/)).toBeInTheDocument();
    // Nothing of the strip: no title, no slots, no LEAVE PARTY.
    expect(screen.queryByText("YOUR PARTY")).toBeNull();
    expect(screen.queryByRole("button", { name: "LEAVE PARTY" })).toBeNull();
    expect(screen.queryByRole("button", { name: "INVITE FRIENDS" })).toBeNull();
  });

  it("the tiles are the career's own numbers", async () => {
    inParty(partyOf("me", [member("me", "Noodle")]));
    renderMenu();

    // 371 400 ms of survival as the tile spells it, the wins, the grabs broken —
    // and never a number the career did not send.
    expect(await screen.findByText("06:11")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("17")).toBeInTheDocument();
    expect(screen.queryByText("137")).toBeNull();
  });

  it("before the Party arrives, the menu is a lone bean's too", async () => {
    renderMenu();

    // Only the header wears the name — there is no strip slot to repeat it.
    expect(await screen.findAllByText("Noodle")).toHaveLength(1);
    expect(screen.getByText("BEST SURVIVAL")).toBeInTheDocument();
    expect(screen.queryByText("1/4")).toBeNull();
  });
});

describe("MainMenu wears the Party while it is active (ADR 0112)", () => {
  it("one invite out is enough: the strip takes the tiles' place", async () => {
    inParty(
      partyOf("me", [member("me", "Noodle")], [
        { inviteId: "inv-2", accountId: "a2", displayName: "Floppo", color: 1, avatarUploadedAt: null, sentAt: Date.now() },
      ]),
    );
    renderMenu();

    expect(await screen.findByText("YOUR PARTY")).toBeInTheDocument();
    expect(screen.getByText("HOST · YOU")).toBeInTheDocument();
    expect(screen.getByText("1/4 · 1 INVITED")).toBeInTheDocument();
    expect(screen.queryByText("BEST SURVIVAL")).toBeNull();
    expect(screen.queryByText("GRABS BROKEN")).toBeNull();
    // The invite slot counts friends online, off the same overview the FRIENDS badge reads.
    expect(await screen.findByText("5 ONLINE")).toBeInTheDocument();
  });

  it("the host: PLAY AS A PARTY, every bean in the hero, and × at once on a bean or an invite", async () => {
    inParty(
      partyOf(
        "me",
        [member("me", "Noodle"), member("a2", "Floppo"), member("a3", "Goopy")],
        [{ inviteId: "inv-4", accountId: "a4", displayName: "Wiggly", color: 1, avatarUploadedAt: null, sentAt: Date.now() - 42_000 }],
      ),
    );
    renderMenu();

    expect(screen.getByText("PLAY AS A PARTY · 3 BEANS READY")).toBeInTheDocument();
    expect(screen.getByText(/PARTY OF THREE, IDLE \+ YOUR EMOTE/)).toBeInTheDocument();
    expect(screen.getByText(/^INVITED · 0:4\d$/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove Floppo from the party" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel invite to Wiggly" }));
    await waitFor(() =>
      expect(partyCalls(fetchMock)).toEqual(["DELETE /party/members/a2", "DELETE /party/invites/inv-4"]),
    );
  });

  it("the host's PLAY waits for a member still in a Match", () => {
    inParty(partyOf("me", [member("me", "Noodle"), member("a2", "Floppo"), member("a3", "Goopy", "match")]));
    renderMenu();

    expect(screen.getByText("WAITING FOR GOOPY")).toBeInTheDocument();
    expect(screen.getByText("IN A MATCH")).toBeInTheDocument();
  });

  it("a member: the host's strip, no ×, and LEAVE PARTY leaves with a flash", async () => {
    inParty(partyOf("a2", [member("a2", "Floppo"), member("me", "Noodle")]));
    renderMenu();

    expect(screen.getByText("FLOPPO'S PARTY")).toBeInTheDocument();
    expect(screen.getByText("Only the host can invite or remove beans.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "INVITE FRIENDS" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "LEAVE PARTY" }));
    await waitFor(() => expect(getFlashesSnapshot().map((f) => f.title)).toEqual(["You left Floppo's party."]));
    expect(partyCalls(fetchMock)).toEqual(["POST /party/leave"]);
  });

  it("INVITE FRIENDS opens the card over the menu, and it closes", async () => {
    inParty(partyOf("me", [member("me", "Noodle"), member("a2", "Floppo")]));
    renderMenu();

    fireEvent.click(screen.getByRole("button", { name: "INVITE FRIENDS" }));
    expect(await screen.findByText("2 SLOTS LEFT IN YOUR PARTY")).toBeInTheDocument();
    await waitFor(() => expect(partyCalls(fetchMock)).toContain("GET /party/candidates"));

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByText("2 SLOTS LEFT IN YOUR PARTY")).toBeNull();
  });
});
