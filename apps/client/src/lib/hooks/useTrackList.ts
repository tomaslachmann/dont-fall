import { useQuery } from "@tanstack/react-query";
import type { TrackListing } from "@dont-fall/shared";
import { apiGet } from "../api/base.js";

export type { TrackListing };

/**
 * Every Track's id + name — what match screens label Rounds with
 * (`justPlayed`, next-track picks). Reads the shared `["tracks"]` cache
 * (one endpoint, one cache entry — the pick list and Discover read the same
 * key); names change only when a Track is republished, so this observer
 * never goes stale on its own, while the pick list's own observer sets the
 * 30s freshness where picking happens.
 */
export const useTrackList = (): TrackListing[] | null => {
  const { data } = useQuery({
    queryKey: ["tracks"],
    queryFn: () => apiGet<TrackListing[]>("/tracks"),
    staleTime: Infinity,
    retry: false,
  });
  return data ?? null;
};
