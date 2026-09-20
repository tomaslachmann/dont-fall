import { and, eq } from "drizzle-orm";
import type { ApiDb } from "../db/db.js";
import { voiceMutes } from "../db/schema.js";

/**
 * Whom an Account has Muted (ADR 0111). Kept on the Account rather than on a
 * Match, so a Player Muted once stays Muted the next time they meet: a Mute
 * is a decision about a person, not about an evening.
 *
 * One way and hearing only — it stops the muter hearing them, never the other
 * way round. Silencing both ways is what OFF is.
 */

/** Everyone this Account has Muted, oldest first. */
export const listMutes = (db: ApiDb, accountId: string): string[] =>
  db
    .select({ mutedAccountId: voiceMutes.mutedAccountId })
    .from(voiceMutes)
    .where(eq(voiceMutes.accountId, accountId))
    .orderBy(voiceMutes.createdAt)
    .all()
    .map((row) => row.mutedAccountId);

/**
 * Mutes or unmutes one Player for this Account, and answers with the whole
 * list — the client replaces rather than patches, so two tabs cannot drift.
 * Muting yourself is ignored: you never hear yourself anyway.
 */
export const setMuted = (
  db: ApiDb,
  accountId: string,
  mutedAccountId: string,
  muted: boolean,
  now: number = Date.now(),
): string[] => {
  if (mutedAccountId !== accountId) {
    if (muted) {
      db.insert(voiceMutes).values({ accountId, mutedAccountId, createdAt: now }).onConflictDoNothing().run();
    } else {
      db.delete(voiceMutes)
        .where(and(eq(voiceMutes.accountId, accountId), eq(voiceMutes.mutedAccountId, mutedAccountId)))
        .run();
    }
  }
  return listMutes(db, accountId);
};
