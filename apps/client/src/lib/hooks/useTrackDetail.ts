import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../api/base.js";
import type { StoredTrack } from "@dont-fall/shared";

/**
 * One Track's authored detail (name, checkpoint count) by id — what the
 * Countdown and between-rounds screens label Rounds with. Track detail is
 * effectively immutable per Revision and named per id, so it caches
 * forever; the list (`["tracks"]`) stays short-lived for picks.
 */
export const useTrackDetail = (trackId: string | undefined): StoredTrack | null => {
  const { data } = useQuery({
    queryKey: ["track-detail", trackId],
    queryFn: () => apiGet<StoredTrack>(`/tracks/${trackId}`),
    enabled: trackId !== undefined,
    staleTime: Infinity,
    retry: false,
  });
  return data ?? null;
};
