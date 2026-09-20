import { describe, expect, it } from "vitest";
import {
  PARTY_CODE_TTL_MS,
  PARTY_INVITE_TTL_MS,
  PARTY_OFFLINE_GRACE_MS,
  type AccountServerMessage,
  type PartyView,
} from "@dont-fall/shared";
import { ServiceError } from "../http/errors.js";
import { PartiesService, type PartiesDeps, type PartyLook, type PartyTimers } from "./parties.service.js";

/** A clock whose timers fire only when the test advances it — every expiry and grace here is exact. */
const fakeClock = (start = 1_000_000) => {
  let now = start;
  let nextHandle = 0;
  const due = new Map<number, { at: number; fn: () => void }>();
  const timers: PartyTimers = {
    setTimeout: (fn, ms) => {
      const handle = ++nextHandle;
      due.set(handle, { at: now + ms, fn });
      return handle;
    },
    clearTimeout: (handle) => void due.delete(handle as number),
  };
  return {
    now: () => now,
    timers,
    advance(ms: number): void {
      const end = now + ms;
      for (;;) {
        let next: [number, { at: number; fn: () => void }] | undefined;
        for (const entry of due) if (entry[1].at <= end && (next === undefined || entry[1].at < next[1].at)) next = entry;
        if (next === undefined) break;
        due.delete(next[0]);
        now = next[1].at;
        next[1].fn();
      }
      now = end;
    },
  };
};

const look = (displayName: string): PartyLook => ({ displayName, color: 3, skin: null, hat: "crown", avatarUploadedAt: null, xp: 120 });
const LOOKS = new Map(["amy", "bo", "cy", "di", "ed", "fay"].map((id) => [id, look(id[0]!.toUpperCase() + id.slice(1))]));

const setup = (deps: Partial<Pick<PartiesDeps, "mayInvite" | "reserveSeats">> = {}) => {
  const clock = fakeClock();
  const pushes: { to: string; message: AccountServerMessage }[] = [];
  let codes = 0;
  const parties = new PartiesService({
    looks: (ids) => new Map(ids.flatMap((id) => (LOOKS.has(id) ? [[id, LOOKS.get(id)!] as const] : []))),
    mayInvite: deps.mayInvite ?? (() => true),
    push: (to, message) => pushes.push({ to, message }),
    now: clock.now,
    timers: clock.timers,
    randomCode: () => `CODE${++codes}`.padEnd(6, "X"),
    ...(deps.reserveSeats ? { reserveSeats: deps.reserveSeats } : {}),
  });
  const sent = <T extends AccountServerMessage["type"]>(to: string, type: T) =>
    pushes.filter((push) => push.to === to && push.message.type === type).map((push) => push.message as Extract<AccountServerMessage, { type: T }>);
  /** The last Party pushed to `to` — what its strip shows now. */
  const partyOf = (to: string): PartyView => {
    const party = sent(to, "party").at(-1)?.party;
    if (!party) throw new Error(`no party pushed to ${to}`);
    return party;
  };
  /** `host` invites each of `members` and each accepts, in order. */
  const together = async (host: string, ...members: string[]): Promise<void> => {
    for (const id of [host, ...members]) if (!parties.isOnline(id)) parties.connected(id);
    for (const member of members) {
      const { inviteId } = parties.invite(host, member, { gated: true });
      await parties.acceptInvite(member, inviteId);
    }
  };
  return { clock, parties, pushes, sent, partyOf, together };
};

/** The status a call refused with — `undefined` when it went through. */
const statusOf = async (fn: () => unknown): Promise<number | undefined> => {
  try {
    await fn();
    return undefined;
  } catch (err) {
    if (err instanceof ServiceError) return err.statusCode;
    throw err;
  }
};

describe("PartiesService (ADR 0112)", () => {
  it("makes everyone signed in the host of a party of one, with a Party code", () => {
    const { parties, partyOf, clock } = setup();
    parties.connected("amy");

    expect(partyOf("amy")).toEqual({
      id: expect.any(String),
      hostAccountId: "amy",
      members: [
        {
          accountId: "amy",
          displayName: "Amy",
          color: 3,
          skin: null,
          hat: "crown",
          avatarUploadedAt: null,
          xp: 120,
          joinedAt: clock.now(),
          place: "menu",
          online: true,
        },
      ],
      pending: [],
      code: "CODE1X",
      codeExpiresAt: clock.now() + PARTY_CODE_TTL_MS,
      lobby: null,
    });
    expect(parties.partyOf("amy")).toBe(partyOf("amy").id);
  });

  it("hands an invite to the invitee at once, and the pending invite takes a slot", () => {
    const { parties, sent, partyOf, clock } = setup();
    parties.connected("amy");
    parties.connected("bo");

    const { inviteId } = parties.invite("amy", "bo", { gated: true });

    expect(sent("bo", "partyInvite")).toEqual([
      {
        type: "partyInvite",
        invite: {
          id: inviteId,
          partyId: partyOf("amy").id,
          fromAccountId: "amy",
          fromDisplayName: "Amy",
          fromColor: 3,
          fromAvatarUploadedAt: null,
          partySize: 1,
          sentAt: clock.now(),
        },
      },
    ]);
    expect(partyOf("amy").pending).toEqual([
      { inviteId, accountId: "bo", displayName: "Bo", color: 3, avatarUploadedAt: null, sentAt: clock.now() },
    ]);
  });

  it("lets only the host invite, only friends and recent players by id, and refuses the full, the busy and the offline", async () => {
    const { parties, together } = setup({ mayInvite: (_from, to) => to !== "fay" });
    await together("amy", "bo");
    await together("di", "ed");
    parties.connected("cy");
    parties.connected("fay");

    expect(await statusOf(() => parties.invite("bo", "cy", { gated: true }))).toBe(403);
    expect(await statusOf(() => parties.invite("amy", "fay", { gated: true }))).toBe(403);
    expect(await statusOf(() => parties.invite("amy", "nobody", { gated: true }))).toBe(404);
    expect(await statusOf(() => parties.invite("amy", "bo", { gated: true }))).toBe(409);
    expect(await statusOf(() => parties.invite("amy", "di", { gated: true }))).toBe(409);

    // By friend code the friend-or-recent rule is waived: holding the code is the capability.
    parties.invite("amy", "fay", { gated: false });
    expect(await statusOf(() => parties.invite("amy", "fay", { gated: false }))).toBe(409);
    parties.invite("amy", "cy", { gated: true });
    // Two seated and two pending: four slots taken, so a fifth bean is refused.
    parties.disconnected("fay");
    expect(await statusOf(() => parties.invite("amy", "ed", { gated: true }))).toBe(409);
  });

  it("refuses to invite a bean whose game is closed", async () => {
    const { parties } = setup();
    parties.connected("amy");
    parties.connected("bo");
    parties.disconnected("bo");

    expect(await statusOf(() => parties.invite("amy", "bo", { gated: true }))).toBe(409);
  });

  it("joins the Party at once on accept, leaving your own and taking back the invites you sent", async () => {
    const { parties, sent, partyOf } = setup();
    for (const id of ["amy", "bo", "cy"]) parties.connected(id);
    const boToCy = parties.invite("bo", "cy", { gated: true });
    const amyToBo = parties.invite("amy", "bo", { gated: true });

    const view = await parties.acceptInvite("bo", amyToBo.inviteId);

    expect(view.members.map((member) => member.accountId)).toEqual(["amy", "bo"]);
    expect(view.hostAccountId).toBe("amy");
    expect(view.pending).toEqual([]);
    expect(partyOf("amy")).toMatchObject({ members: [{ accountId: "amy" }, { accountId: "bo" }] });
    expect(sent("cy", "partyInviteGone")).toEqual([{ type: "partyInviteGone", inviteId: boToCy.inviteId }]);
    expect(await statusOf(() => parties.acceptInvite("cy", boToCy.inviteId))).toBe(404);
  });

  it("takes a declined, cancelled or expired invite out of the strip at once, and tells the invitee", async () => {
    const { parties, sent, partyOf, clock } = setup();
    for (const id of ["amy", "bo", "cy", "di"]) parties.connected(id);
    const toBo = parties.invite("amy", "bo", { gated: true });
    const toCy = parties.invite("amy", "cy", { gated: true });
    clock.advance(1_000);
    const toDi = parties.invite("amy", "di", { gated: true });

    parties.declineInvite("bo", toBo.inviteId);
    expect(sent("bo", "partyInviteGone")).toEqual([{ type: "partyInviteGone", inviteId: toBo.inviteId }]);
    expect(partyOf("amy").pending.map((pending) => pending.accountId)).toEqual(["cy", "di"]);

    expect(await statusOf(() => parties.cancelInvite("cy", toCy.inviteId))).toBe(404);
    parties.cancelInvite("amy", toCy.inviteId);
    expect(sent("cy", "partyInviteGone")).toEqual([{ type: "partyInviteGone", inviteId: toCy.inviteId }]);
    expect(partyOf("amy").pending.map((pending) => pending.accountId)).toEqual(["di"]);

    clock.advance(PARTY_INVITE_TTL_MS - 1);
    expect(sent("di", "partyInviteGone")).toEqual([]);
    clock.advance(1);
    expect(sent("di", "partyInviteGone")).toEqual([{ type: "partyInviteGone", inviteId: toDi.inviteId }]);
    expect(partyOf("amy").pending).toEqual([]);
  });

  it("makes the earliest to have joined the host, and hands the lead on when it leaves", async () => {
    const { parties, partyOf, together } = setup();
    await together("amy", "bo", "cy");

    expect(parties.leave("amy")).toBe("Amy");

    expect(partyOf("bo").hostAccountId).toBe("bo");
    expect(partyOf("bo").members.map((member) => member.accountId)).toEqual(["bo", "cy"]);
    expect(partyOf("amy")).toMatchObject({ hostAccountId: "amy", members: [{ accountId: "amy" }] });
    // Alone, there is nothing to leave.
    expect(parties.leave("amy")).toBeNull();
  });

  it("keeps a member whose game closed for the grace, then drops it and hands the lead on", async () => {
    const { parties, partyOf, together, clock } = setup();
    await together("amy", "bo", "cy");

    parties.disconnected("amy");
    expect(partyOf("bo").members[0]).toMatchObject({ accountId: "amy", online: false });

    // A reload inside the grace costs nothing.
    clock.advance(PARTY_OFFLINE_GRACE_MS - 1);
    parties.connected("amy");
    clock.advance(PARTY_OFFLINE_GRACE_MS);
    expect(partyOf("bo").members.map((member) => member.accountId)).toEqual(["amy", "bo", "cy"]);

    parties.disconnected("amy");
    clock.advance(PARTY_OFFLINE_GRACE_MS - 1);
    expect(partyOf("bo").hostAccountId).toBe("amy");
    clock.advance(1);
    expect(partyOf("bo")).toMatchObject({ hostAccountId: "bo", members: [{ accountId: "bo" }, { accountId: "cy" }] });
    expect(parties.partyOf("amy")).toBeNull();
  });

  it("shows the Party code to the host alone, only while there is room, and a new one after ten minutes", async () => {
    const { parties, partyOf, together, clock } = setup();
    await together("amy", "bo");

    expect(partyOf("amy").code).toBe("CODE1X");
    expect(partyOf("bo")).toMatchObject({ code: null, codeExpiresAt: null });

    parties.connected("cy");
    parties.connected("di");
    parties.invite("amy", "cy", { gated: true });
    const toDi = parties.invite("amy", "di", { gated: true });
    expect(partyOf("amy")).toMatchObject({ code: null, codeExpiresAt: null });
    parties.cancelInvite("amy", toDi.inviteId);
    expect(partyOf("amy").code).toBe("CODE1X");

    clock.advance(PARTY_CODE_TTL_MS);
    const rotated = partyOf("amy");
    expect(rotated.code).not.toBe("CODE1X");
    expect(rotated.codeExpiresAt).toBe(clock.now() + PARTY_CODE_TTL_MS);
    parties.connected("ed");
    expect(await statusOf(() => parties.joinByCode("ed", "CODE1X"))).toBe(404);
    expect(parties.byCode(rotated.code!)).toMatchObject({ hostAccountId: "amy", size: 2 });
  });

  it("lets anyone with the code join — never your own, never a full Party", async () => {
    const { parties, partyOf, together } = setup();
    await together("amy", "bo");
    for (const id of ["cy", "di", "ed"]) parties.connected(id);
    const code = partyOf("amy").code!;

    expect(await statusOf(() => parties.joinByCode("bo", code))).toBe(400);
    expect(await statusOf(() => parties.joinByCode("cy", "NOPE99"))).toBe(404);

    const view = await parties.joinByCode("cy", code.toLowerCase());
    expect(view.members.map((member) => member.accountId)).toEqual(["amy", "bo", "cy"]);

    // An invited bean holds its own slot, so it still gets in by code with the Party otherwise full.
    const toDi = parties.invite("amy", "di", { gated: true });
    expect(await statusOf(() => parties.joinByCode("ed", code))).toBe(409);
    await parties.joinByCode("di", code);
    expect(partyOf("amy")).toMatchObject({ pending: [], members: [{}, {}, {}, { accountId: "di" }] });
    expect(parties.byCode(code)).toMatchObject({ size: 4 });
    expect(await statusOf(() => parties.acceptInvite("di", toDi.inviteId))).toBe(404);
  });

  it("follows the host: every member granted a seat is told where, with its own Reservation", async () => {
    const { parties, sent, partyOf, together } = setup();
    await together("amy", "bo", "cy");

    parties.enteredLobby("amy", { id: "lobby-1", port: 51001 }, { amy: "r-amy", bo: "r-bo", cy: "r-cy" });

    expect(sent("bo", "follow")).toEqual([
      { type: "follow", lobby: { id: "lobby-1", port: 51001 }, reservation: "r-bo", hostDisplayName: "Amy" },
    ]);
    expect(sent("cy", "follow")).toEqual([
      { type: "follow", lobby: { id: "lobby-1", port: 51001 }, reservation: "r-cy", hostDisplayName: "Amy" },
    ]);
    expect(sent("amy", "follow")).toEqual([]);
    expect(partyOf("bo").lobby).toEqual({ id: "lobby-1", port: 51001 });
    // Only the host takes the Party anywhere.
    parties.enteredLobby("bo", { id: "lobby-2", port: 51002 }, { bo: "r", amy: "r" });
    expect(partyOf("bo").lobby).toEqual({ id: "lobby-1", port: 51001 });
  });

  it("sends back every member in the Party's Lobby, or on the way in, when the host walks out before the Match", async () => {
    const { parties, sent, partyOf, together } = setup();
    await together("amy", "bo", "cy", "di");
    parties.enteredLobby("amy", { id: "lobby-1", port: 51001 }, { amy: "r1", bo: "r2", cy: "r3" });
    parties.setPlace("amy", "lobby", 51001);
    parties.setPlace("bo", "lobby", 51001);
    // cy has its follow but is not there yet; di was left out (still in a Match of its own).
    parties.setPlace("di", "match");

    expect(partyOf("cy").members.map((member) => member.place)).toEqual(["lobby", "lobby", "menu", "match"]);

    parties.setPlace("amy", "menu");

    expect(sent("bo", "left")).toEqual([{ type: "left", hostDisplayName: "Amy" }]);
    expect(sent("cy", "left")).toEqual([{ type: "left", hostDisplayName: "Amy" }]);
    expect(sent("di", "left")).toEqual([]);
    expect(partyOf("bo").lobby).toBeNull();
  });

  it("reads a second tab's first place as a baseline, not the host walking out of the Party's Lobby", async () => {
    const { parties, sent, partyOf, together } = setup();
    await together("amy", "bo");
    parties.enteredLobby("amy", { id: "lobby-1", port: 51001 }, { amy: "r1", bo: "r2" });
    parties.setPlace("amy", "lobby", 51001);
    parties.setPlace("bo", "lobby", 51001);

    // Amy signs in on a second tab: it takes the Account socket over while the
    // first tab sits in the Lobby, its Lobby socket untouched. The new tab is
    // in the menus, which is where it is — not somewhere Amy went.
    parties.connected("amy");
    parties.setPlace("amy", "menu");

    expect(sent("bo", "left")).toEqual([]);
    expect(partyOf("bo").lobby).toEqual({ id: "lobby-1", port: 51001 });

    // Only the first report is a baseline; the next is an ordinary move again.
    parties.setPlace("amy", "lobby", 51001);
    parties.setPlace("amy", "menu");
    expect(sent("bo", "left")).toEqual([{ type: "left", hostDisplayName: "Amy" }]);
  });

  it("does nothing at all for a place report that says what it already knew", async () => {
    const { parties, sent, together } = setup();
    await together("amy", "bo");
    parties.setPlace("bo", "lobby", 51001);
    const pushed = sent("amy", "party").length;

    parties.setPlace("bo", "lobby", 51001);
    parties.setPlace("bo", "lobby", 51001);
    expect(sent("amy", "party")).toHaveLength(pushed);

    parties.setPlace("bo", "menu");
    expect(sent("amy", "party")).toHaveLength(pushed + 1);
  });

  it("takes a lone host's invites back when it leaves its party of one, and is otherwise a no-op", async () => {
    const { parties, sent, partyOf } = setup();
    parties.connected("amy");
    parties.connected("bo");
    const quiet = sent("amy", "party").length;

    // Nothing pending: there is no Party to leave.
    expect(parties.leave("amy")).toBeNull();
    expect(sent("amy", "party")).toHaveLength(quiet);

    const { inviteId } = parties.invite("amy", "bo", { gated: true });
    expect(parties.leave("amy")).toBeNull();

    expect(sent("bo", "partyInviteGone")).toEqual([{ type: "partyInviteGone", inviteId }]);
    expect(partyOf("amy").pending).toEqual([]);
    expect(await statusOf(() => parties.acceptInvite("bo", inviteId))).toBe(404);
  });

  it("keeps a member who steps out of the Party's Lobby, and sends nobody back once the Match started", async () => {
    const { parties, sent, partyOf, together } = setup();
    await together("amy", "bo");
    parties.enteredLobby("amy", { id: "lobby-1", port: 51001 }, { amy: "r1", bo: "r2" });
    parties.setPlace("amy", "lobby", 51001);
    parties.setPlace("bo", "lobby", 51001);

    parties.setPlace("bo", "menu");
    expect(partyOf("amy").members.map((member) => member.accountId)).toEqual(["amy", "bo"]);

    parties.setPlace("bo", "lobby", 51001);
    parties.setPlace("amy", "match");
    expect(partyOf("bo").lobby).toBeNull();
    parties.setPlace("amy", "menu");
    expect(sent("bo", "left")).toEqual([]);
  });

  it("tells a removed bean who removed it, and gives it a party of its own", async () => {
    const { parties, sent, partyOf, together } = setup();
    await together("amy", "bo", "cy");

    expect(await statusOf(() => parties.remove("bo", "cy"))).toBe(403);
    expect(await statusOf(() => parties.remove("amy", "di"))).toBe(404);
    parties.remove("amy", "bo");

    expect(sent("bo", "removed")).toEqual([{ type: "removed", byDisplayName: "Amy" }]);
    expect(partyOf("bo")).toMatchObject({ hostAccountId: "bo", members: [{ accountId: "bo" }] });
    expect(partyOf("amy").members.map((member) => member.accountId)).toEqual(["amy", "cy"]);
  });

  it("lets a bean accepted while the Party sits in a Lobby with its host follow it in, when the Lobby has room", async () => {
    const asked: { port: number; accountIds: readonly string[] }[] = [];
    let grant = true;
    const { parties, sent, together } = setup({
      reserveSeats: async (port, accountIds) => {
        asked.push({ port, accountIds });
        return grant ? Object.fromEntries(accountIds.map((id) => [id, `r-${id}`])) : null;
      },
    });
    await together("amy", "bo");
    parties.connected("cy");
    parties.connected("di");
    parties.enteredLobby("amy", { id: "lobby-1", port: 51001 }, { amy: "r1", bo: "r2" });

    // The host is not in the Lobby yet: nobody is sent after it.
    await parties.acceptInvite("cy", parties.invite("amy", "cy", { gated: true }).inviteId);
    expect(asked).toEqual([]);
    parties.leave("cy");

    parties.setPlace("amy", "lobby", 51001);
    await parties.acceptInvite("cy", parties.invite("amy", "cy", { gated: true }).inviteId);
    expect(asked).toEqual([{ port: 51001, accountIds: ["cy"] }]);
    expect(sent("cy", "follow")).toEqual([
      { type: "follow", lobby: { id: "lobby-1", port: 51001 }, reservation: "r-cy", hostDisplayName: "Amy" },
    ]);

    grant = false;
    const view = await parties.joinByCode("di", parties.view("amy")!.code!);
    expect(view.members.map((member) => member.accountId)).toEqual(["amy", "bo", "cy", "di"]);
    expect(sent("di", "follow")).toEqual([]);
  });

  it("answers which Party an Account is in, and says whose changed", async () => {
    const { parties, together } = setup();
    const changed: string[][] = [];
    const unsubscribe = parties.onChange((ids) => changed.push([...ids]));

    await together("amy", "bo");
    expect(parties.partyOf("bo")).toBe(parties.partyOf("amy"));
    expect(changed).toContainEqual(["bo"]);

    changed.length = 0;
    parties.leave("bo");
    expect(parties.partyOf("bo")).not.toBe(parties.partyOf("amy"));
    expect(changed.flat()).toEqual(["bo", "bo"]);

    unsubscribe();
    parties.leave("amy");
    await together("bo", "amy");
    expect(changed.flat()).toEqual(["bo", "bo"]);
    expect(parties.partyOf("nobody")).toBeNull();
  });

  it("tells a broker entry who is bringing whom, and where each member is", async () => {
    const { parties, together } = setup();
    await together("amy", "bo", "cy");
    parties.setPlace("cy", "match");
    parties.disconnected("bo");

    expect(parties.entryOf("amy")).toEqual({
      role: "host",
      members: [
        { accountId: "bo", displayName: "Bo", place: "menu", online: false },
        { accountId: "cy", displayName: "Cy", place: "match", online: true },
      ],
    });
    expect(parties.entryOf("cy")).toEqual({ role: "member", hostDisplayName: "Amy", partyLobbyId: null });
    expect(parties.entryOf("nobody")).toEqual({ role: "alone" });
  });
});
