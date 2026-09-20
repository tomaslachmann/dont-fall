import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountServerMessage } from "@dont-fall/shared";
import { ServiceError } from "../http/errors.js";
import { PartiesService, type PartyLook } from "../party/parties.service.js";
import { LobbiesService, type LobbyStatus, type Reservations, type StartMatchServerOptions } from "./lobbies.service.js";

/**
 * The broker's Party-aware entries (ADR 0112) against fakes: the same
 * scripted match-server seam as `lobbies.controller.test.ts`, a scripted
 * `reserveSeats` standing in for each Lobby's `POST /reservations`, and a
 * real `PartiesService` whose pushes are recorded.
 */
const fakeMatchServers = () => {
  let nextPort = 61000;
  const statuses = new Map<number, LobbyStatus>();
  /** Lobbies whose Match server refuses every Reservation. */
  const refusing = new Set<number>();
  const started: StartMatchServerOptions[] = [];
  const reservationCalls: { port: number; accountIds: readonly string[]; secret: string }[] = [];
  return {
    statuses,
    refusing,
    started,
    reservationCalls,
    startMatchServer: vi.fn(async (opts: StartMatchServerOptions) => {
      started.push(opts);
      const port = nextPort++;
      statuses.set(port, { playerCount: 0, maxPlayers: 4, phase: "LOBBY", accounts: [], round: null });
      return { port, close: async () => void statuses.delete(port) };
    }),
    fetchLobbyStatus: vi.fn(async (port: number) => statuses.get(port) ?? null),
    reserveSeats: vi.fn(async (port: number, accountIds: readonly string[], secret: string): Promise<Reservations | null> => {
      reservationCalls.push({ port, accountIds, secret });
      if (refusing.has(port)) return null;
      return Object.fromEntries(accountIds.map((id) => [id, `${port}-${id}`]));
    }),
  };
};

const look = (displayName: string): PartyLook => ({ displayName, color: 0, skin: null, hat: null, avatarUploadedAt: null, xp: 0 });
const LOOKS = new Map(["amy", "bo", "cy"].map((id) => [id, look(id[0]!.toUpperCase() + id.slice(1))]));

let fakes: ReturnType<typeof fakeMatchServers>;
let pushes: { to: string; message: AccountServerMessage }[];
let parties: PartiesService;
let lobbies: LobbiesService;

beforeEach(() => {
  fakes = fakeMatchServers();
  pushes = [];
  let codes = 0;
  parties = new PartiesService({
    looks: (ids) => new Map(ids.flatMap((id) => (LOOKS.has(id) ? [[id, LOOKS.get(id)!] as const] : []))),
    mayInvite: () => true,
    push: (to, message) => pushes.push({ to, message }),
    randomCode: () => `PARTY${++codes}`,
    reserveSeats: (port, accountIds) => lobbies.reserveSeats(port, accountIds),
  });
  lobbies = new LobbiesService({
    apiUrl: "http://localhost:8081",
    maxPlayers: 4,
    startMatchServer: fakes.startMatchServer,
    fetchLobbyStatus: fakes.fetchLobbyStatus,
    reserveSeats: fakes.reserveSeats,
    statusPollIntervalMs: 60_000,
    parties,
  });
});

afterEach(async () => {
  parties.close();
  await lobbies.close();
});

/** `host` and each of `members` online, in one Party. */
const party = async (host: string, ...members: string[]): Promise<void> => {
  for (const id of [host, ...members]) parties.connected(id);
  for (const member of members) await parties.acceptInvite(member, parties.invite(host, member, { gated: true }).inviteId);
};

const follows = (to: string) =>
  pushes.filter((push) => push.to === to && push.message.type === "follow").map((push) => push.message);

const refusal = async (entry: Promise<unknown>): Promise<{ status: number; message: string }> => {
  try {
    await entry;
  } catch (err) {
    if (err instanceof ServiceError) return { status: err.statusCode, message: err.message };
    throw err;
  }
  throw new Error("the entry was not refused");
};

describe("Party-aware Lobby entries (ADR 0112)", () => {
  it("hands every Match server this process's reservation secret, and asks with it", async () => {
    const grant = await lobbies.quickMatch("amy");

    expect(fakes.started[0]?.reservationSecret).toMatch(/^[0-9a-f]{64}$/);
    expect(fakes.reservationCalls).toEqual([
      { port: grant.port, accountIds: ["amy"], secret: fakes.started[0]!.reservationSecret },
    ]);
  });

  it("enters an anonymous caller as before, with no Reservation", async () => {
    const grant = await lobbies.quickMatch(null);

    expect(grant).toEqual({ id: expect.any(String), port: 61000 });
    expect(fakes.reserveSeats).not.toHaveBeenCalled();
  });

  it("reserves a solo signed-in caller's own seat, wherever it enters", async () => {
    parties.connected("amy");

    const created = await lobbies.create(true, {}, "amy");
    expect(created).toEqual({ id: expect.any(String), port: 61000, code: expect.any(String), isPrivate: true, reservation: "61000-amy" });

    const joined = await lobbies.join({ code: created.code! }, "amy");
    expect(joined).toEqual({ id: created.id, port: 61000, reservation: "61000-amy" });
  });

  it("seats the host's whole Party at once and sends every member after it, each with its own Reservation", async () => {
    await party("amy", "bo", "cy");

    const grant = await lobbies.quickMatch("amy");

    expect(fakes.reservationCalls.map((call) => call.accountIds)).toEqual([["amy", "bo", "cy"]]);
    expect(grant).toEqual({ id: expect.any(String), port: 61000, reservation: "61000-amy" });
    expect(follows("bo")).toEqual([
      { type: "follow", lobby: { id: grant.id, port: 61000 }, reservation: "61000-bo", hostDisplayName: "Amy" },
    ]);
    expect(follows("cy")).toEqual([
      { type: "follow", lobby: { id: grant.id, port: 61000 }, reservation: "61000-cy", hostDisplayName: "Amy" },
    ]);
    expect(parties.view("bo")?.lobby).toEqual({ id: grant.id, port: 61000 });
    // A public Lobby has no join code to carry.
    expect(follows("bo")[0]).not.toHaveProperty("lobby.code");
  });

  it("sends a private Lobby's join code with every follow — on the host's entry and to a bean accepted after it", async () => {
    await party("amy", "bo");

    const created = await lobbies.create(true, {}, "amy");
    const lobby = { id: created.id, port: created.port, code: created.code! };

    expect(follows("bo")).toEqual([{ type: "follow", lobby, reservation: `${created.port}-bo`, hostDisplayName: "Amy" }]);
    expect(parties.view("bo")?.lobby).toEqual(lobby);

    // Cy joins the Party while it sits there, and follows the host in by the same code.
    parties.setPlace("amy", "lobby", created.port);
    parties.connected("cy");
    await parties.acceptInvite("cy", parties.invite("amy", "cy", { gated: true }).inviteId);
    expect(follows("cy")).toEqual([{ type: "follow", lobby, reservation: `${created.port}-cy`, hostDisplayName: "Amy" }]);
  });

  it("makes the host wait for any member not back in the menus — nothing is spawned or reserved", async () => {
    await party("amy", "bo", "cy");
    parties.setPlace("cy", "match");

    expect(await refusal(lobbies.quickMatch("amy"))).toEqual({ status: 409, message: "waiting for Cy" });
    expect(await refusal(lobbies.create(false, {}, "amy"))).toEqual({ status: 409, message: "waiting for Cy" });
    expect(fakes.startMatchServer).not.toHaveBeenCalled();
    expect(fakes.reserveSeats).not.toHaveBeenCalled();
  });

  it("neither waits for nor seats a member whose game is closed", async () => {
    await party("amy", "bo", "cy");
    parties.disconnected("cy");

    await lobbies.quickMatch("amy");

    expect(fakes.reservationCalls.map((call) => call.accountIds)).toEqual([["amy", "bo"]]);
  });

  it("does not wait for a member who closed the game on a podium — its kept place is not a hold on PLAY", async () => {
    await party("amy", "bo", "cy");
    // Cy shut the game down in a Match. Its place is kept through the offline
    // grace on purpose, so a socket blip cannot read as leaving a Lobby —
    // but the strip shows it OFFLINE, and PLAY must not wait a minute and a
    // half for a bean nobody can send anywhere.
    parties.setPlace("cy", "match");
    parties.disconnected("cy");

    const grant = await lobbies.quickMatch("amy");

    expect(grant).toMatchObject({ reservation: "61000-amy" });
    expect(fakes.reservationCalls.map((call) => call.accountIds)).toEqual([["amy", "bo"]]);
  });

  it("refuses a Party bigger than a Lobby's seats before anything is spawned", async () => {
    await party("amy", "bo", "cy");
    const small = new LobbiesService({
      apiUrl: "http://localhost:8081",
      maxPlayers: 2,
      startMatchServer: fakes.startMatchServer,
      fetchLobbyStatus: fakes.fetchLobbyStatus,
      reserveSeats: fakes.reserveSeats,
      statusPollIntervalMs: 60_000,
      parties,
    });

    try {
      const refused = { status: 409, message: "your party of 3 is bigger than a Lobby's 2 seats" };
      expect(await refusal(small.quickMatch("amy"))).toEqual(refused);
      expect(await refusal(small.create(true, {}, "amy"))).toEqual(refused);
      expect(fakes.startMatchServer).not.toHaveBeenCalled();
      expect(fakes.reserveSeats).not.toHaveBeenCalled();
    } finally {
      await small.close();
    }
  });

  it("closes a Lobby it spawned itself when that Lobby then refuses the seats — no port is left held", async () => {
    await party("amy", "bo");
    fakes.reserveSeats.mockImplementation(async () => null);

    expect((await refusal(lobbies.quickMatch("amy"))).status).toBe(503);
    expect((await refusal(lobbies.create(true, {}, "amy"))).status).toBe(503);

    expect(await lobbies.listPublic()).toEqual([]);
    expect(fakes.statuses.size).toBe(0);
    expect(follows("bo")).toEqual([]);
  });

  it("refuses a Lobby that cannot seat the whole Party, and says so — the Party is never split", async () => {
    const created = await lobbies.create(true, {}, null);
    fakes.statuses.set(created.port, { playerCount: 2, maxPlayers: 4, phase: "LOBBY", accounts: [], round: null });
    await party("amy", "bo", "cy");

    expect(await refusal(lobbies.join({ code: created.code! }, "amy"))).toEqual({
      status: 409,
      message: "no room for your party of 3",
    });

    // Room by the last status, but the Match server itself refuses (a stranger took the seats first).
    fakes.statuses.set(created.port, { playerCount: 1, maxPlayers: 4, phase: "LOBBY", accounts: [], round: null });
    fakes.refusing.add(created.port);
    expect(await refusal(lobbies.join({ code: created.code! }, "amy"))).toEqual({
      status: 409,
      message: "no room for your party of 3",
    });
    expect(follows("bo")).toEqual([]);
    expect(parties.view("amy")?.lobby).toBeNull();
  });

  it("takes a member who enters alone out of its Party first, and says whose it left", async () => {
    await party("amy", "bo", "cy");

    const grant = await lobbies.quickMatch("bo");

    expect(grant).toEqual({ id: expect.any(String), port: 61000, reservation: "61000-bo", leftPartyOf: "Amy" });
    expect(fakes.reservationCalls.map((call) => call.accountIds)).toEqual([["bo"]]);
    expect(parties.view("amy")?.members.map((member) => member.accountId)).toEqual(["amy", "cy"]);
    expect(parties.view("bo")).toMatchObject({ hostAccountId: "bo", members: [{ accountId: "bo" }], lobby: { port: 61000 } });
    expect(follows("amy")).toEqual([]);
  });

  it("keeps a member who walks back into its Party's own Lobby in the Party — only a different Lobby leaves it", async () => {
    await party("amy", "bo");
    const partyLobby = await lobbies.quickMatch("amy");
    parties.setPlace("amy", "lobby", partyLobby.port);
    // Bo stepped out of the Party's Lobby, back to the menu, and takes a friend's JOIN back in.
    parties.setPlace("bo", "menu");

    const back = await lobbies.join({ lobbyId: partyLobby.id }, "bo");

    expect(back).toEqual({ id: partyLobby.id, port: partyLobby.port, reservation: `${partyLobby.port}-bo` });
    expect(parties.view("amy")?.members.map((member) => member.accountId)).toEqual(["amy", "bo"]);
    expect(parties.view("amy")?.lobby).toEqual({ id: partyLobby.id, port: partyLobby.port });

    // Any other Lobby is still somewhere alone.
    const elsewhere = await lobbies.create(false, {}, null);
    expect((await lobbies.join({ lobbyId: elsewhere.id }, "bo")).leftPartyOf).toBe("Amy");
    expect(parties.view("amy")?.members.map((member) => member.accountId)).toEqual(["amy"]);
  });

  it("keeps a member in its Party when the Lobby it tried refuses it", async () => {
    const created = await lobbies.create(true, {}, null);
    fakes.refusing.add(created.port);
    await party("amy", "bo");

    expect((await refusal(lobbies.join({ code: created.code! }, "bo"))).status).toBe(409);
    expect(parties.view("amy")?.members.map((member) => member.accountId)).toEqual(["amy", "bo"]);
  });

  it("quick-matches into the first open Lobby that seats the Party, else a fresh one", async () => {
    const full = await lobbies.create(false, {}, null);
    const refusing = await lobbies.create(false, {}, null);
    const open = await lobbies.create(false, {}, null);
    fakes.statuses.set(full.port, { playerCount: 3, maxPlayers: 4, phase: "LOBBY", accounts: [], round: null });
    fakes.refusing.add(refusing.port);
    await party("amy", "bo");

    const first = await lobbies.quickMatch("amy");
    expect(first.id).toBe(open.id);
    expect(fakes.reservationCalls.map((call) => call.port)).toEqual([refusing.port, open.port]);

    // Every open one refuses now: a fresh Lobby is started and seats the Party.
    fakes.refusing.add(open.port);
    const fresh = await lobbies.quickMatch("amy");
    expect([full.id, refusing.id, open.id]).not.toContain(fresh.id);
    expect(fresh.reservation).toBe(`${fresh.port}-amy`);
    expect(follows("bo").at(-1)).toMatchObject({ lobby: { id: fresh.id, port: fresh.port }, reservation: `${fresh.port}-bo` });
  });

  it("joins a public Lobby by id and a private one only by code", async () => {
    const pub = await lobbies.create(false, {}, null);
    const priv = await lobbies.create(true, {}, null);
    parties.connected("amy");

    expect(await lobbies.join({ lobbyId: pub.id }, "amy")).toEqual({ id: pub.id, port: pub.port, reservation: `${pub.port}-amy` });
    expect((await refusal(lobbies.join({ lobbyId: priv.id }, "amy"))).status).toBe(404);
    expect((await refusal(lobbies.join({}, "amy"))).status).toBe(400);
  });
});
