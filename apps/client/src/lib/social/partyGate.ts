import type { PartyState } from "./accountSocket.js";

/**
 * Why this Account cannot take its Party into a Match right now, in the words
 * a queue button's kicker shows — or `null` when it can (ADR 0112). Only the
 * Party host queues (the Party follows it everywhere), and the host waits
 * until every member is back in the menus: nobody is pulled off a podium.
 *
 * The API holds the same rule and refuses either way; this is the button
 * saying so before it is pressed. Read by PlaySelect's FIND A MATCH and
 * Rewards' PLAY AGAIN.
 */
export const queueBlockedReason = (party: PartyState): string | null => {
  if (!party.isHost) return `${(party.host?.displayName ?? "the host").toUpperCase()} PICKS THE MATCH`;
  if (party.waitingFor !== null) return `WAITING FOR ${party.waitingFor.displayName.toUpperCase()}`;
  return null;
};
