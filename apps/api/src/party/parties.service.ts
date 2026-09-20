import { randomUUID } from "node:crypto";
import {
  PARTY_CODE_TTL_MS,
  PARTY_INVITE_TTL_MS,
  PARTY_MAX_SIZE,
  PARTY_OFFLINE_GRACE_MS,
  type AccountServerMessage,
  type PartyCandidateState,
  type PartyInviteView,
  type PartyLobbyView,
  type PartyPlace,
  type PartyView,
} from "@dont-fall/shared";
import { ServiceError } from "../http/errors.js";
import type { PartyEntry, PartyEntrySource } from "../lobbies/lobbies.service.js";

/** What a member's bean looks like — the display half of its Account row. */
export interface PartyLook {
  displayName: string;
  color: number;
  skin: string | null;
  hat: string | null;
  avatarUploadedAt: number | null;
  xp: number;
}

/** The two timer calls the service makes — real by default, a fake clock's in tests. */
export interface PartyTimers {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface PartiesDeps {
  /** Every requested Account's look, keyed by id — unknown ids are simply absent. The accounts table in production. */
  looks: (accountIds: readonly string[]) => ReadonlyMap<string, PartyLook>;
  /** Whether `from` may invite `to` by id: a friend or a recent player (ADR 0112). */
  mayInvite: (fromAccountId: string, toAccountId: string) => boolean;
  /** Tells one Account something over its Account socket — dropped when none is open. */
  push: (accountId: string, message: AccountServerMessage) => void;
  /**
   * Asks a Lobby's Match server for Reservations, all or none — what lets a
   * bean accepted while its Party sits in a Lobby follow its host in. The
   * broker's own seam (`LobbiesService.reserveSeats`); absent, nobody follows.
   */
  reserveSeats?: (port: number, accountIds: readonly string[]) => Promise<Readonly<Record<string, string>> | null>;
  now?: () => number;
  timers?: PartyTimers;
  /** A fresh Party code — six characters of the friend code's alphabet in production. */
  randomCode: () => string;
}

interface Member {
  accountId: string;
  joinedAt: number;
  /** Ties on `joinedAt` break by who got here first, as a Lobby's `joinOrder` does. */
  joinOrder: number;
  /**
   * The Lobby a `follow` sent this bean to, until it reports being anywhere
   * but the menu — so a host who walks out catches the beans still on their
   * way in, not only the ones already seated.
   */
  followingPort: number | null;
}

interface Invite {
  id: string;
  partyId: string;
  fromAccountId: string;
  toAccountId: string;
  sentAt: number;
  expiry: unknown;
}

interface Party {
  id: string;
  /** In join order — the first is the host. */
  members: Map<string, Member>;
  /** Pending invites by id — each takes a slot until it is answered. */
  pending: Map<string, Invite>;
  code: string;
  codeExpiresAt: number;
  codeRotation: unknown;
  /** Set when the host enters a Lobby; cleared when its Match starts or the host walks out. Its `code` is a private Lobby's, for every `follow`. */
  lobby: PartyLobbyView | null;
}

interface Whereabouts {
  place: PartyPlace;
  lobbyPort: number | null;
}

const UNKNOWN_LOOK: PartyLook = {
  displayName: "Unknown player",
  color: 0,
  skin: null,
  hat: null,
  avatarUploadedAt: null,
  xp: 0,
};

const realTimers: PartyTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

/**
 * Parties (ADR 0112) — in memory, never in SQLite, because everything a
 * Party coordinates (Lobbies, voice rooms) is in memory too and dies with
 * the process.
 *
 * Everyone signed in has a Party: an Account socket opening makes a party of
 * one, and leaving any Party lands you back in one. The host is the
 * earliest-joined member (`resolveHostId`'s rule), so hand-over is nothing
 * but the next-earliest being first. A member whose socket stays closed for
 * `PARTY_OFFLINE_GRACE_MS` drops out.
 *
 * Framework-free like `LobbiesService`: constructed with its seams (looks,
 * push, clock, timers), driven by the routes and the Account socket. Every
 * change pushes the Party to each member as that member sees it — the code
 * is the host's alone.
 */
export class PartiesService implements PartyEntrySource {
  private readonly parties = new Map<string, Party>();
  private readonly partyIdByAccount = new Map<string, string>();
  private readonly partyIdByCode = new Map<string, string>();
  private readonly invites = new Map<string, Invite>();
  /** Accounts with an Account socket open right now. */
  private readonly online = new Set<string>();
  private readonly dropTimers = new Map<string, unknown>();
  /** Where each Account's client last said it was — the Account's, not the membership's, so it survives a change of Party. */
  private readonly whereabouts = new Map<string, Whereabouts>();
  /** Accounts whose next `place` report says where a fresh tab is rather than where this Account went — see `connected`. */
  private readonly placeBaselines = new Set<string>();
  private readonly listeners = new Set<(accountIds: readonly string[]) => void>();
  private readonly now: () => number;
  private readonly timers: PartyTimers;
  private nextJoinOrder = 0;
  private closed = false;

  constructor(private readonly deps: PartiesDeps) {
    this.now = deps.now ?? Date.now;
    this.timers = deps.timers ?? realTimers;
  }

  // --- The Account socket's lifecycle -------------------------------------

  /**
   * An Account socket opened (or took over from an older one). Cancels any
   * drop-out, makes a party of one if there is none, and pushes the Party
   * and every live Party invite this Account holds — what a fresh tab needs
   * before anything else.
   */
  connected(accountId: string): void {
    if (this.closed) return;
    // Already online means a second tab took the socket over (ADR 0112,
    // `ACCOUNT_SOCKET_REPLACED`): the older socket is closed without this
    // Account ever going offline, and nothing touched the Lobby socket the
    // older tab may still hold. The new tab's first `place` says where *it*
    // is, which is not a move this Account made — read as a transition, a
    // fresh tab's `menu` would fire the host-left rule and push every member
    // out of a Lobby their host is still sitting in.
    if (this.online.has(accountId)) this.placeBaselines.add(accountId);
    this.online.add(accountId);
    this.cancelDrop(accountId);
    const party = this.partyFor(accountId) ?? this.createParty(accountId);
    this.pushParty(party);
    for (const invite of this.invites.values()) {
      if (invite.toAccountId === accountId) this.deps.push(accountId, { type: "partyInvite", invite: this.inviteView(invite) });
    }
  }

  /**
   * The Account's socket closed. Its place is kept on purpose: the Account
   * socket can blip while the Lobby's socket stays up, so resetting it to
   * `menu` here would read as the host walking out of the Party's Lobby and
   * send every member out of a Lobby nobody left. What a kept place must
   * never do is hold the host up — only members who are online are waited
   * for (`LobbiesService.plan`). It drops out of its Party once it has
   * stayed closed for the grace.
   */
  disconnected(accountId: string): void {
    if (this.closed || !this.online.delete(accountId)) return;
    const party = this.partyFor(accountId);
    if (party) this.pushParty(party);
    this.scheduleDrop(accountId);
  }

  isOnline(accountId: string): boolean {
    return this.online.has(accountId);
  }

  /**
   * Where a client says it is (ADR 0112). The host walking out of the
   * Party's Lobby before its Match takes the Party out: every member still in
   * that Lobby (or on the way into it) is told `left`. The host reaching
   * `match` means the Match started — the Party no longer sits in a Lobby,
   * which is what makes "still set" mean "not started".
   *
   * A report that says what this service already knew is dropped here: every
   * other one costs a lookup of the members' looks and a Party push to each
   * of them, on the API's one main thread — which also runs every Match
   * server in-process.
   */
  setPlace(accountId: string, place: PartyPlace, lobbyPort?: number): void {
    const before = this.whereabouts.get(accountId) ?? { place: "menu", lobbyPort: null };
    const after: Whereabouts = { place, lobbyPort: place === "lobby" ? (lobbyPort ?? null) : null };
    // A fresh tab's first report is a baseline, never a transition (`connected`).
    const baseline = this.placeBaselines.delete(accountId);
    if (before.place === after.place && before.lobbyPort === after.lobbyPort) return;
    this.whereabouts.set(accountId, after);
    const party = this.partyFor(accountId);
    if (!party) return;
    const member = party.members.get(accountId);
    if (member && place !== "menu") member.followingPort = null;
    if (!baseline && this.hostOf(party).accountId === accountId && party.lobby) {
      if (place === "match") party.lobby = null;
      else if (inLobby(before, party.lobby.port) && !inLobby(after, party.lobby.port)) this.hostLeftLobby(party);
    }
    this.pushParty(party);
  }

  // --- What others read ----------------------------------------------------

  /** This Account's Party as it sees it — `null` when it has none (never connected, or dropped out). */
  view(accountId: string): PartyView | null {
    const party = this.partyFor(accountId);
    return party ? this.viewOf(party, accountId, this.looksOf(party)) : null;
  }

  /** The id of the Party this Account is in — what voice chat's PARTY scope reads (ADR 0111, ticket 17). */
  partyOf(accountId: string): string | null {
    return this.partyIdByAccount.get(accountId) ?? null;
  }

  /**
   * Called with the Account ids whose Party changed (joined, left, dropped
   * out) — so voice chat can re-read `partyOf` for them without polling.
   * Returns the unsubscribe.
   */
  onChange(listener: (accountIds: readonly string[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Where this Account's client last said it was — `null` for one this service does not know (no Party). */
  placeOf(accountId: string): PartyPlace | null {
    if (!this.partyIdByAccount.has(accountId)) return null;
    return this.whereabouts.get(accountId)?.place ?? "menu";
  }

  /** A live Party code's Party, for a pasted code's lookup — `null` for an unknown or expired one. */
  byCode(code: string): { partyId: string; hostAccountId: string; size: number } | null {
    const party = this.liveCodeParty(code);
    if (!party) return null;
    return { partyId: party.id, hostAccountId: this.hostOf(party).accountId, size: party.members.size };
  }

  /**
   * One bean as the INVITE FRIENDS card sees it from `viewerId`'s Party (ADR
   * 0112): already in it, busy; invited by it, invited; offline, busy; in
   * another Party of two or more, busy with that Party's size; else free.
   */
  candidateState(
    viewerId: string,
    targetId: string,
  ): { state: PartyCandidateState; inviteId: string | null; inviteSentAt: number | null; otherPartySize: number | null } {
    const mine = this.partyFor(viewerId);
    const theirs = this.partyFor(targetId);
    const otherPartySize = theirs && theirs !== mine && theirs.members.size >= 2 ? theirs.members.size : null;
    const none = { inviteId: null, inviteSentAt: null, otherPartySize };
    if (targetId === viewerId || mine?.members.has(targetId)) return { state: "busy", ...none };
    const pending = mine ? [...mine.pending.values()].find((invite) => invite.toAccountId === targetId) : undefined;
    if (pending) return { state: "invited", inviteId: pending.id, inviteSentAt: pending.sentAt, otherPartySize };
    if (!this.online.has(targetId) || otherPartySize !== null) return { state: "busy", ...none };
    return { state: "free", ...none };
  }

  // --- The routes ----------------------------------------------------------

  /**
   * The host invites a bean (ADR 0112). `gated` is the friend-or-recent-player
   * rule; an invite by friend code skips it, since holding a bean's code is
   * what the rule stands in for. The pending invite takes a slot at once.
   */
  invite(hostId: string, targetId: string, options: { gated: boolean }): { inviteId: string } {
    const party = this.ensureParty(hostId);
    if (this.hostOf(party).accountId !== hostId) throw new ServiceError(403, "only the host can invite beans");
    const target = this.deps.looks([targetId]).get(targetId);
    if (!target) throw new ServiceError(404, "no player with that id");
    if (party.members.has(targetId)) throw new ServiceError(409, `${target.displayName} is already in your party`);
    if (options.gated && !this.deps.mayInvite(hostId, targetId)) {
      throw new ServiceError(403, "you can invite friends and recent players");
    }
    if ([...party.pending.values()].some((invite) => invite.toAccountId === targetId)) {
      throw new ServiceError(409, `${target.displayName} is already invited`);
    }
    if (slotsTaken(party) >= PARTY_MAX_SIZE) throw new ServiceError(409, "your party is full");
    if (!this.online.has(targetId)) throw new ServiceError(409, `${target.displayName} is offline`);
    const theirs = this.partyFor(targetId);
    if (theirs && theirs.members.size >= 2) throw new ServiceError(409, `${target.displayName} is in another party`);

    const sentAt = this.now();
    const invite: Invite = { id: randomUUID(), partyId: party.id, fromAccountId: hostId, toAccountId: targetId, sentAt, expiry: null };
    invite.expiry = this.timers.setTimeout(() => this.dropInvite(invite.id), PARTY_INVITE_TTL_MS);
    party.pending.set(invite.id, invite);
    this.invites.set(invite.id, invite);
    this.deps.push(targetId, { type: "partyInvite", invite: this.inviteView(invite) });
    this.pushParty(party);
    return { inviteId: invite.id };
  }

  /** The host takes an invite back — its slot frees at once. */
  cancelInvite(hostId: string, inviteId: string): void {
    const party = this.partyFor(hostId);
    const invite = this.invites.get(inviteId);
    if (!party || !invite || invite.partyId !== party.id) throw new ServiceError(404, "no such invite");
    if (this.hostOf(party).accountId !== hostId) throw new ServiceError(403, "only the host can cancel an invite");
    this.dropInvite(inviteId);
  }

  declineInvite(accountId: string, inviteId: string): void {
    const invite = this.invites.get(inviteId);
    if (!invite || invite.toAccountId !== accountId) throw new ServiceError(404, "no such invite");
    this.dropInvite(inviteId);
  }

  /**
   * Accepting joins the Party at once (ADR 0112), leaving your own and
   * taking back the invites you sent. Answers the Party as you now see it —
   * after a `follow` into its Lobby has been tried, when it sits in one.
   */
  async acceptInvite(accountId: string, inviteId: string): Promise<PartyView> {
    const invite = this.invites.get(inviteId);
    const party = invite ? this.parties.get(invite.partyId) : undefined;
    if (!invite || invite.toAccountId !== accountId || !party) throw new ServiceError(404, "no such invite");
    this.dropInvite(inviteId, { pushParty: false });
    this.join(party, accountId);
    await this.followIntoLobby(party, accountId);
    return this.viewOf(party, accountId, this.looksOf(party));
  }

  /**
   * Anyone with the Party code joins (ADR 0112), for as long as it works. A
   * bean already invited takes its own pending slot, so a full Party still
   * admits it.
   */
  async joinByCode(accountId: string, code: string): Promise<PartyView> {
    const party = this.liveCodeParty(code);
    if (!party) throw new ServiceError(404, "no party with that code — it may have expired");
    if (party.members.has(accountId)) throw new ServiceError(400, "that is your own party's code");
    const ownInvite = [...party.pending.values()].find((invite) => invite.toAccountId === accountId);
    if (!ownInvite && slotsTaken(party) >= PARTY_MAX_SIZE) throw new ServiceError(409, "that party is full");
    if (ownInvite) this.dropInvite(ownInvite.id, { pushParty: false });
    this.join(party, accountId);
    await this.followIntoLobby(party, accountId);
    return this.viewOf(party, accountId, this.looksOf(party));
  }

  /**
   * Leaves the Party for a party of one. Alone with invites out, there is no
   * Party to leave but LEAVE PARTY still means something — the strip offers
   * it while a slot is pending — so the invites this bean sent are taken
   * back: none can be accepted into a Party its only member has left. Alone
   * with nothing pending it is a no-op.
   *
   * Returns the display name of the host left behind (a broker entry's
   * `leftPartyOf`), or `null` when there was no host to leave.
   */
  leave(accountId: string): string | null {
    const party = this.partyFor(accountId);
    if (!party) return null;
    if (party.members.size < 2) {
      const own = [...party.pending.values()].filter((invite) => invite.fromAccountId === accountId);
      if (own.length === 0) return null;
      for (const invite of own) this.dropInvite(invite.id, { pushParty: false });
      this.pushParty(party);
      return null;
    }
    const hostName = this.lookOf(this.hostOf(party).accountId).displayName;
    this.detach(party, accountId);
    if (this.online.has(accountId)) this.pushParty(this.createParty(accountId));
    return hostName;
  }

  /** The host removes a bean, at once and with no confirm (the design's ×). */
  remove(hostId: string, targetId: string): void {
    const party = this.partyFor(hostId);
    if (!party || this.hostOf(party).accountId !== hostId) throw new ServiceError(403, "only the host can remove beans");
    if (targetId === hostId) throw new ServiceError(400, "you cannot remove yourself — leave the party instead");
    if (!party.members.has(targetId)) throw new ServiceError(404, "not in your party");
    const byDisplayName = this.lookOf(hostId).displayName;
    this.detach(party, targetId);
    this.deps.push(targetId, { type: "removed", byDisplayName });
    if (this.online.has(targetId)) this.pushParty(this.createParty(targetId));
  }

  // --- Broker entries (PartyEntrySource) -----------------------------------

  /** How this Account enters a Lobby — alone, as a member (who leaves first), or as the host bringing the rest. */
  entryOf(accountId: string): PartyEntry {
    const party = this.partyFor(accountId);
    if (!party) return { role: "alone" };
    const host = this.hostOf(party);
    const looks = this.looksOf(party);
    if (host.accountId !== accountId) {
      return {
        role: "member",
        hostDisplayName: (looks.get(host.accountId) ?? UNKNOWN_LOOK).displayName,
        partyLobbyId: party.lobby?.id ?? null,
      };
    }
    return {
      role: "host",
      members: [...party.members.values()]
        .filter((member) => member.accountId !== accountId)
        .map((member) => ({
          accountId: member.accountId,
          displayName: (looks.get(member.accountId) ?? UNKNOWN_LOOK).displayName,
          place: this.whereabouts.get(member.accountId)?.place ?? "menu",
          online: this.online.has(member.accountId),
        })),
    };
  }

  /**
   * The host went into `lobby` holding these Reservations: it is the Party's
   * Lobby now, and every other member granted a seat is told to follow —
   * with a private Lobby's join code, so it lands where the host did.
   */
  enteredLobby(accountId: string, lobby: PartyLobbyView, reservations: Readonly<Record<string, string>>): void {
    const party = this.partyFor(accountId);
    if (!party || this.hostOf(party).accountId !== accountId) return;
    party.lobby = { id: lobby.id, port: lobby.port, ...(lobby.code !== undefined ? { code: lobby.code } : {}) };
    const hostDisplayName = this.lookOf(accountId).displayName;
    for (const [memberId, reservation] of Object.entries(reservations)) {
      const member = party.members.get(memberId);
      if (memberId === accountId || !member) continue;
      member.followingPort = lobby.port;
      this.deps.push(memberId, { type: "follow", lobby: party.lobby, reservation, hostDisplayName });
    }
    this.pushParty(party);
  }

  /** Stops every timer. Nothing is pushed afterwards — the API is going down. */
  close(): void {
    this.closed = true;
    for (const handle of this.dropTimers.values()) this.timers.clearTimeout(handle);
    this.dropTimers.clear();
    for (const invite of this.invites.values()) this.timers.clearTimeout(invite.expiry);
    for (const party of this.parties.values()) this.timers.clearTimeout(party.codeRotation);
  }

  // --- Internals -------------------------------------------------------------

  private partyFor(accountId: string): Party | undefined {
    const id = this.partyIdByAccount.get(accountId);
    return id === undefined ? undefined : this.parties.get(id);
  }

  /** A route caller without a Party (its socket not up yet) gets its party of one, which drops out like any other if no socket ever opens. */
  private ensureParty(accountId: string): Party {
    const existing = this.partyFor(accountId);
    if (existing) return existing;
    const party = this.createParty(accountId);
    if (!this.online.has(accountId)) this.scheduleDrop(accountId);
    return party;
  }

  private createParty(accountId: string): Party {
    const party: Party = {
      id: randomUUID(),
      members: new Map(),
      pending: new Map(),
      code: "",
      codeExpiresAt: 0,
      codeRotation: null,
      lobby: null,
    };
    this.parties.set(party.id, party);
    this.issueCode(party);
    this.addMember(party, accountId);
    return party;
  }

  private addMember(party: Party, accountId: string): void {
    party.members.set(accountId, { accountId, joinedAt: this.now(), joinOrder: this.nextJoinOrder++, followingPort: null });
    this.partyIdByAccount.set(accountId, party.id);
    this.notify([accountId]);
  }

  /** Joining another Party leaves your own and takes back the invites you sent (ADR 0112). */
  private join(party: Party, accountId: string): void {
    const current = this.partyFor(accountId);
    if (current) this.detach(current, accountId);
    this.addMember(party, accountId);
    // Joined over HTTP with no socket open: it drops out like any closed game unless one opens.
    if (!this.online.has(accountId) && !this.dropTimers.has(accountId)) this.scheduleDrop(accountId);
    this.pushParty(party);
  }

  /**
   * Takes a member out of its Party. The invites it sent go with it — an
   * invite says "come play with me", and the one who sent it is gone. The
   * next-earliest becomes host; a Party left empty is gone.
   */
  private detach(party: Party, accountId: string): void {
    for (const invite of [...party.pending.values()]) {
      if (invite.fromAccountId === accountId) this.dropInvite(invite.id, { pushParty: false });
    }
    const wasHost = this.hostOf(party).accountId === accountId;
    party.members.delete(accountId);
    this.partyIdByAccount.delete(accountId);
    if (party.members.size === 0) {
      this.dissolve(party);
    } else {
      // A new host who is not in the Party's Lobby does not hold the Party there.
      const host = this.hostOf(party);
      if (wasHost && party.lobby && !inLobby(this.whereabouts.get(host.accountId), party.lobby.port)) party.lobby = null;
      this.pushParty(party);
    }
    this.notify([accountId]);
  }

  private dissolve(party: Party): void {
    for (const invite of [...party.pending.values()]) this.dropInvite(invite.id, { pushParty: false });
    this.timers.clearTimeout(party.codeRotation);
    this.partyIdByCode.delete(party.code);
    this.parties.delete(party.id);
  }

  /** Answered, cancelled, expired or taken back: gone from the invitee's toasts and from the strip at once. */
  private dropInvite(inviteId: string, options: { pushParty: boolean } = { pushParty: true }): void {
    const invite = this.invites.get(inviteId);
    if (!invite) return;
    this.timers.clearTimeout(invite.expiry);
    this.invites.delete(inviteId);
    const party = this.parties.get(invite.partyId);
    party?.pending.delete(inviteId);
    this.deps.push(invite.toAccountId, { type: "partyInviteGone", inviteId });
    if (party && options.pushParty) this.pushParty(party);
  }

  /** A fresh code, working for `PARTY_CODE_TTL_MS`; then the host is shown the next one. */
  private issueCode(party: Party): void {
    this.timers.clearTimeout(party.codeRotation);
    this.partyIdByCode.delete(party.code);
    let code: string;
    do code = this.deps.randomCode();
    while (this.partyIdByCode.has(code));
    party.code = code;
    party.codeExpiresAt = this.now() + PARTY_CODE_TTL_MS;
    this.partyIdByCode.set(code, party.id);
    party.codeRotation = this.timers.setTimeout(() => {
      if (!this.parties.has(party.id)) return;
      this.issueCode(party);
      this.pushParty(party);
    }, PARTY_CODE_TTL_MS);
  }

  private liveCodeParty(code: string): Party | undefined {
    const id = this.partyIdByCode.get(code.trim().toUpperCase());
    const party = id === undefined ? undefined : this.parties.get(id);
    return party && party.codeExpiresAt > this.now() ? party : undefined;
  }

  private scheduleDrop(accountId: string): void {
    this.cancelDrop(accountId);
    this.dropTimers.set(
      accountId,
      this.timers.setTimeout(() => {
        this.dropTimers.delete(accountId);
        if (this.online.has(accountId)) return;
        const party = this.partyFor(accountId);
        if (party) this.detach(party, accountId);
        this.whereabouts.delete(accountId);
        this.placeBaselines.delete(accountId);
      }, PARTY_OFFLINE_GRACE_MS),
    );
  }

  private cancelDrop(accountId: string): void {
    const handle = this.dropTimers.get(accountId);
    if (handle === undefined) return;
    this.timers.clearTimeout(handle);
    this.dropTimers.delete(accountId);
  }

  private hostLeftLobby(party: Party): void {
    const lobby = party.lobby;
    if (!lobby) return;
    const host = this.hostOf(party);
    const hostDisplayName = this.lookOf(host.accountId).displayName;
    for (const member of party.members.values()) {
      if (member.accountId === host.accountId) continue;
      if (inLobby(this.whereabouts.get(member.accountId), lobby.port) || member.followingPort === lobby.port) {
        this.deps.push(member.accountId, { type: "left", hostDisplayName });
      }
    }
    for (const member of party.members.values()) member.followingPort = null;
    party.lobby = null;
  }

  /**
   * A bean accepted while its Party sits in a Lobby with its host follows the
   * host in, when the Lobby grants it a seat (ADR 0112). Refused, or the
   * Party moved on while asking, it waits in the menu for the next PLAY.
   */
  private async followIntoLobby(party: Party, accountId: string): Promise<void> {
    const lobby = party.lobby;
    const host = this.hostOf(party);
    if (!lobby || !this.deps.reserveSeats || host.accountId === accountId) return;
    if (!inLobby(this.whereabouts.get(host.accountId), lobby.port)) return;
    if ((this.whereabouts.get(accountId)?.place ?? "menu") !== "menu") return;
    let grants: Readonly<Record<string, string>> | null;
    try {
      grants = await this.deps.reserveSeats(lobby.port, [accountId]);
    } catch {
      return;
    }
    const reservation = grants?.[accountId];
    const member = party.members.get(accountId);
    if (reservation === undefined || !member || party.lobby !== lobby || this.closed) return;
    member.followingPort = lobby.port;
    this.deps.push(accountId, {
      type: "follow",
      lobby,
      reservation,
      hostDisplayName: this.lookOf(this.hostOf(party).accountId).displayName,
    });
  }

  private hostOf(party: Party): Member {
    let host: Member | undefined;
    for (const member of party.members.values()) {
      if (host === undefined || member.joinOrder < host.joinOrder) host = member;
    }
    // A Party is dissolved the moment its last member leaves, so one always exists.
    return host!;
  }

  private lookOf(accountId: string): PartyLook {
    return this.deps.looks([accountId]).get(accountId) ?? UNKNOWN_LOOK;
  }

  private looksOf(party: Party): ReadonlyMap<string, PartyLook> {
    return this.deps.looks([...party.members.keys(), ...[...party.pending.values()].map((invite) => invite.toAccountId)]);
  }

  private pushParty(party: Party): void {
    if (this.closed) return;
    const looks = this.looksOf(party);
    for (const accountId of party.members.keys()) {
      this.deps.push(accountId, { type: "party", party: this.viewOf(party, accountId, looks) });
    }
  }

  /** The Party as `viewerId` sees it — the code is the host's alone, and only while there is room. */
  private viewOf(party: Party, viewerId: string, looks: ReadonlyMap<string, PartyLook>): PartyView {
    const host = this.hostOf(party);
    const showCode = viewerId === host.accountId && slotsTaken(party) < PARTY_MAX_SIZE;
    return {
      id: party.id,
      hostAccountId: host.accountId,
      members: [...party.members.values()]
        .sort((a, b) => a.joinOrder - b.joinOrder)
        .map((member) => {
          const look = looks.get(member.accountId) ?? UNKNOWN_LOOK;
          return {
            accountId: member.accountId,
            displayName: look.displayName,
            color: look.color,
            skin: look.skin,
            hat: look.hat,
            avatarUploadedAt: look.avatarUploadedAt,
            xp: look.xp,
            joinedAt: member.joinedAt,
            place: this.whereabouts.get(member.accountId)?.place ?? "menu",
            online: this.online.has(member.accountId),
          };
        }),
      pending: [...party.pending.values()]
        .sort((a, b) => a.sentAt - b.sentAt)
        .map((invite) => {
          const look = looks.get(invite.toAccountId) ?? UNKNOWN_LOOK;
          return {
            inviteId: invite.id,
            accountId: invite.toAccountId,
            displayName: look.displayName,
            color: look.color,
            avatarUploadedAt: look.avatarUploadedAt,
            sentAt: invite.sentAt,
          };
        }),
      code: showCode ? party.code : null,
      codeExpiresAt: showCode ? party.codeExpiresAt : null,
      lobby: party.lobby,
    };
  }

  private inviteView(invite: Invite): PartyInviteView {
    const from = this.lookOf(invite.fromAccountId);
    return {
      id: invite.id,
      partyId: invite.partyId,
      fromAccountId: invite.fromAccountId,
      fromDisplayName: from.displayName,
      fromColor: from.color,
      fromAvatarUploadedAt: from.avatarUploadedAt,
      partySize: this.parties.get(invite.partyId)?.members.size ?? 1,
      sentAt: invite.sentAt,
    };
  }

  private notify(accountIds: readonly string[]): void {
    for (const listener of this.listeners) {
      try {
        listener(accountIds);
      } catch (err) {
        // A listener (voice chat) failing must never undo a Party change.
        console.error("party change listener failed:", err);
      }
    }
  }
}

/** Seated members plus pending invites — what `PARTY_MAX_SIZE` counts. */
const slotsTaken = (party: Party): number => party.members.size + party.pending.size;

/** Whether these whereabouts are in the Lobby on `port` — a `lobby` place with no port counts, since the client may not say. */
const inLobby = (where: Whereabouts | undefined, port: number): boolean =>
  where !== undefined && where.place === "lobby" && (where.lobbyPort === null || where.lobbyPort === port);
