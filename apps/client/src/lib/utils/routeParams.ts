/**
 * Route query params, kept pure so the "which screen, which connection"
 * decisions are testable without a router.
 */

/**
 * `/play` query params (m8.1 ticket 01): `?track=` selects a specific Track
 * (Track Builder's own Playtest link, opened straight at this route; absent
 * for an ordinary Player, who connects to whatever the server chose) and
 * `?freeroam=1` boots a local practice session instead of a Match — one
 * route, explicit param, bookmarkable.
 */
export const parsePlayParams = (searchParams: URLSearchParams): { trackId?: string; practice: boolean } => {
  const trackId = searchParams.get("track") ?? undefined;
  return {
    ...(trackId === undefined ? {} : { trackId }),
    practice: searchParams.get("freeroam") === "1",
  };
};

/**
 * `/lobby` query params (ADR 0054): `?port=` names the Lobby the broker sent
 * this Player to — every brokered Lobby binds an ephemeral port, so without
 * one there is nothing to connect to — and `?code=` carries the join code a
 * private Lobby was created with, purely so the Lobby Screen can show it.
 * `?id=` is the broker's id for the Lobby — what an invite to a public one
 * names (ADR 0110).
 */
export const parseLobbyParams = (searchParams: URLSearchParams): { port?: number; code?: string; id?: string } => {
  const rawPort = searchParams.get("port");
  const port = rawPort !== null && /^\d+$/.test(rawPort) ? Number(rawPort) : undefined;
  const code = searchParams.get("code") ?? undefined;
  const id = searchParams.get("id") ?? undefined;
  return {
    ...(port === undefined ? {} : { port }),
    ...(code === undefined ? {} : { code }),
    ...(id === undefined ? {} : { id }),
  };
};
