import type { PersistedMatchResult } from "@dont-fall/shared";
import { apiGet } from "./base.js";

/**
 * The client's half of `/matches/*` (ADR 0059) — one finished Match's
 * results in, the results page's whole world out. Totals, winners, and
 * claim rows all derive client-side from this (`matchView.ts`), the same
 * discipline the old in-canvas overlay followed over live snapshots.
 */
export const getMatchResult = (matchId: string): Promise<PersistedMatchResult> =>
  apiGet<PersistedMatchResult>(`/matches/${matchId}`);
