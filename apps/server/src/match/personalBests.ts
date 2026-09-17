import type { PersonalBestReport } from "@dont-fall/shared";

/**
 * The match server's half of Personal Bests (ADR 0088): when a Race Round
 * ends it reports every authed finisher's exact run time against the API's
 * `/internal/personal-bests` — the API keeps the fastest, this side only
 * reports what was run.
 *
 * Fire-and-forget from the tick loop, the posture `trackPlays` follows: a
 * down or refusing API loses a record, never the Round. Failures log, never
 * throw.
 */
export interface PersonalBestRecorder {
  recordRuns: (report: PersonalBestReport) => Promise<void>;
}

export const httpPersonalBestRecorder = (
  apiUrl: string,
  fetchFn: typeof fetch = fetch,
  serviceToken: string | undefined = process.env.SERVICE_TOKEN,
): PersonalBestRecorder => ({
  recordRuns: async (report) => {
    try {
      const res = await fetchFn(`${apiUrl}/internal/personal-bests`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(serviceToken ? { "x-service-token": serviceToken } : {}),
        },
        body: JSON.stringify(report),
      });
      if (!res.ok) console.error(`DON'T FALL: personal-best report refused (${res.status}), round unaffected`);
    } catch (err) {
      console.error("DON'T FALL: personal-best report unreachable, round unaffected", err);
    }
  },
});
