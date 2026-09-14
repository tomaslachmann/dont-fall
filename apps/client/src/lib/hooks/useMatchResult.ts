import { useQuery } from "@tanstack/react-query";
import type { PersistedMatchResult } from "@dont-fall/shared";
import { ApiError, apiGet } from "../api/base.js";

/**
 * One finished Match's results by id (ADR 0059) — what the results page
 * renders. Immutable once saved, so it caches forever; a 404 is an answer
 * (unknown id, or opened before the save landed), never a reason to retry.
 */
export const useMatchResult = (
  matchId: string | undefined,
): { result: PersistedMatchResult | null; error: ApiError | null; isPending: boolean; retry: () => void } => {
  const { data, error, isPending, refetch } = useQuery({
    queryKey: ["match-result", matchId],
    queryFn: () => apiGet<PersistedMatchResult>(`/matches/${matchId}`),
    enabled: matchId !== undefined,
    staleTime: Infinity,
    retry: false,
  });
  return { result: data ?? null, error: (error as ApiError | null) ?? null, isPending, retry: () => void refetch() };
};
