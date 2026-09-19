import { eq } from "drizzle-orm";
import type { ApiDb } from "../db/db.js";
import { clientErrors } from "../db/schema.js";

export interface ClientErrorRow {
  code: string;
  kind: string;
  message: string;
  page: string;
  userAgent: string;
  accountId: string | null;
  reportedAt: number;
}

/** Files one report under its code — a second report of the same code changes nothing. */
export const insertClientError = (db: ApiDb, row: ClientErrorRow): void => {
  db.insert(clientErrors).values(row).onConflictDoNothing({ target: clientErrors.code }).run();
};

/** The report filed under `code`, if any — what support looks a Player's code up by. */
export const getClientError = (db: ApiDb, code: string): ClientErrorRow | undefined =>
  db.select().from(clientErrors).where(eq(clientErrors.code, code)).get();
