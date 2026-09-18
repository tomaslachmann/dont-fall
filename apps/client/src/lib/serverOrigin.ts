import { pickServerOrigin } from "@dont-fall/shared";

const STORAGE_KEY = "df_server";

/**
 * The server this page plays against when it is not the machine serving the
 * page (ADR 0107) — the game on GitHub Pages, the API in a Codespace. A
 * `?server=<origin>` on any URL sets it for this browser and is remembered, so
 * a deep link or a reload keeps it (an empty `?server=` forgets it);
 * otherwise the build's `VITE_SERVER_URL`. `undefined` is local play: the
 * page's own host on the fixed ports.
 *
 * The Track builder reads the same key, on the same origin.
 */
export const serverOrigin = (): string | undefined => {
  const query = typeof location === "undefined" ? null : new URLSearchParams(location.search).get("server");
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    // No storage here (a test, a locked-down browser): only the URL and the build decide.
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
      // Remembering is a convenience: the link carries it again next time.
    }
  }
  return origin;
};
