import { useQuery } from "@tanstack/react-query";
import type { TrackListing } from "@dont-fall/shared";
import { apiGet } from "../api/base.js";

export interface DiscoverTracks {
  tracks: TrackListing[] | null;
  isLoading: boolean;
  error: string | null;
  retry: () => void;
}

/**
 * The full `GET /tracks` listing — every row with its plays and raceability
 * (M9 ticket 16). One cached query (fresh for 30s) shared by both Discover
 * residents: the standalone `/discover` route and the Lobby's inline Track
 * browser read the same `["tracks"]` key the host's picker already reads,
 * so browsing never refetches what the Lobby just fetched.
 *
 * `enabled` gates the fetch itself — the Lobby passes `isHost`, so only the
 * host pays for a list only the host can pick from.
 */
export const useDiscoverTracks = (enabled = true): DiscoverTracks => {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["tracks"],
    queryFn: () => apiGet<TrackListing[]>("/tracks"),
    enabled,
    staleTime: 30_000,
  });
  return {
    tracks: data ?? null,
    isLoading,
    error: !isError ? null : error instanceof Error ? error.message : "Could not load Tracks.",
    retry: () => void refetch(),
  };
};
