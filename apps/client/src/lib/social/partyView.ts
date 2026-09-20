/**
 * The Party as the main menu draws it (M15 ticket 16, ADR 0112) — pure, like
 * `friendsView.ts`, so the mocks' own words ("READY · LVL 31", "INVITED ·
 * 0:42", "IN ANOTHER PARTY · 3/4", "PLAY AS A PARTY · 3 BEANS READY") are
 * pinned without a router, a socket or a query client. The Party itself is
 * the Account socket's (`accountSocket.ts`) and the invite card's rows are
 * the API's (`GET /party/candidates`); this only puts them into words.
 */

import {
  levelForXp,
  PARTY_CODE_LENGTH,
  PARTY_MAX_SIZE,
  type PartyCandidateState,
  type PartyCandidateView,
  type PartyCodeLookup,
  type PartyMemberView,
  type PartyPendingView,
  type PartyView,
} from "@dont-fall/shared";
import { avatarLook, type AvatarLook } from "../avatar.js";
import { formatAgo } from "../friendsView.js";
import { formatSurvived } from "../utils/roundTimer.js";
import type { PartyState } from "./accountSocket.js";
import { queueBlockedReason } from "./partyGate.js";

const NUMBER_WORDS = ["ZERO", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN"];

/** A small count as the mocks spell it — `FOUR` in "PARTY OF FOUR" — and digits past ten. */
export const countWord = (n: number): string => NUMBER_WORDS[n] ?? String(n);

/** How long an invite has been out, `m:ss` — floored, as every other elapsed time on the Screens is. */
export const formatInviteWait = (sentAt: number, nowMs: number): string => formatSurvived(nowMs - sentAt);

// --- The strip ---------------------------------------------------------------

/** One slot of the menu's PartyStrip: a seated member, or an invite still out (it takes a slot). */
export interface PartySlot {
  /** Whose bean — the slot's key, and what its × removes or un-invites. */
  accountId: string;
  name: string;
  look: AvatarLook;
  level?: number;
  you?: boolean;
  host?: boolean;
  pending?: boolean;
  /** How long a pending invite has been out, `m:ss`. */
  waiting?: string;
  /** Where a member is instead of the menus — what the strip says in place of READY. */
  away?: string;
}

/** You, as the Account knows you — the strip's one slot before the Party has arrived. */
export interface PartySelf {
  id: string;
  displayName: string;
  color: number;
  avatarUploadedAt: number | null;
  xp: number;
}

/**
 * What a member is doing instead of standing in the menus, in the strip's
 * words — `null` when they are there, READY. A closed Account socket reads
 * OFFLINE before its place does: the API keeps the member through its grace
 * (`PARTY_OFFLINE_GRACE_MS`), but nobody is ready from a closed tab.
 */
export const awayLabel = (member: Pick<PartyMemberView, "place" | "online">): string | null => {
  if (!member.online) return "OFFLINE";
  switch (member.place) {
    case "menu":
      return null;
    case "lobby":
      return "IN THE LOBBY";
    case "match":
      return "IN A MATCH";
  }
};

const memberSlot = (member: PartyMemberView, party: PartyState): PartySlot => {
  const away = awayLabel(member);
  return {
    accountId: member.accountId,
    name: member.displayName,
    look: avatarLook(member.accountId, member.color, member.avatarUploadedAt),
    level: levelForXp(member.xp),
    ...(member.accountId === party.you ? { you: true } : {}),
    ...(member.accountId === party.party?.hostAccountId ? { host: true } : {}),
    ...(away === null ? {} : { away }),
  };
};

const pendingSlot = (invite: PartyPendingView, nowMs: number): PartySlot => ({
  accountId: invite.accountId,
  name: invite.displayName,
  look: avatarLook(invite.accountId, invite.color, invite.avatarUploadedAt),
  pending: true,
  waiting: formatInviteWait(invite.sentAt, nowMs),
});

/**
 * The strip's slots: seated members in the Party's own order (host first),
 * then the invites still out. Before the Party has arrived over the socket
 * you are shown alone, hosting — everyone signed in is a party of one (ADR
 * 0112), and a slow socket must not leave the strip empty.
 */
export const partySlots = (party: PartyState, self: PartySelf | null, nowMs: number): PartySlot[] => {
  if (party.party === null) {
    if (self === null) return [];
    return [
      {
        accountId: self.id,
        name: self.displayName,
        look: avatarLook(self.id, self.color, self.avatarUploadedAt),
        level: levelForXp(self.xp),
        you: true,
        host: true,
      },
    ];
  }
  return [...party.members.map((member) => memberSlot(member, party)), ...party.pending.map((invite) => pendingSlot(invite, nowMs))];
};

/** The strip's title and its one short line (the Party mock's words). */
export const stripHeading = (party: PartyState): { title: string; note: string | undefined } => {
  if (!party.isHost) {
    return {
      title: `${(party.host?.displayName ?? "the host").toUpperCase()}'S PARTY`,
      note: "Only the host can invite or remove beans.",
    };
  }
  const alone = party.size <= 1 && party.pending.length === 0;
  return {
    title: "YOUR PARTY",
    note: alone
      ? `Invite up to ${countWord(PARTY_MAX_SIZE - 1).toLowerCase()} friends — the party stays together between rounds.`
      : undefined,
  };
};

/**
 * Whether the menu wears the Party at all (ADR 0112): it is **active** once
 * it has a second bean or an invite out. Alone, the strip stays away and the
 * menu keeps its stat tiles — the user's call after the first build put the
 * strip there unconditionally and left BEST SURVIVAL and GRABS BROKEN on no
 * Screen at all.
 *
 * Deliberately not {@link canLeaveParty}: that asks whether LEAVE PARTY would
 * do anything. The two agree today and are free to stop agreeing.
 */
export const isPartyActive = (party: PartyState): boolean => party.size > 1 || party.pending.length > 0;

/** LEAVE PARTY does nothing for a party of one with no invites out — the strip disables it. */
export const canLeaveParty = (party: PartyState): boolean => party.size > 1 || party.pending.length > 0;

/** How many slots an invite can still take: the Party's cap, less its seated beans and the invites already out. */
export const slotsLeft = (party: PartyState): number => Math.max(0, PARTY_MAX_SIZE - party.size - party.pending.length);

// --- PLAY ----------------------------------------------------------------------

/**
 * The beans ready to play: you (on the menu, reading this) and every other
 * member in the menus with their game open — what PLAY AS A PARTY counts.
 */
export const readyBeans = (party: PartyState): number => 1 + party.others.filter((member) => awayLabel(member) === null).length;

/**
 * PLAY's kicker (ADR 0112, the Party mock's): in a Party of two or more,
 * PLAY AS A PARTY · N BEANS READY — or, for the host while anyone is still
 * in a Lobby, a Match or its results, WAITING FOR <name>, the same words
 * the host's FIND A MATCH shows. Alone, today's QUICK MATCH · N BEANS ONLINE.
 */
export const playKicker = (party: PartyState, beansOnline: string | undefined): string => {
  if (party.size < 2) return beansOnline ? `QUICK MATCH · ${beansOnline} BEANS ONLINE` : "QUICK MATCH";
  const blocked = party.isHost ? queueBlockedReason(party) : null;
  if (blocked !== null) return blocked;
  const ready = readyBeans(party);
  return `PLAY AS A PARTY · ${ready} ${ready === 1 ? "BEAN" : "BEANS"} READY`;
};

/** The flash after joining a Party, by code or by its SHARE LINK — naming whose it is. */
export const joinedPartyMessage = (joined: PartyView): string => {
  const host = joined.members.find((member) => member.accountId === joined.hostAccountId);
  return host ? `You joined ${host.displayName}'s party.` : "You joined the party.";
};

/** The hero's caption where no 3D preview runs — what the bean (or the Party) would be doing. */
export const heroCaption = (party: PartyState): string =>
  party.size > 1 ? `PARTY OF ${countWord(party.size)}, IDLE + YOUR EMOTE` : "IDLE + YOUR EMOTE";

// --- The INVITE FRIENDS card --------------------------------------------------

/** The card's three tabs — the mock's own labels. */
export const INVITE_TABS = ["ONLINE", "RECENT", "ALL"] as const;
export type InviteTab = (typeof INVITE_TABS)[number];

/** One row of the card: a bean, its status line, and which button it gets. */
export interface InviteRow {
  accountId: string;
  name: string;
  look: AvatarLook;
  status: string;
  state: PartyCandidateState;
  /** Mid-Match but still invitable — the status line wears the Race colour. */
  inMatch: boolean;
  /** Offline — the BUSY tag reads OFFLINE. */
  offline: boolean;
  /** The invite out to them, for CANCEL — `null` when there is none. */
  inviteId: string | null;
  /**
   * The friend code this row was found by (a pasted code, ADR 0112) — INVITE
   * then sends the code rather than the id, since holding a bean's code is
   * what stands in for being their friend or a recent player.
   */
  friendCode?: string;
}

/** The status line of a bean still invitable mid-Match — the one the Race colour marks. */
const IN_A_MATCH = "IN A MATCH · CAN STILL JOIN";

/**
 * One candidate's status line, in the mock's words. The order is what the
 * row can still do: an invite out first (CANCEL), then why it cannot be
 * invited, then how an invitable bean is doing.
 */
export const candidateStatus = (candidate: PartyCandidateView, inYourParty: boolean, nowMs: number): string => {
  if (inYourParty) return "ALREADY IN YOUR PARTY";
  if (candidate.state === "invited") return `INVITED · WAITING ${formatInviteWait(candidate.inviteSentAt ?? nowMs, nowMs)}`;
  if (candidate.otherPartySize !== null) return `IN ANOTHER PARTY · ${candidate.otherPartySize}/${PARTY_MAX_SIZE}`;
  if (!candidate.online) return candidate.lastSeenAt === null ? "OFFLINE" : `OFFLINE · ${formatAgo(candidate.lastSeenAt, nowMs)}`;
  if (candidate.inMatch) return IN_A_MATCH;
  switch (candidate.place) {
    case "menu":
      return "ONLINE · IN MENU";
    case "lobby":
      return "IN A LOBBY";
    default:
      // Online with no place reported yet: the line claims nothing it does not know.
      return "ONLINE";
  }
};

export const inviteRow = (candidate: PartyCandidateView, party: PartyState, nowMs: number): InviteRow => {
  const inYourParty = party.members.some((member) => member.accountId === candidate.accountId);
  const status = candidateStatus(candidate, inYourParty, nowMs);
  return {
    accountId: candidate.accountId,
    name: candidate.displayName,
    look: avatarLook(candidate.accountId, candidate.color, candidate.avatarUploadedAt),
    status,
    state: inYourParty ? "busy" : candidate.state,
    inMatch: status === IN_A_MATCH,
    offline: !candidate.online,
    inviteId: candidate.inviteId,
  };
};

/**
 * The card's tabs (ADR 0112): ONLINE is your friends online right now,
 * RECENT the beans you last shared a Match with (newest first), ALL every
 * friend. ALL's count is the API's friend count, not the rows it sent.
 */
export const inviteTabs = (
  candidates: readonly PartyCandidateView[],
  friendCount: number,
  party: PartyState,
  nowMs: number,
): { rows: Record<InviteTab, InviteRow[]>; counts: Record<InviteTab, number> } => {
  const row = (candidate: PartyCandidateView): InviteRow => inviteRow(candidate, party, nowMs);
  const online = candidates.filter((c) => c.friend && c.online).map(row);
  const recent = candidates
    .filter((c): c is PartyCandidateView & { lastPlayedAt: number } => c.lastPlayedAt !== null)
    .sort((a, b) => b.lastPlayedAt - a.lastPlayedAt)
    .map(row);
  const all = candidates.filter((c) => c.friend).map(row);
  return {
    rows: { ONLINE: online, RECENT: recent, ALL: all },
    counts: { ONLINE: online.length, RECENT: recent.length, ALL: friendCount },
  };
};

/** The rows whose name holds the search, ignoring case. */
export const matchingRows = (rows: readonly InviteRow[], query: string): InviteRow[] => {
  const q = query.trim().toUpperCase();
  return q === "" ? [...rows] : rows.filter((row) => row.name.toUpperCase().includes(q));
};

const CODE_SHAPE = new RegExp(`^[A-Z0-9]{${PARTY_CODE_LENGTH}}$`);

/**
 * The search as a code to look up (`GET /party/lookup/:code`) — a Party code
 * or a friend code, both six characters — or `null` when it is not shaped
 * like one. A six-letter name is shaped like one too: it is searched as a
 * name and looked up, and whichever answers shows.
 */
export const codeInQuery = (query: string): string | null => {
  const code = query.trim().toUpperCase();
  return CODE_SHAPE.test(code) ? code : null;
};

/** What a looked-up code shows as, above the rows. */
export type FoundRow =
  | { kind: "party"; code: string; name: string; look: AvatarLook; status: string; full: boolean }
  | { kind: "bean"; row: InviteRow };

/**
 * A looked-up code as the card shows it: a Party is its host's face and
 * "<HOST>'S PARTY · n/4" with JOIN; a bean is an ordinary row. A bean the
 * card already lists is that row (its status says more than a lookup can);
 * otherwise it is invited by the code itself.
 */
export const foundRow = (
  lookup: PartyCodeLookup,
  code: string,
  candidates: readonly PartyCandidateView[],
  party: PartyState,
  nowMs: number,
): FoundRow => {
  if (lookup.kind === "party") {
    return {
      kind: "party",
      code,
      name: lookup.hostDisplayName,
      look: avatarLook(lookup.hostAccountId, lookup.hostColor, lookup.hostAvatarUploadedAt),
      status: `${lookup.hostDisplayName.toUpperCase()}'S PARTY · ${lookup.size}/${PARTY_MAX_SIZE}`,
      full: lookup.size >= PARTY_MAX_SIZE,
    };
  }
  const listed = candidates.find((candidate) => candidate.accountId === lookup.accountId);
  if (listed) return { kind: "bean", row: inviteRow(listed, party, nowMs) };
  const inYourParty = party.members.some((member) => member.accountId === lookup.accountId);
  const invite = party.pending.find((pending) => pending.accountId === lookup.accountId) ?? null;
  const state: PartyCandidateState = inYourParty ? "busy" : invite ? "invited" : lookup.state;
  return {
    kind: "bean",
    row: {
      accountId: lookup.accountId,
      name: lookup.displayName,
      look: avatarLook(lookup.accountId, lookup.color, lookup.avatarUploadedAt),
      status: inYourParty
        ? "ALREADY IN YOUR PARTY"
        : invite
          ? `INVITED · WAITING ${formatInviteWait(invite.sentAt, nowMs)}`
          : `FRIEND CODE ${code}`,
      state,
      inMatch: false,
      offline: false,
      inviteId: invite?.inviteId ?? null,
      friendCode: code,
    },
  };
};
