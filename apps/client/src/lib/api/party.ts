/**
 * The client half of `/party/*` (M15 ticket 16, ADR 0112) — the actions a
 * Party takes. Thin by contract, like `friends.ts`: typed paths over the
 * shared base, every wire shape from `@dont-fall/shared`. What a Party *is*
 * right now never comes back through here — the API pushes that over the
 * Account socket (`lib/social/accountSocket.ts`), so these only act.
 */

import type { PartyCandidatesView, PartyCodeLookup, PartyView } from "@dont-fall/shared";
import { apiGet, apiNoContent, apiPost } from "./base.js";

/** A pasted code as the API expects it: trimmed and upper-cased, like a Join Code. */
const normalizeCode = (code: string): string => code.trim().toUpperCase();

/** `GET /party/candidates` — the INVITE FRIENDS card's rows, friends and recent players, their state the API's. */
export const getPartyCandidates = (): Promise<PartyCandidatesView> => apiGet<PartyCandidatesView>("/party/candidates");

/** `GET /party/lookup/:code` — what a pasted six-character code is: a live Party code, else a friend code. 404 for neither. */
export const lookupPartyCode = (code: string): Promise<PartyCodeLookup> =>
  apiGet<PartyCodeLookup>(`/party/lookup/${encodeURIComponent(normalizeCode(code))}`);

/** `POST /party/invites` — the Party host invites a bean. The pending slot arrives with the next `party` push. */
export const inviteToParty = (accountId: string): Promise<{ inviteId: string }> =>
  apiPost<{ inviteId: string }>("/party/invites", { accountId });

/**
 * `POST /party/invites {code}` — the Party host invites the bean behind a
 * friend code pasted into the INVITE FRIENDS search (ADR 0112). By code, not
 * by id: holding their code is what stands in for being their friend or a
 * recent player, which an invite by id must be.
 */
export const inviteToPartyByCode = (friendCode: string): Promise<{ inviteId: string }> =>
  apiPost<{ inviteId: string }>("/party/invites", { code: normalizeCode(friendCode) });

/** `DELETE /party/invites/:id` — the Party host takes an invite back. */
export const cancelPartyInvite = (inviteId: string): Promise<void> =>
  apiNoContent(`/party/invites/${encodeURIComponent(inviteId)}`, { method: "DELETE" });

/** `POST /party/invites/:id/accept` — joins that Party, leaving your own; answers the Party joined. */
export const acceptPartyInvite = (inviteId: string): Promise<PartyView> =>
  apiPost<PartyView>(`/party/invites/${encodeURIComponent(inviteId)}/accept`);

/** `POST /party/invites/:id/decline` — says no; the host's pending slot goes at once. */
export const declinePartyInvite = (inviteId: string): Promise<void> =>
  apiNoContent(`/party/invites/${encodeURIComponent(inviteId)}/decline`, { method: "POST" });

/** `POST /party/join` — joins the Party behind a Party code, leaving your own; answers the Party joined. */
export const joinPartyByCode = (code: string): Promise<PartyView> =>
  apiPost<PartyView>("/party/join", { code: normalizeCode(code) });

/** `POST /party/leave` — back to a party of one. */
export const leaveParty = (): Promise<void> => apiNoContent("/party/leave", { method: "POST" });

/** `DELETE /party/members/:accountId` — the Party host removes a bean, at once (ADR 0112: no confirm). */
export const removeFromParty = (accountId: string): Promise<void> =>
  apiNoContent(`/party/members/${encodeURIComponent(accountId)}`, { method: "DELETE" });
