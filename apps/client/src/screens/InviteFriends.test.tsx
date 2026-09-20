// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { PartyCandidateView, PartyMemberView, PartyView } from "@dont-fall/shared";
import { WithQuery } from "../test/query.js";
import { connectFakeAccountSocket } from "../test/fakeAccountSocket.js";
import { clearFlashes, getFlashesSnapshot } from "../lib/flash.js";
import InviteFriends from "./InviteFriends";

const member = (accountId: string, displayName: string): PartyMemberView => ({
  accountId,
  displayName,
  color: 2,
  skin: null,
  hat: null,
  avatarUploadedAt: null,
  xp: 0,
  joinedAt: 1,
  place: "menu",
  online: true,
});

const PARTY: PartyView = {
  id: "p1",
  hostAccountId: "me",
  members: [member("me", "Noodle")],
  pending: [],
  code: "4K7NQX",
  codeExpiresAt: null,
  lobby: null,
};

const candidate = (accountId: string, displayName: string, over: Partial<PartyCandidateView> = {}): PartyCandidateView => ({
  accountId,
  displayName,
  color: 2,
  avatarUploadedAt: null,
  state: "free",
  friend: true,
  online: true,
  inMatch: false,
  place: null,
  otherPartySize: null,
  lastPlayedAt: null,
  lastSeenAt: null,
  inviteId: null,
  inviteSentAt: null,
  ...over,
});

const CANDIDATES = {
  candidates: [
    candidate("b1", "Bonk", { place: "menu" }),
    candidate("b2", "Wiggly", { state: "invited", inviteId: "inv-9", inviteSentAt: Date.now() - 12_000 }),
    candidate("b3", "Mrbeano", { state: "busy", online: false }),
    candidate("r1", "Splat", { friend: false, inMatch: true, lastPlayedAt: 5_000 }),
  ],
  friendCount: 48,
};

const LOOKUPS: Record<string, unknown> = {
  ZZTOP9: { kind: "party", partyId: "p9", hostAccountId: "h1", hostDisplayName: "Floppo", hostColor: 4, hostAvatarUploadedAt: null, size: 2 },
  BONK42: { kind: "account", accountId: "s9", displayName: "Stranger", color: 1, avatarUploadedAt: null, state: "free" },
};

/** Every Party call the card made, as `METHOD path body`. */
const partyCalls = (fetchMock: ReturnType<typeof vi.fn>): string[] =>
  fetchMock.mock.calls
    .map(([input, init]) => {
      const { method = "GET", body } = (init as RequestInit | undefined) ?? {};
      return `${method} ${new URL(String(input)).pathname}${body ? ` ${String(body)}` : ""}`;
    })
    .filter((call) => call.includes("/party"));

let fetchMock: ReturnType<typeof vi.fn>;
let account: ReturnType<typeof connectFakeAccountSocket>;
const onClose = vi.fn();

beforeEach(() => {
  localStorage.setItem("df_auth_token", "tok");
  fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path === "/party/candidates") return Response.json(CANDIDATES);
    const lookup = /^\/party\/lookup\/(.+)$/.exec(path);
    if (lookup) return LOOKUPS[lookup[1]!] ? Response.json(LOOKUPS[lookup[1]!]) : Response.json({ error: "no party or player with that code" }, { status: 404 });
    if (path === "/party/invites") return Response.json({ inviteId: "inv-new" }, { status: 201 });
    if (path === "/party/join") return Response.json({ ...PARTY, id: "p9", hostAccountId: "h1", members: [member("h1", "Floppo"), member("me", "Noodle")], code: null });
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    return Response.json({});
  });
  vi.stubGlobal("fetch", fetchMock);
  account = connectFakeAccountSocket("me");
  act(() => account.socket.deliver({ type: "party", party: PARTY }));
});

afterEach(() => {
  account.stop();
  vi.unstubAllGlobals();
  localStorage.clear();
  clearFlashes();
});

const renderCard = () =>
  render(
    <WithQuery>
      <InviteFriends onClose={onClose} />
    </WithQuery>,
  );

const search = (text: string): void => {
  fireEvent.change(screen.getByLabelText("Search friends or paste a code"), { target: { value: text } });
};

describe("the INVITE FRIENDS card (ADR 0112)", () => {
  it("lists friends online, recent players and every friend, each in the mock's words", async () => {
    renderCard();

    expect(await screen.findByRole("tab", { name: "ONLINE · 2" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "RECENT · 1" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "ALL · 48" })).toBeInTheDocument();
    expect(screen.getByText("3 SLOTS LEFT IN YOUR PARTY")).toBeInTheDocument();
    expect(within(screen.getByRole("listitem", { name: "Bonk" })).getByText("ONLINE · IN MENU")).toBeInTheDocument();
    expect(within(screen.getByRole("listitem", { name: "Wiggly" })).getByText(/^INVITED · WAITING 0:1\d$/)).toBeInTheDocument();
    expect(screen.queryByRole("listitem", { name: "Mrbeano" })).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "RECENT · 1" }));
    expect(within(screen.getByRole("listitem", { name: "Splat" })).getByText("IN A MATCH · CAN STILL JOIN")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "ALL · 48" }));
    const offline = screen.getByRole("listitem", { name: "Mrbeano" });
    // Its status line, and the tag where a button would be.
    expect(within(offline).getAllByText("OFFLINE")).toHaveLength(2);
    expect(within(offline).queryByRole("button")).toBeNull();
  });

  it("INVITE invites by account id, CANCEL takes an invite back", async () => {
    renderCard();

    fireEvent.click(within(await screen.findByRole("listitem", { name: "Bonk" })).getByRole("button", { name: "INVITE" }));
    fireEvent.click(within(screen.getByRole("listitem", { name: "Wiggly" })).getByRole("button", { name: "CANCEL" }));

    await waitFor(() =>
      expect(partyCalls(fetchMock).filter((call) => !call.startsWith("GET"))).toEqual([
        'POST /party/invites {"accountId":"b1"}',
        "DELETE /party/invites/inv-9",
      ]),
    );
    expect(getFlashesSnapshot()).toEqual([]);
  });

  it("asks for the rows again whenever the Party changes", async () => {
    renderCard();
    await screen.findByRole("listitem", { name: "Bonk" });
    const asked = () => partyCalls(fetchMock).filter((call) => call === "GET /party/candidates").length;
    expect(asked()).toBe(1);

    act(() => account.socket.deliver({ type: "party", party: { ...PARTY, members: [member("me", "Noodle"), member("b1", "Bonk")] } }));

    await waitFor(() => expect(asked()).toBe(2));
    expect(await screen.findByText("2 SLOTS LEFT IN YOUR PARTY")).toBeInTheDocument();
  });

  it("the search filters by name, and says so when nothing matches", async () => {
    renderCard();
    await screen.findByRole("listitem", { name: "Bonk" });

    search("wig");
    expect(screen.queryByRole("listitem", { name: "Bonk" })).toBeNull();
    expect(screen.getByRole("listitem", { name: "Wiggly" })).toBeInTheDocument();

    search("zzz");
    expect(screen.getByText("NO BEANS MATCH — TRY THE CODE INSTEAD")).toBeInTheDocument();
  });

  it("a pasted Party code shows the host's Party, and JOIN joins it", async () => {
    renderCard();
    search("zztop9");

    const found = await screen.findByRole("listitem", { name: "FLOPPO'S PARTY · 2/4" });
    expect(within(found).getByText("Floppo")).toBeInTheDocument();
    fireEvent.click(within(found).getByRole("button", { name: "JOIN" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(partyCalls(fetchMock)).toContain('POST /party/join {"code":"ZZTOP9"}');
    expect(getFlashesSnapshot().map((f) => f.title)).toEqual(["You joined Floppo's party."]);
  });

  it("a pasted friend code shows that bean, and INVITE sends the code", async () => {
    renderCard();
    search("BONK42");

    const found = await screen.findByRole("listitem", { name: "Stranger" });
    expect(within(found).getByText("FRIEND CODE BONK42")).toBeInTheDocument();
    fireEvent.click(within(found).getByRole("button", { name: "INVITE" }));

    await waitFor(() => expect(partyCalls(fetchMock)).toContain('POST /party/invites {"code":"BONK42"}'));
  });

  it("a six-letter name that is no code is just a search", async () => {
    renderCard();
    await screen.findByRole("listitem", { name: "Bonk" });
    search("WIGGLY");

    await waitFor(() => expect(partyCalls(fetchMock)).toContain("GET /party/lookup/WIGGLY"));
    expect(screen.getByRole("listitem", { name: "Wiggly" })).toBeInTheDocument();
    expect(getFlashesSnapshot()).toEqual([]);
  });

  it("the CODE chip copies the code and says COPIED; SHARE LINK copies the link to /party/<code>", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: "Copy the party code 4K7NQX" }));
    expect(await screen.findByText("COPIED")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "SHARE LINK" }));

    await waitFor(() => expect(writeText.mock.calls).toEqual([["4K7NQX"], [new URL("/party/4K7NQX", location.href).toString()]]));
    await waitFor(() => expect(getFlashesSnapshot().map((f) => f.title)).toEqual(["Party link copied."]));
  });
});
