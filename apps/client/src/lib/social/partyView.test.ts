import { describe, expect, it } from "vitest";
import type { PartyCandidateView, PartyMemberView, PartyPendingView, PartyView } from "@dont-fall/shared";
import { partyStateOf } from "./accountSocket.js";
import {
  awayLabel,
  canLeaveParty,
  codeInQuery,
  foundRow,
  heroCaption,
  inviteTabs,
  isPartyActive,
  joinedPartyMessage,
  matchingRows,
  partySlots,
  playKicker,
  slotsLeft,
  stripHeading,
} from "./partyView.js";

const NOW = 1_000_000;

const member = (accountId: string, displayName: string, over: Partial<PartyMemberView> = {}): PartyMemberView => ({
  accountId,
  displayName,
  color: 3,
  skin: null,
  hat: null,
  avatarUploadedAt: null,
  xp: 0,
  joinedAt: 1,
  place: "menu",
  online: true,
  ...over,
});

const pending = (accountId: string, displayName: string, sentAt: number): PartyPendingView => ({
  inviteId: `inv-${accountId}`,
  accountId,
  displayName,
  color: 5,
  avatarUploadedAt: null,
  sentAt,
});

const partyOf = (host: string, members: PartyMemberView[], invites: PartyPendingView[] = [], code: string | null = "4K7NQX"): PartyView => ({
  id: "p1",
  hostAccountId: host,
  members,
  pending: invites,
  code,
  codeExpiresAt: code === null ? null : NOW + 60_000,
  lobby: null,
});

/** The Party as `me` reads it. */
const seen = (party: PartyView | null) => partyStateOf({ party, accountId: "me" });

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

describe("the PartyStrip's slots (ADR 0112)", () => {
  it("before the Party arrives, you are a party of one, hosting", () => {
    const slots = partySlots(seen(null), { id: "me", displayName: "Noodle", color: 1, avatarUploadedAt: null, xp: 0 }, NOW);
    expect(slots).toEqual([expect.objectContaining({ accountId: "me", name: "Noodle", you: true, host: true, level: 1 })]);
  });

  it("seats members in the Party's order, then the invites still out, counting from when each was sent", () => {
    const party = seen(
      partyOf("me", [member("me", "Noodle"), member("a2", "Floppo", { place: "match" })], [pending("a3", "Goopy", NOW - 42_000)]),
    );
    const slots = partySlots(party, null, NOW);

    expect(slots.map((slot) => slot.accountId)).toEqual(["me", "a2", "a3"]);
    expect(slots[0]).toMatchObject({ you: true, host: true });
    expect(slots[1]).toMatchObject({ away: "IN A MATCH" });
    expect(slots[1]).not.toHaveProperty("host");
    expect(slots[2]).toMatchObject({ pending: true, waiting: "0:42" });
  });

  it("says truthfully where a member is instead of READY", () => {
    expect(awayLabel({ place: "menu", online: true })).toBeNull();
    expect(awayLabel({ place: "lobby", online: true })).toBe("IN THE LOBBY");
    expect(awayLabel({ place: "match", online: true })).toBe("IN A MATCH");
    // A closed tab is nobody ready, whatever it last said.
    expect(awayLabel({ place: "menu", online: false })).toBe("OFFLINE");
  });

  it("titles the strip for the host and for a member, with the mock's lines", () => {
    expect(stripHeading(seen(partyOf("me", [member("me", "Noodle")])))).toEqual({
      title: "YOUR PARTY",
      note: "Invite up to three friends — the party stays together between rounds.",
    });
    expect(stripHeading(seen(partyOf("me", [member("me", "Noodle"), member("a2", "Floppo")])))).toEqual({
      title: "YOUR PARTY",
      note: undefined,
    });
    expect(stripHeading(seen(partyOf("a2", [member("a2", "Floppo"), member("me", "Noodle")])))).toEqual({
      title: "FLOPPO'S PARTY",
      note: "Only the host can invite or remove beans.",
    });
  });

  it("LEAVE PARTY has nothing to leave alone with no invites out", () => {
    expect(canLeaveParty(seen(null))).toBe(false);
    expect(canLeaveParty(seen(partyOf("me", [member("me", "Noodle")])))).toBe(false);
    expect(canLeaveParty(seen(partyOf("me", [member("me", "Noodle")], [pending("a3", "Goopy", NOW)])))).toBe(true);
    expect(canLeaveParty(seen(partyOf("a2", [member("a2", "Floppo"), member("me", "Noodle")])))).toBe(true);
  });

  it("the menu wears the Party once it has a second bean or an invite out", () => {
    expect(isPartyActive(seen(null))).toBe(false);
    expect(isPartyActive(seen(partyOf("me", [member("me", "Noodle")])))).toBe(false);
    expect(isPartyActive(seen(partyOf("me", [member("me", "Noodle")], [pending("a3", "Goopy", NOW)])))).toBe(true);
    expect(isPartyActive(seen(partyOf("a2", [member("a2", "Floppo"), member("me", "Noodle")])))).toBe(true);
  });

  it("an invite out takes a slot", () => {
    expect(slotsLeft(seen(null))).toBe(3);
    expect(slotsLeft(seen(partyOf("me", [member("me", "Noodle"), member("a2", "Floppo")], [pending("a3", "Goopy", NOW)])))).toBe(1);
  });
});

describe("PLAY's kicker (ADR 0112)", () => {
  it("alone, it is today's QUICK MATCH", () => {
    expect(playKicker(seen(partyOf("me", [member("me", "Noodle")])), "3 244")).toBe("QUICK MATCH · 3 244 BEANS ONLINE");
    expect(playKicker(seen(null), undefined)).toBe("QUICK MATCH");
  });

  it("in a Party, it counts the beans in the menus", () => {
    const party = seen(partyOf("me", [member("me", "Noodle"), member("a2", "Floppo"), member("a3", "Goopy")]));
    expect(playKicker(party, "3 244")).toBe("PLAY AS A PARTY · 3 BEANS READY");
  });

  it("the host's waits for a member still in a Lobby, a Match or its results", () => {
    const party = seen(partyOf("me", [member("me", "Noodle"), member("a2", "Floppo", { place: "lobby" })]));
    expect(playKicker(party, "3 244")).toBe("WAITING FOR FLOPPO");
  });

  it("a member whose game is closed does not hold PLAY back, though they are not counted ready", () => {
    // The strip still reads OFFLINE for them (the API keeps them through its
    // grace); the host is not made to wait out a closed tab.
    const party = seen(partyOf("me", [member("me", "Noodle"), member("a2", "Floppo", { place: "lobby", online: false })]));
    expect(playKicker(party, "3 244")).toBe("PLAY AS A PARTY · 1 BEAN READY");
  });

  it("a member's counts who is ready, the host's call being made on PlaySelect", () => {
    const party = seen(partyOf("a2", [member("a2", "Floppo", { place: "match" }), member("me", "Noodle")]));
    expect(playKicker(party, "3 244")).toBe("PLAY AS A PARTY · 1 BEAN READY");
  });

  it("the hero's caption names the Party's size", () => {
    expect(heroCaption(seen(null))).toBe("IDLE + YOUR EMOTE");
    expect(heroCaption(seen(partyOf("me", [member("me", "Noodle"), member("a2", "Floppo"), member("a3", "Goopy")])))).toBe(
      "PARTY OF THREE, IDLE + YOUR EMOTE",
    );
  });

  it("the joined flash names the host", () => {
    expect(joinedPartyMessage(partyOf("a2", [member("a2", "Floppo"), member("me", "Noodle")]))).toBe("You joined Floppo's party.");
  });
});

describe("the INVITE FRIENDS card's rows (ADR 0112)", () => {
  const party = seen(partyOf("me", [member("me", "Noodle"), member("a4", "Tumbles")]));

  it("words each state as the mock does", () => {
    const { rows } = inviteTabs(
      [
        candidate("b1", "Bonk"),
        candidate("b2", "Wiggly", { state: "invited", inviteId: "inv-9", inviteSentAt: NOW - 12_000 }),
        candidate("b3", "Splat", { inMatch: true, place: "match" }),
        candidate("b6", "Goopy", { place: "menu" }),
        candidate("b7", "Floppo", { place: "lobby" }),
        candidate("b4", "Mrbeano", { state: "busy", online: false, lastSeenAt: NOW - 2 * 86_400_000 }),
        candidate("b5", "Blorp", { state: "busy", otherPartySize: 3 }),
        candidate("a4", "Tumbles", { state: "busy" }),
      ],
      8,
      party,
      NOW,
    );
    const byName = new Map(rows.ALL.map((row) => [row.name, row] as const));

    // Online with no place reported claims nothing more; a reported one says where.
    expect(byName.get("Bonk")).toMatchObject({ status: "ONLINE", state: "free" });
    expect(byName.get("Goopy")).toMatchObject({ status: "ONLINE · IN MENU", state: "free", inMatch: false });
    expect(byName.get("Floppo")).toMatchObject({ status: "IN A LOBBY", state: "free", inMatch: false });
    expect(byName.get("Wiggly")).toMatchObject({ status: "INVITED · WAITING 0:12", state: "invited", inviteId: "inv-9" });
    expect(byName.get("Splat")).toMatchObject({ status: "IN A MATCH · CAN STILL JOIN", state: "free", inMatch: true });
    expect(byName.get("Mrbeano")).toMatchObject({ status: "OFFLINE · 2 DAYS AGO", state: "busy", offline: true });
    expect(byName.get("Blorp")).toMatchObject({ status: "IN ANOTHER PARTY · 3/4", state: "busy" });
    expect(byName.get("Tumbles")).toMatchObject({ status: "ALREADY IN YOUR PARTY", state: "busy" });
  });

  it("ONLINE is friends online, RECENT is by last Match newest first, ALL counts every friend", () => {
    const { rows, counts } = inviteTabs(
      [
        candidate("b1", "Bonk", { lastPlayedAt: 100 }),
        candidate("b2", "Offy", { online: false, state: "busy" }),
        candidate("r1", "Stranger", { friend: false, lastPlayedAt: 300 }),
      ],
      48,
      party,
      NOW,
    );

    expect(rows.ONLINE.map((row) => row.name)).toEqual(["Bonk"]);
    expect(rows.RECENT.map((row) => row.name)).toEqual(["Stranger", "Bonk"]);
    expect(rows.ALL.map((row) => row.name)).toEqual(["Bonk", "Offy"]);
    expect(counts).toEqual({ ONLINE: 1, RECENT: 2, ALL: 48 });
  });

  it("the search filters by name, ignoring case", () => {
    const { rows } = inviteTabs([candidate("b1", "Bonk"), candidate("b2", "Wiggly")], 2, party, NOW);
    expect(matchingRows(rows.ALL, " wig ").map((row) => row.name)).toEqual(["Wiggly"]);
    expect(matchingRows(rows.ALL, "")).toHaveLength(2);
  });

  it("a six-character search is also a code to look up", () => {
    expect(codeInQuery(" 4k7nqx ")).toBe("4K7NQX");
    expect(codeInQuery("4K7NQ")).toBeNull();
    expect(codeInQuery("BONK!!")).toBeNull();
  });

  it("a Party found by its code shows its host and its size, full or not", () => {
    const lookup = {
      kind: "party" as const,
      partyId: "p9",
      hostAccountId: "h1",
      hostDisplayName: "Wiggly",
      hostColor: 4,
      hostAvatarUploadedAt: null,
      size: 2,
    };
    expect(foundRow(lookup, "ZZTOP9", [], party, NOW)).toMatchObject({
      kind: "party",
      code: "ZZTOP9",
      name: "Wiggly",
      status: "WIGGLY'S PARTY · 2/4",
      full: false,
    });
    expect(foundRow({ ...lookup, size: 4 }, "ZZTOP9", [], party, NOW)).toMatchObject({ full: true });
  });

  it("a bean found by friend code is its listed row when the card has one, else invited by the code", () => {
    const lookup = { kind: "account" as const, accountId: "b1", displayName: "Bonk", color: 2, avatarUploadedAt: null, state: "free" as const };

    const listed = foundRow(lookup, "BONK42", [candidate("b1", "Bonk", { inMatch: true })], party, NOW);
    expect(listed).toMatchObject({ kind: "bean", row: { status: "IN A MATCH · CAN STILL JOIN" } });
    expect(listed.kind === "bean" && listed.row.friendCode).toBeUndefined();

    expect(foundRow(lookup, "BONK42", [], party, NOW)).toMatchObject({
      kind: "bean",
      row: { accountId: "b1", status: "FRIEND CODE BONK42", state: "free", friendCode: "BONK42" },
    });
  });
});
