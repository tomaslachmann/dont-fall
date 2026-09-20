/**
 * A Party code's SHARE LINK (ADR 0112): `/party/<code>`, which joins that
 * Party after signing in. The link itself, and the hold that carries it
 * across a sign-in — the app has no return-to of its own, and a Discord
 * sign-in leaves the page entirely, so the code waits in this tab's
 * `sessionStorage` (the one place a round trip to Discord and back keeps).
 */
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { PARTY_CODE_TTL_MS } from "@dont-fall/shared";
import type { AuthStatus } from "../hooks/useAccount.js";
import { publicUrl } from "../publicUrl.js";

/** The route a SHARE LINK opens, under the router's basename. */
export const partyLinkPath = (code: string): string => `/party/${encodeURIComponent(code)}`;

/**
 * The SHARE LINK to copy: this app's own `/party/<code>`, absolute, under
 * whatever base the page is served from (ADR 0107 — `/` locally and in
 * Docker, `/<repo>/` on Pages), so it opens the game wherever it was copied.
 */
export const partyShareUrl = (code: string, page: string = location.href): string =>
  new URL(publicUrl(partyLinkPath(code)), page).toString();

const PARTY_LINK_ROUTE = /^\/party\/([^/]+)\/?$/;
const HELD_KEY = "df_party_link";

/**
 * Keeps a SHARE LINK's code for after signing in — a signed-out visitor
 * lands on `/auth`, not on the link. Anything else is not held. Storage
 * refused (a private window, blocked site data) just means the link does not
 * survive the sign-in.
 */
export const holdPartyLink = (pathname: string, nowMs: number = Date.now()): void => {
  const match = PARTY_LINK_ROUTE.exec(pathname);
  if (!match) return;
  try {
    sessionStorage.setItem(HELD_KEY, JSON.stringify({ code: decodeURIComponent(match[1]!), heldAt: nowMs }));
  } catch {
    // Nowhere to keep it — see above.
  }
};

/**
 * The held code, once — taking it forgets it. `null` for none, and for one
 * held longer than a Party code works: a sign-in hours later must not join a
 * Party nobody offered any more.
 */
export const takeHeldPartyLink = (nowMs: number = Date.now()): string | null => {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(HELD_KEY);
    sessionStorage.removeItem(HELD_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const held = JSON.parse(raw) as { code?: unknown; heldAt?: unknown };
    if (typeof held.code !== "string" || typeof held.heldAt !== "number") return null;
    return nowMs - held.heldAt < PARTY_CODE_TTL_MS ? held.code : null;
  } catch {
    return null;
  }
};

/**
 * `<AuthGate>`'s half of the SHARE LINK: holds the link's code while the
 * visitor is sent to sign in, and once they are in (and the app is past its
 * loading hold) sends them back to `/party/<code>` to join.
 */
export const useHeldPartyLink = (status: AuthStatus, ready: boolean): void => {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (status === "unauthed") holdPartyLink(pathname);
  }, [status, pathname]);
  useEffect(() => {
    if (status !== "authed" || !ready) return;
    const code = takeHeldPartyLink();
    if (code !== null) navigate(partyLinkPath(code), { replace: true });
  }, [status, ready, navigate]);
};
