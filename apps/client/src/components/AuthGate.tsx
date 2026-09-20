import { Navigate, Outlet } from "react-router";
import { useAccount } from "../lib/hooks/useAccount.js";
import { useTrackArt } from "../lib/hooks/useTrackArt.js";
import { useAccountSocket } from "../lib/social/accountSocket.js";
import { useHeldPartyLink } from "../lib/social/partyLink.js";
import { usePlaceReporting, useVoiceBelongsHere } from "../lib/social/place.js";
import { useVoiceSession } from "../lib/hooks/useVoiceSession.js";
import { resolveEffectiveBindings } from "../lib/bindingsStore.js";
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
 *
 * It owns the Account socket's lifetime too (ADR 0112): open while signed in
 * and past that hold, closed when the Player signs out (leaving for `/auth`
 * unmounts this gate), and told where the Player is on every route.
 */
export function AuthGate() {
  const { status, account } = useAccount();
  const trackArtReady = useTrackArt(status === "authed");
  // Opened in the same commit that mounts <GlobalAlerts> — whose listener
  // must be there before a `follow` can arrive. Its effects run first, being
  // a child's.
  useAccountSocket(status === "authed" && trackArtReady ? (account?.id ?? null) : null);
  usePlaceReporting();
  // Voice chat (ADR 0111) lives here, above the routes, because it lasts from
  // joining a Lobby through every Round to the podium — and the navigation
  // from `/lobby` to `/match/:id` in the middle of that would end anything a
  // Screen owned.
  const voiceBelongsHere = useVoiceBelongsHere();
  useVoiceSession(status === "authed" && trackArtReady && voiceBelongsHere, () =>
    resolveEffectiveBindings(account ?? null),
  );
  // A Party's SHARE LINK opened signed out joins once signed in (ADR 0112).
  useHeldPartyLink(status, trackArtReady);

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
