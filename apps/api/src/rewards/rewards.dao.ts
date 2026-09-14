import { and, eq } from "drizzle-orm";
import type { ApiDb } from "../db/db.js";
import { rewardClaims } from "../db/schema.js";

export interface RewardClaimRow {
  gainedXp: number;
  gainedCoins: number;
  xpBefore: number;
  xpAfter: number;
  coinsBefore: number;
  coinsAfter: number;
}

/** The stored numbers of an already-banked claim — `undefined` when this Account never claimed this Match. */
export const getRewardClaim = (
  db: ApiDb,
  accountId: string,
  matchId: string,
): RewardClaimRow | undefined => {
  const row = db
    .select({
      gainedXp: rewardClaims.gainedXp,
      gainedCoins: rewardClaims.gainedCoins,
      xpBefore: rewardClaims.xpBefore,
      xpAfter: rewardClaims.xpAfter,
      coinsBefore: rewardClaims.coinsBefore,
      coinsAfter: rewardClaims.coinsAfter,
    })
    .from(rewardClaims)
    .where(and(eq(rewardClaims.accountId, accountId), eq(rewardClaims.matchId, matchId)))
    .get();
  return row ?? undefined;
};

/** Records a banked claim so its replay is exact numbers, never a second credit. */
export const insertRewardClaim = (
  db: ApiDb,
  accountId: string,
  matchId: string,
  claim: RewardClaimRow,
  nowMs: number,
): void => {
  db.insert(rewardClaims).values({ accountId, matchId, ...claim, claimedAtMs: nowMs }).run();
};
