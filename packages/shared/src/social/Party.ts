/**
 * Party wire shapes (M15 ticket 16, ADR 0112) — what the API's `/party/*`
 * routes answer and what the Account socket pushes. Shared for the same
 * reason as `Friends.ts`: producer and consumer must never silently drift.
 */
import type { LobbyInviteView } from "./Friends.js";

/**
 * Where a client says it is, over its Account socket (ADR 0112). `match`
 * runs from LOADING until the Player leaves Rewards — a podium is not the
 * menus. What READY, WAITING FOR and the host-left rule read.
 */
export const PARTY_PLACES = ["menu", "lobby", "match"] as const;
export type PartyPlace = (typeof PARTY_PLACES)[number];

/** One seated member of a Party, with everything the strip and the menu's hero draw. */
export interface PartyMemberView {
  accountId: string;
  displayName: string;
  /** The bean's Colour — its avatar disc, and its body under no `skin`. */
  color: number;
  skin: string | null;
  hat: string | null;
  /** The avatar picture's version (ADR 0110) — `null` for none uploaded. */
  avatarUploadedAt: number | null;
  xp: number;
  /** When they joined (ms epoch) — the earliest is the host. */
  joinedAt: number;
  place: PartyPlace;
  /** Whether their Account socket is open right now — a closed one drops out after the grace. */
  online: boolean;
}

/** An invite the host sent that has not been answered — it takes a slot. */
export interface PartyPendingView {
  inviteId: string;
  accountId: string;
  displayName: string;
  color: number;
  avatarUploadedAt: number | null;
  /** When it was sent (ms epoch) — the strip's INVITED · 0:42 counts from here. */
  sentAt: number;
}

export interface PartyView {
  id: string;
  hostAccountId: string;
  /** Seated members, host first, then by `joinedAt`. */
  members: PartyMemberView[];
  pending: PartyPendingView[];
  /** Shown to the host only — `null` for everyone else, and when the Party is full. */
  code: string | null;
  /** When `code` stops working (ms epoch) — `null` with no code. */
  codeExpiresAt: number | null;
  /** The Lobby the Party is in with its host, while it sits in one before its Match. */
  lobby: PartyLobbyView | null;
}

/**
 * The Lobby a Party sits in with its host. `code` is present only for a
 * private Lobby, which has a join code — a member who follows its host there
 * shows it and shares it by it, as the host does (private Lobbies are never
 * reached by id).
 */
export interface PartyLobbyView {
  id: string;
  port: number;
  code?: string;
}

/** A Party invite arrived for this Account. */
export interface PartyInviteView {
  id: string;
  partyId: string;
  fromAccountId: string;
  fromDisplayName: string;
  fromColor: number;
  fromAvatarUploadedAt: number | null;
  /** Seated members right now, so the toast can say how big a Party this is. */
  partySize: number;
  sentAt: number;
}

/** One row of the INVITE FRIENDS card, its state computed by the API. */
export type PartyCandidateState = "free" | "invited" | "busy";

export interface PartyCandidateView {
  accountId: string;
  displayName: string;
  color: number;
  avatarUploadedAt: number | null;
  state: PartyCandidateState;
  /** Which of the card's tabs it belongs under. A friend is `ALL`; one online is also `ONLINE`. */
  friend: boolean;
  online: boolean;
  /** In a Match right now — invitable, and the card says so (IN A MATCH · CAN STILL JOIN). */
  inMatch: boolean;
  /** Where its client last said it was, while its Account socket is open — `null` when closed or unknown. */
  place: PartyPlace | null;
  /** In another Party of two or more — its seated size, for "IN ANOTHER PARTY · 3/4". */
  otherPartySize: number | null;
  /** Shared a finished Match recently — the RECENT tab, newest first by this. */
  lastPlayedAt: number | null;
  /** Last seen (ms epoch) for "OFFLINE · 2 DAYS AGO" — `null` when never. */
  lastSeenAt: number | null;
  /** A pending invite from this Party to them — the row's CANCEL and INVITED · WAITING m:ss. */
  inviteId: string | null;
  inviteSentAt: number | null;
}

export interface PartyCandidatesView {
  candidates: PartyCandidateView[];
  /** How many friends, for the ALL tab's count. */
  friendCount: number;
}

/** What a pasted six-character code turned out to be. */
export type PartyCodeLookup =
  | {
      kind: "party";
      partyId: string;
      hostAccountId: string;
      hostDisplayName: string;
      hostColor: number;
      hostAvatarUploadedAt: number | null;
      size: number;
    }
  | {
      kind: "account";
      accountId: string;
      displayName: string;
      color: number;
      avatarUploadedAt: number | null;
      state: PartyCandidateState;
    };

/**
 * A broker entry's answer (ADR 0112) — the Lobby, and the Reservation the
 * caller connects with. `reservation` is absent for an anonymous caller.
 */
export interface LobbyEntryGrant {
  id: string;
  port: number;
  reservation?: string;
  /** Set when entering alone took this caller out of a Party — the flash names whose. */
  leftPartyOf?: string;
}

/** Client → API over the Account socket. */
export type AccountClientMessage =
  | { type: "auth"; token: string }
  | { type: "place"; place: PartyPlace; lobbyPort?: number };

/** API → client over the Account socket. */
export type AccountServerMessage =
  /** Signed in as this Account — the socket is live. */
  | { type: "ready"; accountId: string }
  /** The Party as it is now — sent on connect and on every change. */
  | { type: "party"; party: PartyView }
  | { type: "partyInvite"; invite: PartyInviteView }
  /** An invite this Account had was cancelled, declined elsewhere, or expired. */
  | { type: "partyInviteGone"; inviteId: string }
  | { type: "lobbyInvite"; invite: LobbyInviteView }
  /** The host took the Party into a Lobby — go there, with this Reservation. */
  | { type: "follow"; lobby: PartyLobbyView; reservation: string; hostDisplayName: string }
  /** The host left the Party's Lobby before its Match — back to the menu. */
  | { type: "left"; hostDisplayName: string }
  /** The host removed this Account from their Party. */
  | { type: "removed"; byDisplayName: string };

/**
 * Close code when a newer Account socket for the same Account takes over
 * (ADR 0112, as ADR 0090 does for a Lobby seat) — the older tab shows why
 * and does not reconnect.
 */
export const ACCOUNT_SOCKET_REPLACED = 4010;
/** Close code for an `auth` the API could not resolve to an Account. */
export const ACCOUNT_SOCKET_UNAUTHORIZED = 4001;

/** The Account socket's path on the API (online `/api/account`). */
export const ACCOUNT_SOCKET_PATH = "/account";

/** Party codes share the friend code's length and alphabet — never its namespace. */
export const PARTY_CODE_LENGTH = 6;
