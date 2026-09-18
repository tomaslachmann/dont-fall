import { Navigate, Outlet } from "react-router";
import { useAccount } from "../lib/hooks/useAccount.js";
import { useTrackArt } from "../lib/hooks/useTrackArt.js";
import { LoadingScreen } from "../screens/LoadingScreen.js";
import GlobalAlerts from "./GlobalAlerts.js";

/**
 * Wraps every route that requires a logged-in Account (ADR 0052: mandatory,
 * app-wide, no guest path — this explicitly includes `/play?freeroam=1`
 * Practice). A React Router layout route: mounted once for the whole authed
 * subtree, so the session check runs once per app load, not per navigation.
 *
 * Once signed in, it also holds the app until every Track's name and picture
 * is loaded (ADR 0105), so no screen after it ever shows a Track half-built.
 */
export function AuthGate() {
  const { status } = useAccount();
  const trackArtReady = useTrackArt(status === "authed");

  if (status === "checking") return <LoadingScreen label="CHECKING YOUR SESSION…" />;

  if (status === "unauthed") return <Navigate to="/auth" replace />;

  if (!trackArtReady) return <LoadingScreen label="LOADING TRACKS…" />;

  // The global overlay stack lives here, above the whole authed subtree —
  // flash messages and the sticky friend/Lobby-invite alerts stay visible
  // across navigation instead of belonging to one Screen.
  return (
    <>
      <Outlet />
      <GlobalAlerts />
    </>
  );
}
