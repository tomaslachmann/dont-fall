import { Route, Routes, useNavigate, useSearchParams } from "react-router";
import { MainMenuScreen } from "./screens/MainMenuScreen";
import { GameCanvas } from "./components/GameCanvas";

/**
 * `/play` query params (m8.1 ticket 01): `?track=` selects a specific Track
 * (Track Builder's own Playtest link, opened straight at this route; absent
 * for an ordinary Player, who connects to whatever the server chose) and
 * `?freeroam=1` boots a local practice session instead of a Match — one
 * route, explicit param, bookmarkable. Pure so tests can pin the
 * practice-vs-match choice without mounting a router.
 */
export const parsePlayParams = (searchParams: URLSearchParams): { trackId?: string; practice: boolean } => {
  const trackId = searchParams.get("track") ?? undefined;
  return {
    ...(trackId === undefined ? {} : { trackId }),
    practice: searchParams.get("freeroam") === "1",
  };
};

/**
 * `/play` — the only place `<GameCanvas>` mounts, so leaving it always
 * tears the game down.
 */
function PlayRoute() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { trackId, practice } = parsePlayParams(searchParams);
  return (
    <GameCanvas
      {...(trackId === undefined ? {} : { trackId })}
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
 */
export function App() {
  return (
    <Routes>
      <Route path="/" element={<MainMenuScreen />} />
      <Route path="/play" element={<PlayRoute />} />
    </Routes>
  );
}
