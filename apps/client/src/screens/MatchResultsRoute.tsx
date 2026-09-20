import { Navigate, useNavigate, useParams, useSearchParams } from "react-router";
import { DEFAULT_VICTORY_POSE, emoteById } from "@dont-fall/shared";
import { avatarLook } from "../lib/avatar.js";
import { ordinal, toMatchResultsView } from "../lib/matchView.js";
import { useAccount } from "../lib/hooks/useAccount.js";
import { useSupportCode } from "../lib/hooks/useSupportCode.js";
import { useMatchResult } from "../lib/hooks/useMatchResult.js";
import type { PodiumPlace } from "./MatchOver.js";
import ErrorScreen from "./ErrorScreen.js";
import { LoadingScreen } from "./LoadingScreen.js";
import MatchOver from "./MatchOver.js";
import NotFound from "./NotFound.js";

/**
 * `/match/:matchId` — the post-Match results page (ADR 0059). The game
 * navigates here on `matchOver` and unmounts behind it (canvas, physics,
 * socket — all torn down); everything this renders comes from one API fetch,
 * so a refresh shows the same Match instead of losing it.
 *
 * Whose page this is: the seat the signed-in Account raced in, off the
 * stored Match (ADR 0110), or `?me=` (the socket-bound player id) for a seat
 * that had no Account. It only picks the "you" line — what COLLECT pays is the
 * server's own lookup. For a viewer who never raced, the page still shows the
 * podium and the table, just no personal line and no COLLECT.
 */
export function MatchResultsRoute() {
  const navigate = useNavigate();
  const { matchId } = useParams();
  const [searchParams] = useSearchParams();
  const { account } = useAccount();
  const { result, error, isPending, retry } = useMatchResult(matchId);
  const supportCode = useSupportCode("crash", error !== null && error.status !== 404 ? error.message : null);

  if (matchId === undefined) return <Navigate to="/" replace />;
  if (isPending || result === null) {
    if (error !== null) {
      if (error.status === 404) {
        return <NotFound path={`/match/${matchId}`} onHome={() => navigate("/")} onDiscover={() => navigate("/play")} />;
      }
      return (
        <ErrorScreen
          kind="crash"
          {...(supportCode === undefined ? {} : { code: supportCode })}
          detail={error.message}
          retryIn={0}
          onRetry={retry}
          onHome={() => navigate("/")}
        />
      );
    }
    return <LoadingScreen label="LOADING RESULTS…" />;
  }

  const accountSeat =
    account === null ? undefined : Object.entries(result.accountIds ?? {}).find(([, owner]) => owner === account.id)?.[0];
  const me = accountSeat ?? searchParams.get("me") ?? undefined;
  const view = toMatchResultsView(result, me);
  const champion = view.table[0];
  if (champion === undefined) {
    return <NotFound path={`/match/${matchId}`} onHome={() => navigate("/")} onDiscover={() => navigate("/play")} />;
  }
  const mine = me === undefined ? undefined : view.table.find((row) => row.id === me);
  const spectating = mine === undefined || view.myStats === null;

  // Poses are positional, matching the screen's own celebration/sulk/shrug —
  // the fallback caption and the performance agree by construction. The
  // winner celebrates with the victory pose its Account picked (ADR 0110).
  const championPose = (result.victoryPoses ?? {})[champion.id] ?? DEFAULT_VICTORY_POSE;
  const POSES = [`VICTORY POSE · ${emoteById(championPose)?.name ?? championPose.toUpperCase()}`, "SULK POSE", "SHRUG POSE"];

  return (
    <MatchOver
      podium={view.table.slice(0, 3).map((row, i) => ({
        name: row.nickname,
        points: row.score,
        pose: POSES[i] ?? "",
        color: row.color,
        skin: row.skin,
        hat: row.hat,
        ...(i === 0 ? { victoryPose: championPose } : {}),
      })) as [
        PodiumPlace,
        ...PodiumPlace[],
      ]}
      rounds={result.results.length}
      you={
        mine === undefined
          ? { place: ordinal(champion.placement), points: champion.score, look: avatarLook(champion.accountId, champion.color) }
          : { place: ordinal(mine.placement), points: mine.score, look: avatarLook(mine.accountId, mine.color) }
      }
      stats={
        view.myStats === null
          ? []
          : [
              ["ROUND WINS", String(view.myStats.wins)],
              ["FALLS", String(view.myStats.falls)],
              ["BEST", ordinal(view.myStats.best)],
            ]
      }
      gapNote={
        mine === undefined
          ? ""
          : champion.score - mine.score <= 0
            ? "TIED AT THE TOP"
            : `${champion.score - mine.score} POINTS OFF THE CROWN`
      }
      spectator={spectating}
      onCollect={() => navigate("/rewards", { state: { matchId } })}
      onScoreboard={() => navigate("/scoreboard", { state: { rows: view.scoreboard, title: "FINAL STANDINGS" } })}
      onSkip={() => navigate("/")}
    />
  );
}
