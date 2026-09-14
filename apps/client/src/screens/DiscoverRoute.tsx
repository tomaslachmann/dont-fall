import { useNavigate } from "react-router";
import { useDiscoverTracks } from "../lib/hooks/useDiscoverTracks.js";
import Discover from "./Discover.js";

/**
 * `/discover` — the standalone Track catalogue (M9 ticket 16), reached from
 * the Main Menu and the 404 page. Browse mode: a card boots Practice on
 * that Track (the Track builder's own Playtest link shape — `?track=` plus
 * `?freeroam=1`), back returns to the menu. The Lobby renders the same
 * catalogue inline instead of linking here, so its own socket stays alive
 * for the pick (see `Lobby.tsx`).
 */
export function DiscoverRoute() {
  const navigate = useNavigate();
  const { tracks, isLoading, error, retry } = useDiscoverTracks();
  return (
    <Discover
      tracks={tracks ?? []}
      isLoading={isLoading}
      error={error}
      onRetry={retry}
      onBack={() => navigate("/")}
      onSelect={(trackId) => navigate(`/play?track=${encodeURIComponent(trackId)}&freeroam=1`)}
    />
  );
}
