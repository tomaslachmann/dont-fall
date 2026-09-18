import { Navigate, useNavigate, useParams, useSearchParams } from "react-router";
import { skinForPlayerId } from "../lib/avatarSkins.js";
import { ordinal, toMatchResultsView } from "../lib/matchView.js";
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
 * `?me=` names whose page this is (the socket-bound player id, cosmetic —
 * it only picks the "you" line and the claim rows). Without it, or for an
 * id that never raced, the page still shows the podium and the table, just
 * no personal line and no COLLECT.
 */
export function MatchResultsRoute() {
  const navigate = useNavigate();
  const { matchId } = useParams();
  const [searchParams] = useSearchParams();
  const me = searchParams.get("me") ?? undefined;
  const { result, error, isPending, retry } = useMatchResult(matchId);

  if (matchId === undefined) return <Navigate to="/" replace />;
  if (isPending || result === null) {
    if (error !== null) {
      if (error.status === 404) {
        return <NotFound path={`/match/${matchId}`} onHome={() => navigate("/")} onDiscover={() => navigate("/play")} />;
      }
      return (
        <ErrorScreen
          kind="crash"
          detail={error.message}
          retryIn={0}
          onRetry={retry}
          onHome={() => navigate("/")}
        />
      );
    }
    return <LoadingScreen label="LOADING RESULTS…" />;
  }

  const view = toMatchResultsView(result, me);
  const champion = view.table[0];
  if (champion === undefined) {
    return <NotFound path={`/match/${matchId}`} onHome={() => navigate("/")} onDiscover={() => navigate("/play")} />;
  }
  const mine = me === undefined ? undefined : view.table.find((row) => row.id === me);
  const spectating = mine === undefined || view.myStats === null;

  // Poses are positional, matching the screen's own celebration/sulk/shrug —
  // the fallback caption and the performance agree by construction.
  const POSES = ["WINNER CELEBRATION LOOP", "SULK POSE", "SHRUG POSE"];

  return (
    <MatchOver
      podium={view.table.slice(0, 3).map((row, i) => ({ name: row.nickname, points: row.score, pose: POSES[i] ?? "", color: row.color, skin: row.skin, hat: row.hat })) as [
        PodiumPlace,
        ...PodiumPlace[],
      ]}
      rounds={result.results.length}
      you={
        mine === undefined
          ? { place: ordinal(champion.placement), points: champion.score, skin: skinForPlayerId(champion.id) }
          : { place: ordinal(mine.placement), points: mine.score, skin: skinForPlayerId(mine.id) }
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
      onCollect={() => navigate("/rewards", { state: { matchId, rounds: view.myRounds } })}
      onScoreboard={() => navigate("/scoreboard", { state: { rows: view.scoreboard, title: "FINAL STANDINGS" } })}
      onSkip={() => navigate("/")}
    />
  );
}
