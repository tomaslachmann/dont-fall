import { Route, Routes, useLocation, useNavigate, useSearchParams } from "react-router";
import { AuthCallbackScreen } from "./screens/AuthCallbackScreen";
import { AuthScreen } from "./screens/AuthScreen";
import { AuthGate } from "./components/AuthGate";
import { GameCanvas } from "./components/GameCanvas";
import { parsePlayParams } from "./lib/utils/routeParams.js";
import { DiscoverRoute } from "./screens/DiscoverRoute.js";
import { FriendsRoute } from "./screens/FriendsRoute.js";
import MainMenu from "./screens/MainMenu";
import { MatchResultsRoute } from "./screens/MatchResultsRoute";
import NotFound from "./screens/NotFound";
import { RewardsRoute } from "./screens/RewardsRoute";
import { ScoreboardRoute } from "./screens/ScoreboardRoute";
import { LobbyRoute } from "./screens/LobbyRoute.js";
import PlaySelect from "./screens/PlaySelect";
import Settings from "./screens/Settings";

/**
 * `/play` — two residents, split by query param: a `?track=` boots
 * `<GameCanvas>` straight into the game (Track Builder's Playtest link, and
 * `?freeroam=1` practice — m8.1 ticket 01), while a bare `/play` is the
 * broker screen (`PlaySelect`: quick match, private create/join — ADR 0054)
 * that sends the Player on to `/lobby?port=`. Leaving the canvas always
 * tears the game down.
 */
function PlayRoute() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { trackId, practice } = parsePlayParams(searchParams);
  if (trackId === undefined) return <PlaySelect />;
  return (
    <GameCanvas
      trackId={trackId}
      {...(practice ? { practice: true as const } : {})}
      onExit={() => navigate("/")}
      onMatchEnd={() => navigate("/")}
    />
  );
}

/**
 * The app shell (ADR 0008, M4 ticket 06): React owns routing, the game loop
 * never runs through it. Does not include the router itself — main.tsx
 * supplies `<BrowserRouter>`, tests supply `<MemoryRouter>`.
 *
 * `/auth` and `/auth/callback` are the only routes reachable without a
 * session — everything else sits behind `<AuthGate>` (ADR 0052: mandatory
 * login, app-wide, including `/play?freeroam=1` Practice; ADR 0053 added
 * email/password alongside Discord OAuth).
 */
/**
 * The catch-all — every URL that matches no route lands here, authed or
 * not. Deliberately outside `<AuthGate>`: a mistyped URL is not a missing
 * session, and bouncing a logged-out Player to login for a typo hides the
 * actual problem. Shows the attempted path back, routes home from there.
 */
function NotFoundRoute() {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  return <NotFound path={pathname + search} onHome={() => navigate("/")} onDiscover={() => navigate("/discover")} />;
}

export function App() {
  return (
    <Routes>
      <Route path="/auth" element={<AuthScreen />} />
      <Route path="/auth/callback" element={<AuthCallbackScreen />} />
      <Route path="*" element={<NotFoundRoute />} />
      <Route element={<AuthGate />}>
        <Route path="/" element={<MainMenu />} />
        <Route path="/discover" element={<DiscoverRoute />} />
        <Route path="/friends" element={<FriendsRoute />} />
        <Route path="/play" element={<PlayRoute />} />
        <Route path="/lobby" element={<LobbyRoute />} />
        <Route path="/match/:matchId" element={<MatchResultsRoute />} />
        <Route path="/scoreboard" element={<ScoreboardRoute />} />
        <Route path="/rewards" element={<RewardsRoute />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
