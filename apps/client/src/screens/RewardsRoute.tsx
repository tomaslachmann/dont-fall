import { useEffect, useRef, useState } from "react";
import { lobbyPath, quickMatch } from "../lib/api/lobbyBroker.js";
import { Navigate, useLocation, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { hatsUnlockedBetween, levelForXp, xpBarFractions, xpForRoundScore } from "@dont-fall/shared";
import { saveCosmetics } from "../lib/api/auth.js";
import { claimRewards, type RewardsClaim } from "../lib/api/rewards.js";
import { flash } from "../lib/flash.js";
import { hatIconUrl } from "../lib/hatAssets.js";
import { useAccount } from "../lib/hooks/useAccount.js";
import { useAsyncError } from "../lib/hooks/useAsyncError.js";
import { useParty } from "../lib/social/accountSocket.js";
import { queueBlockedReason } from "../lib/social/partyGate.js";
import { ordinal } from "../lib/matchView.js";
import { LoadingScreen } from "./LoadingScreen.js";
import Rewards from "./Rewards.js";

interface RewardsLocationState {
  matchId?: string;
}

/**
 * `/rewards` — MatchOver's COLLECT lands here with the Match id as route
 * state. The server finds your Rounds in the stored Match and pays on them
 * (ADR 0110); the claim is idempotent per `matchId` (ADR 0059), so a remount
 * replays the stored numbers instead of crediting again. The guard below
 * still dedupes the in-flight call itself (StrictMode-safe: refs survive its
 * double-effect).
 *
 * The breakdown is the Rounds the server paid on, so "what the screen
 * promised" and "what landed" agree by construction. Coins split into the
 * Match's and, when there were any, what your bets won (BET WON).
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
  const { account } = useAccount();
  // PLAY AGAIN takes the Party along (ADR 0112): the host's call, once every
  // member has left their own results.
  const playAgainBlocked = queueBlockedReason(useParty());
  const queryClient = useQueryClient();
  useEffect(() => {
    if (matchId === undefined || claimedRef.current) return;
    claimedRef.current = true;
    claimRewards(matchId).then(setClaim, throwAsync);
  }, [matchId, throwAsync]);

  if (matchId === undefined) return <Navigate to="/" replace />;
  if (claim === null) return <LoadingScreen label="COUNTING YOUR BEANS…" />;

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
      color={account?.color ?? null}
      skin={account?.skin ?? null}
      hat={account?.hat ?? null}
      unlock={unlocked?.name}
      unlockIcon={unlocked && hatIconUrl(unlocked.id)}
      onEquip={unlocked && account?.hat !== unlocked.id ? () => equip(unlocked.id) : undefined}
      level={levelForXp(claim.xpAfter)}
      {...(unlocked ? { unlockLevel: unlocked.unlockLevel } : {})}
      xpGain={claim.gainedXp}
      xpBefore={fractions.before}
      xpEarned={fractions.earned}
      breakdown={claim.rounds.map((row, i) => [`ROUND ${i + 1} · ${ordinal(row.placement)} PLACE`, xpForRoundScore(row.score)])}
      beans={claim.gainedCoins + claim.betWinnings}
      beansSplit={[["MATCH", claim.gainedCoins], ...(claim.betWinnings > 0 ? [["BET WON", claim.betWinnings] as [string, number]] : [])]}
      // PLAY AGAIN goes straight into the next Match; BACK TO LOBBY is the
      // choice of Lobby — the one this Match ran in closed with it (ADR 0059).
      playAgainBlocked={playAgainBlocked}
      onPlayAgain={() => {
        quickMatch()
          .then((lobby) => navigate(lobbyPath(lobby)))
          .catch((err: unknown) => {
            flash(`Couldn't find a Match: ${err instanceof Error ? err.message : String(err)}`, "error");
            navigate("/play");
          });
      }}
      onLobby={() => navigate("/play")}
    />
  );
}
