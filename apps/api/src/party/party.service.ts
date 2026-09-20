import type { PartyCandidateView, PartyCandidatesView, PartyCodeLookup, PartyView } from "@dont-fall/shared";
import type { ApiDb } from "../db/db.js";
import { ServiceError } from "../http/errors.js";
import { getAccountsByIds } from "../auth/accounts.dao.js";
import { accountIdByFriendCode, areFriends, beatsFor, listFriends } from "../friends/friends.dao.js";
import { recentPlayers, type PresenceSource } from "../friends/friends.service.js";
import type { PartiesService, PartyLook } from "./parties.service.js";

/**
 * The Party routes' database half (ADR 0112): who the INVITE FRIENDS card
 * lists, what a pasted code is, and who may be invited. The Party itself is
 * `PartiesService`'s, in memory; this file only reads the rows around it.
 */

/** Each Account's look for a Party view — straight off its row (`PartiesDeps.looks`). */
export const accountLooks =
  (db: ApiDb) =>
  (accountIds: readonly string[]): ReadonlyMap<string, PartyLook> => {
    const out = new Map<string, PartyLook>();
    for (const [id, account] of getAccountsByIds(db, [...new Set(accountIds)])) {
      out.set(id, {
        displayName: account.displayName,
        color: account.color,
        skin: account.skin,
        hat: account.hat,
        avatarUploadedAt: account.avatarUploadedAt,
        xp: account.xp,
      });
    }
    return out;
  };

/**
 * Whether `from` may invite `to` by id (`PartiesDeps.mayInvite`): a friend,
 * or a recent player — one the card's RECENT tab lists, the same query the
 * Friends screen's RECENT reads.
 */
export const mayInviteToParty =
  (db: ApiDb) =>
  (fromAccountId: string, toAccountId: string): boolean =>
    areFriends(db, fromAccountId, toAccountId) ||
    recentPlayers(db, fromAccountId).recent.some((player) => player.accountId === toAccountId);

/**
 * `GET /party/candidates` — the INVITE FRIENDS card's rows: friends, then
 * recent players who are not friends, each with its state from the caller's
 * Party. Online is an open Account socket, and `place` the bean's own
 * reported place while it is. In a Match reads that reported place when this
 * API knows it, and the Lobbies' live rosters otherwise.
 */
export const partyCandidates = async (
  db: ApiDb,
  parties: PartiesService,
  presence: PresenceSource,
  accountId: string,
): Promise<PartyCandidatesView> => {
  const friends = listFriends(db, accountId);
  const recent = recentPlayers(db, accountId).recent;
  const friendIds = new Set(friends.map((friend) => friend.accountId));
  const lastPlayedAt = new Map(recent.map((player) => [player.accountId, player.lastPlayedAt] as const));
  const ids = [...new Set([...friendIds, ...recent.map((player) => player.accountId)])].filter((id) => id !== accountId);
  const accounts = getAccountsByIds(db, ids);
  const beats = beatsFor(db, ids);

  // The rosters are a status poll per Lobby — only asked when some bean's place is not already known here.
  let seatedPhase: Map<string, string> | null = null;
  if (ids.some((id) => parties.placeOf(id) === null)) {
    seatedPhase = new Map();
    for (const seat of await presence.liveSeats()) for (const id of seat.accountIds) seatedPhase.set(id, seat.phase);
  }

  const candidates: PartyCandidateView[] = [];
  for (const id of ids) {
    const account = accounts.get(id);
    if (!account) continue;
    const { state, inviteId, inviteSentAt, otherPartySize } = parties.candidateState(accountId, id);
    const place = parties.placeOf(id);
    const online = parties.isOnline(id);
    const phase = seatedPhase?.get(id);
    candidates.push({
      accountId: id,
      displayName: account.displayName,
      color: account.color,
      avatarUploadedAt: account.avatarUploadedAt,
      state,
      friend: friendIds.has(id),
      online,
      inMatch: place !== null ? place === "match" : phase !== undefined && phase !== "LOBBY",
      // The card's ONLINE · IN MENU — only while the socket that reported it is open.
      place: online ? place : null,
      otherPartySize,
      lastPlayedAt: lastPlayedAt.get(id) ?? null,
      lastSeenAt: beats.get(id) ?? null,
      inviteId,
      inviteSentAt,
    });
  }
  return { candidates, friendCount: friends.length };
};

/**
 * `GET /party/lookup/:code` — what a pasted six-character code is: a live
 * Party code first (its Party, to JOIN), else a friend code (that bean, to
 * INVITE). 404 for neither.
 */
export const lookupPartyCode = (db: ApiDb, parties: PartiesService, accountId: string, code: string): PartyCodeLookup => {
  const party = parties.byCode(code);
  if (party) {
    const host = accountLooks(db)([party.hostAccountId]).get(party.hostAccountId);
    return {
      kind: "party",
      partyId: party.partyId,
      hostAccountId: party.hostAccountId,
      hostDisplayName: host?.displayName ?? "Unknown player",
      hostColor: host?.color ?? 0,
      hostAvatarUploadedAt: host?.avatarUploadedAt ?? null,
      size: party.size,
    };
  }
  const beanId = accountIdByFriendCode(db, code.trim());
  const bean = beanId === undefined ? undefined : getAccountsByIds(db, [beanId]).get(beanId);
  if (beanId === undefined || !bean) throw new ServiceError(404, "no party or player with that code");
  return {
    kind: "account",
    accountId: beanId,
    displayName: bean.displayName,
    color: bean.color,
    avatarUploadedAt: bean.avatarUploadedAt,
    state: parties.candidateState(accountId, beanId).state,
  };
};

/**
 * `POST /party/invites` — invite a bean by id, or by the friend code pasted
 * into the card's search (ADR 0112: "pasting a bean's friend code invites
 * that bean"). By id, only a friend or a recent player; by code, anyone —
 * holding their code is what the friend-or-recent rule stands in for, as it
 * is for a friend request.
 */
export const inviteToParty = (
  db: ApiDb,
  parties: PartiesService,
  hostId: string,
  body: { accountId?: unknown; code?: unknown },
): { inviteId: string } => {
  if (typeof body.accountId === "string" && body.accountId.length > 0) {
    return parties.invite(hostId, body.accountId, { gated: true });
  }
  if (typeof body.code === "string" && body.code.trim().length > 0) {
    const targetId = accountIdByFriendCode(db, body.code.trim());
    if (targetId === undefined) throw new ServiceError(404, "no player with that friend code");
    return parties.invite(hostId, targetId, { gated: false });
  }
  throw new ServiceError(400, "send an accountId or a friend code");
};

/** `POST /party/join` — join by Party code. */
export const joinPartyByCode = async (parties: PartiesService, accountId: string, body: { code?: unknown }): Promise<PartyView> => {
  if (typeof body.code !== "string" || body.code.trim().length === 0) throw new ServiceError(400, "code is required");
  return parties.joinByCode(accountId, body.code);
};
