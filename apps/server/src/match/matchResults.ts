import type { PersistedMatchResult } from "@dont-fall/shared";

/**
 * The match server's half of persisted results (ADR 0059): it saves the
 * finished Match once, at its terminal RESULTS, against the API's
 * `/internal/match-results` — the API owns the row, this side only reports
 * what happened. The same `SERVICE_TOKEN` posture as betting: absent or
 * wrong, the save is refused.
 *
 * Unlike betting's fire-and-forget, the save is load-bearing — the server
 * only raises `matchOver` once this reports success, and retries on failure
 * — so this returns whether the row landed instead of swallowing the answer.
 * Failures still log, never throw: a down API delays Match end, never the
 * Match that already happened.
 */
export interface MatchResultsNotifier {
  saveResult: (result: PersistedMatchResult) => Promise<boolean>;
}

export const httpMatchResultsNotifier = (
  apiUrl: string,
  fetchFn: typeof fetch = fetch,
  serviceToken: string | undefined = process.env.SERVICE_TOKEN,
): MatchResultsNotifier => ({
  saveResult: async (result) => {
    try {
      const res = await fetchFn(`${apiUrl}/internal/match-results`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(serviceToken ? { "x-service-token": serviceToken } : {}),
        },
        body: JSON.stringify(result),
      });
      if (!res.ok) {
        console.error(`DON'T FALL: match-results save refused (${res.status}), will retry`);
        return false;
      }
      return true;
    } catch (err) {
      console.error("DON'T FALL: match-results save unreachable, will retry", err);
      return false;
    }
  },
});
