/**
 * The client half of `/voice/mutes` (ADR 0111) — whom this Account has Muted.
 *
 * Voice chat's only HTTP surface; everything else about it travels its own
 * socket. A Mute is stored on the Account rather than on a Match, so a Player
 * Muted once stays Muted the next time you meet: it is a decision about a
 * person, not about an evening.
 *
 * Both calls answer with the **whole** list rather than the one row that
 * changed, so two tabs cannot drift apart over it.
 */
import { apiGet, apiJson } from "./base.js";

/** `GET /voice/mutes` — everyone this Account has Muted, oldest first. */
export const getMutes = (): Promise<{ muted: string[] }> => apiGet<{ muted: string[] }>("/voice/mutes");

/**
 * `PUT /voice/mutes/:accountId` — Mutes or unmutes one Player, and answers
 * with the whole list. The API tells the relay at once, so the Player stops
 * being heard without waiting for anything to reconnect.
 */
export const setMuted = (accountId: string, muted: boolean): Promise<{ muted: string[] }> =>
  apiJson<{ muted: string[] }>(`/voice/mutes/${encodeURIComponent(accountId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ muted }),
  });
