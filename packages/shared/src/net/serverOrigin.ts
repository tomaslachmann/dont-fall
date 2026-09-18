/**
 * Where a page's server is, when it is not the machine serving the page (ADR
 * 0107): the game and the builder on GitHub Pages, the API somewhere else. The
 * pure half, shared by both apps and by the API's socket proxy; each app reads
 * the browser (query, storage, build env) in its own few lines.
 */

/** The path the API proxies a Lobby's Match-server WebSocket under: `/match/<port>`. */
export const MATCH_SOCKET_PATH_PREFIX = "/match/";

export const matchSocketPath = (port: number): string => `${MATCH_SOCKET_PATH_PREFIX}${port}`;

/**
 * The Lobby port a request path names, and the query it carries on to the
 * Match server (the Playtest `?track=`), or `undefined` for any other path.
 */
export const parseMatchSocketPath = (url: string): { port: number; search: string } | undefined => {
  const match = /^\/match\/(\d{1,5})\/?(\?.*)?$/.exec(url);
  if (!match) return undefined;
  const port = Number(match[1]);
  if (port < 1 || port > 65535) return undefined;
  return { port, search: match[2] ?? "" };
};

/**
 * An `http(s)` URL reduced to the base every API path is appended to — its
 * origin, plus its path when it has one (`https://host/api`), never a trailing
 * slash — or `undefined` for anything else. A path alone (`/api`, ADR 0108)
 * is read against `relativeTo`, the page's own origin, and refused without it.
 */
export const parseServerOrigin = (raw: string | null | undefined, relativeTo?: string): string | undefined => {
  if (!raw) return undefined;
  if (raw.startsWith("/") && relativeTo === undefined) return undefined;
  try {
    const url = new URL(raw, relativeTo);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return undefined;
  }
};

/**
 * Which server a page plays against, and what to remember for next time.
 *
 * A `?server=` on the URL wins and is stored: a usable origin is kept, and an
 * empty or unusable one clears what was kept. Without one, the stored origin
 * applies, then the build's default. `store` is `undefined` when storage is
 * left alone, `null` to clear it.
 */
export const pickServerOrigin = ({
  query,
  stored,
  buildDefault,
  pageOrigin,
}: {
  /** The `server` query parameter, `null` when the URL has none. */
  query: string | null;
  stored: string | null;
  /** The build's `VITE_SERVER_URL`: a URL, or a path on the page's own origin (`/api`, ADR 0108). */
  buildDefault: string | undefined;
  /** The page's own origin, which a path-only build default is read against. */
  pageOrigin?: string;
}): { origin: string | undefined; store?: string | null } => {
  const built = parseServerOrigin(buildDefault, pageOrigin);
  if (query !== null) {
    const origin = parseServerOrigin(query);
    return { origin: origin ?? built, store: origin ?? null };
  }
  return { origin: parseServerOrigin(stored) ?? built };
};
