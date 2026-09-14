/**
 * The match server's half of anonymous play counts (M9 ticket 16): it
 * reports each Round's Track when the Countdown starts, against the API's
 * `/internal/tracks/:id/played` — the API owns the counter, this side only
 * reports what got played.
 *
 * Fire-and-forget from the tick loop (`matchLoop.ts`), the same posture as
 * betting's notifier: a down or refusing API strands the report in the
 * server log, but never the Round — a trending sort is not worth a Round's
 * correctness. Failures log, never throw.
 */
export interface TrackPlayRecorder {
  recordPlay: (trackId: string) => Promise<void>;
}

export const httpTrackPlayRecorder = (
  apiUrl: string,
  fetchFn: typeof fetch = fetch,
  serviceToken: string | undefined = process.env.SERVICE_TOKEN,
): TrackPlayRecorder => ({
  recordPlay: async (trackId) => {
    try {
      const res = await fetchFn(`${apiUrl}/internal/tracks/${trackId}/played`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Absent (or wrong) the API refuses the call and the play goes
          // uncounted — the same `SERVICE_TOKEN` env both sides share.
          ...(serviceToken ? { "x-service-token": serviceToken } : {}),
        },
      });
      if (!res.ok) console.error(`DON'T FALL: track play report refused (${res.status}), round unaffected`);
    } catch (err) {
      console.error("DON'T FALL: track play report unreachable, round unaffected", err);
    }
  },
});
