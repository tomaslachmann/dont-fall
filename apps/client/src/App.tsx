import { Route, Routes, useNavigate, useSearchParams } from "react-router";
import { MainMenuScreen } from "./screens/MainMenuScreen";
import { GameCanvas } from "./game/GameCanvas";

/**
 * `/play` — the only place `<GameCanvas>` mounts, so leaving it always
 * tears the game down. `?track=` (Track Builder's own Playtest link,
 * opened straight at this route) selects a specific Track; absent for an
 * ordinary Player, who connects to whatever the server chose.
 */
function PlayRoute() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const trackId = searchParams.get("track") ?? undefined;
  return <GameCanvas {...(trackId === undefined ? {} : { trackId })} onExit={() => navigate("/")} />;
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
