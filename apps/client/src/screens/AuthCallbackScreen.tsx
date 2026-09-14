import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { Screen } from "@dont-fall/ui";
import { parseAuthCallbackFragment } from "../lib/api/auth.js";
import { setStoredToken } from "../lib/api/base.js";
import styles from "./AuthCallbackScreen.module.css";

/**
 * `/auth/callback` — where the API's Discord OAuth callback redirects
 * the browser back to (M9 ticket 11, ADR 0052/0053). Reads the URL
 * *fragment* (`index.ts`: `#token=...` / `#linked=discord` / `#error=...`),
 * never a query param — see `index.ts`'s own comment for why. Read through
 * `useLocation()`, not the global `window.location`, so this works
 * identically under a real `BrowserRouter` and a test's `MemoryRouter`.
 */
export function AuthCallbackScreen() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const { token, error } = parseAuthCallbackFragment(location.hash);

    if (token) {
      setStoredToken(token);
      // `replace: true`, not a plain navigate: this landing page — and the
      // bearer token that was briefly in its address bar — has no business
      // staying one "back" away in history.
      navigate("/", { replace: true });
      return;
    }
    // `linked=discord` (a successful link onto an *already* logged-in
    // session) and any `error` both land back on `/auth` — there is no
    // "linked" Screen of its own yet (ties into ticket 07/Profile, where
    // linking is initiated from); the error message itself is what
    // `AuthScreen` reads off `?error=`.
    navigate(error ? `/auth?error=${encodeURIComponent(error)}` : "/auth", { replace: true });
  }, [location.hash, navigate]);

  return (
    <Screen>
      <div className={styles.wait} role="status">
        Signing you in…
      </div>
    </Screen>
  );
}
