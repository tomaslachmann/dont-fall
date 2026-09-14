import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBettingState, placeBet, type BettingState } from "../api/bets.js";
import { getRewardsBalance } from "../api/rewards.js";

/**
 * The Spectator panel's data (ticket 14): one Round's board, polled while
 * the panel is open — pools (and therefore odds) move with every other
 * spectator's ticket, so a mount-time fetch would go stale mid-Round. The
 * 2s cadence is the panel's own: nothing else polls betting, and the panel
 * unmounts with the Round.
 */
export const useBettingState = (
  matchId: string | undefined,
  round: number | undefined,
  enabled: boolean,
): BettingState | null => {
  const { data } = useQuery({
    queryKey: ["betting-state", matchId, round],
    queryFn: () => getBettingState(matchId!, round!),
    enabled: enabled && matchId !== undefined && round !== undefined,
    refetchInterval: 2000,
    staleTime: 0,
    retry: false,
  });
  return data ?? null;
};

/** This Account's coin balance — the panel's bean count and ALL IN ceiling. Short-lived: stakes and settles move it. */
export const useBeanBalance = (): number | null => {
  const { data } = useQuery({
    queryKey: ["rewards-balance"],
    queryFn: getRewardsBalance,
    staleTime: 15_000,
    retry: false,
  });
  return data?.coins ?? null;
};

/** Stakes one ticket, then refreshes the board and the bean count off the same answer. */
export const usePlaceBet = (): ((ticket: {
  matchId: string;
  round: number;
  targetId: string;
  amount: number;
}) => Promise<void>) => {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: placeBet,
    onSuccess: (_bet, ticket) => {
      void queryClient.invalidateQueries({ queryKey: ["betting-state", ticket.matchId, ticket.round] });
      void queryClient.invalidateQueries({ queryKey: ["rewards-balance"] });
    },
  });
  return async (ticket) => {
    await mutation.mutateAsync(ticket);
  };
};
