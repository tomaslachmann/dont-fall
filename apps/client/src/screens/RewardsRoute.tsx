import { useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { hatsUnlockedBetween, levelForXp, xpBarFractions, xpForRoundScore } from "@dont-fall/shared";
import { saveCosmetics } from "../lib/api/auth.js";
import { claimRewards, type RewardsClaim } from "../lib/api/rewards.js";
import { flash } from "../lib/flash.js";
import { hatIconUrl } from "../lib/hatAssets.js";
import { useAccount } from "../lib/hooks/useAccount.js";
import { useAsyncError } from "../lib/hooks/useAsyncError.js";
import { ordinal } from "../lib/matchView.js";
import { LoadingScreen } from "./LoadingScreen.js";
import Rewards from "./Rewards.js";

interface RewardsLocationState {
  matchId?: string;
  rounds?: { placement: number; playerCount: number; score: number }[];
}

/**
 * `/rewards` — MatchOver's COLLECT lands here with the Match id and its own
 * claim rows as route state. The claim is idempotent per `matchId` (ADR
 * 0059), so a remount replays the stored numbers instead of crediting again;
 * the guard below still dedupes the in-flight call itself (StrictMode-safe:
 * refs survive its double-effect).
 *
 * The breakdown re-runs the shared formula over the same rows the server
 * credited, so "what the screen promised" and "what landed" agree by
 * construction. Coins show the match split only — betting isn't built, so
 * there is no BET WON row to show.
 *
 * A Match whose XP crossed a hat's level announces that hat (ADR 0083) —
 * the last one, when it crossed several — and EQUIP NEW HAT puts it on
 * right here, so the celebrating bean wears it the moment the save lands.
 */
export function RewardsRoute() {
  const location = useLocation();
  const navigate = useNavigate();
  const throwAsync = useAsyncError();
  const state = (location.state ?? {}) as RewardsLocationState;
  const [claim, setClaim] = useState<RewardsClaim | null>(null);
  const claimedRef = useRef(false);

  const matchId = state.matchId;
  const rounds = state.rounds ?? [];
  const { account } = useAccount();
  const queryClient = useQueryClient();
  useEffect(() => {
    if (matchId === undefined || rounds.length === 0 || claimedRef.current) return;
    claimedRef.current = true;
    claimRewards(rounds, matchId).then(setClaim, throwAsync);
  }, [matchId, rounds, throwAsync]);

  if (matchId === undefined || rounds.length === 0) return <Navigate to="/" replace />;
  if (claim === null) return <LoadingScreen label="Counting your beans…" />;

  const fractions = xpBarFractions(claim.xpBefore, claim.gainedXp);
  const unlocked = hatsUnlockedBetween(claim.xpBefore, claim.xpAfter).at(-1);
  const equip = (hat: string) => {
    saveCosmetics({ hat })
      .then(() => queryClient.invalidateQueries({ queryKey: ["account"] }))
      .catch((err: unknown) =>
        flash(`Couldn't put the hat on: ${err instanceof Error ? err.message : String(err)}`, "error"),
      );
  };
  return (
    <Rewards
      skin={account?.bodySkin ?? null}
      hat={account?.hat ?? null}
      unlock={unlocked?.name}
      unlockIcon={unlocked && hatIconUrl(unlocked.id)}
      onEquip={unlocked && account?.hat !== unlocked.id ? () => equip(unlocked.id) : undefined}
      level={levelForXp(claim.xpAfter)}
      xpGain={claim.gainedXp}
      xpBefore={fractions.before}
      xpEarned={fractions.earned}
      breakdown={rounds.map((row, i) => [`ROUND ${i + 1} · ${ordinal(row.placement)} PLACE`, xpForRoundScore(row.score)])}
      beans={claim.gainedCoins}
      beansSplit={[["MATCH", claim.gainedCoins]]}
      onPlayAgain={() => navigate("/play")}
      onLobby={() => navigate("/play")}
    />
  );
}
