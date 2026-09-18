import { pickServerOrigin } from "@dont-fall/shared";

/** The game's own key (`apps/client/src/lib/serverOrigin.ts`): on Pages the two share an origin, so one `?server=` sets both. */
const STORAGE_KEY = "df_server";

/**
 * The API this builder talks to when it is not on this machine (ADR 0107) —
 * the builder on GitHub Pages, the API in a Codespace. The same rules as the
 * game's: a `?server=` sets and remembers it, else what was remembered, else
 * the build's `VITE_SERVER_URL`. `undefined` keeps the local default.
 */
export const serverOrigin = (): string | undefined => {
  const query = typeof location === "undefined" ? null : new URLSearchParams(location.search).get("server");
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    // No storage: only the URL and the build decide.
  }
  const { origin, store } = pickServerOrigin({
    query,
    stored,
    buildDefault: import.meta.env.VITE_SERVER_URL,
    ...(typeof location === "undefined" ? {} : { pageOrigin: location.origin }),
  });
  if (store !== undefined) {
    try {
      if (store === null) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, store);
    } catch {
      // Remembering is a convenience.
    }
  }
  return origin;
};

/** The game, for Playtest: its own dev server locally, `/<repo>/` beside this builder on Pages (`VITE_CLIENT_URL`). */
export const clientAppUrl = (): string =>
  import.meta.env.VITE_CLIENT_URL ?? `http://${globalThis.location?.hostname ?? "localhost"}:5173/`;
