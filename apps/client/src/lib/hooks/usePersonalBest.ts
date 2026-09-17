import { useQuery } from "@tanstack/react-query";
import type { PersonalBest } from "@dont-fall/shared";
import { apiGet } from "../api/base.js";

/**
 * Your own Personal Best on a Track, in ms (ADR 0088) — what the Race HUD's PB
 * line reads. `round` is part of the key so each Round asks again: a record set
 * earlier in the same Match shows on a later Round on the same Track. `null`
 * before any finished run, and for a seat the API can't name (no session).
 */
export const usePersonalBest = (trackId: string | undefined, round: number): number | null => {
  const { data } = useQuery({
    queryKey: ["personal-best", trackId, round],
    queryFn: () => apiGet<PersonalBest>(`/tracks/${trackId}/personal-best`),
    enabled: trackId !== undefined,
    staleTime: Infinity,
    retry: false,
  });
  return data?.bestMs ?? null;
};
