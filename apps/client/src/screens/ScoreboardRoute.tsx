import { Navigate, useLocation, useNavigate } from "react-router";
import type { StandingRowView } from "../lib/matchView.js";
import Scoreboard from "./Scoreboard.js";

interface ScoreboardLocationState {
  rows?: StandingRowView[];
  title?: string;
}

/**
 * `/scoreboard` — the full table behind both SCOREBOARD buttons
 * (BetweenRounds, MatchOver). Rows ride route state from the overlay that
 * already built them; a direct visit with no state has nothing to show and
 * goes home. BACK returns wherever the Player came from.
 */
export function ScoreboardRoute() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = (location.state ?? {}) as ScoreboardLocationState;

  if (!state.rows || state.rows.length === 0) return <Navigate to="/" replace />;
  return (
    <Scoreboard
      rows={state.rows}
      {...(state.title === undefined ? {} : { title: state.title })}
      onBack={() => navigate(-1)}
    />
  );
}
