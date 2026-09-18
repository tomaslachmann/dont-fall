import { DEFAULT_API_PORT, DEFAULT_SERVER_PORT, matchSocketPath, type ServerMessage, type WelcomeMessage } from "@dont-fall/shared";
import { serverOrigin } from "../serverOrigin.js";
import { listen, type ListenerTarget } from "./listeners.js";

/** Where this client's backends live — all derived from the host serving the page. */
export interface Endpoints {
  /** The Match server's WebSocket, carrying the Playtest `?track=` when there is one. */
  matchServerUrl: string;
  /**
   * The single API's HTTP origin (ADR 0058) — tracks, assets, auth, and
   * lobbies on one port. Replaces the old `trackServiceUrl`/`lobbyBrokerUrl`
   * pair: one process, one origin, no reason for two fields.
   */
  apiUrl: string;
}

export interface EndpointOptions {
  /**
   * Track Builder's Playtest button (ADR 0028): forwarded onto the Match
   * server connection so it loads that exact Track instead of whatever it
   * already fetched at boot. Absent for an ordinary Player.
   */
  trackId?: string;
  /**
   * The port the lobby broker named for this Lobby (ADR 0054). Every Lobby
   * the broker starts binds an ephemeral port, so there is no fixed Match
   * server port to connect to any more — this is how a client reaches the
   * one it was actually sent to.
   *
   * Defaults to {@link DEFAULT_SERVER_PORT}, which is still the standalone
   * Match server `scripts/dev.sh` starts alongside the broker for a quick
   * single-Lobby test that skips Create/Join/Quick Match entirely.
   */
  matchServerPort?: number;
}

export const resolveEndpoints = (host: string, options: EndpointOptions = {}, origin: string | undefined = serverOrigin()): Endpoints => {
  // Online (ADR 0107): everything is one origin, and the API carries a
  // Lobby's socket at `/match/<port>` — the Lobby's own port is not public.
  if (origin !== undefined) {
    const socket = new URL(matchSocketPath(options.matchServerPort ?? DEFAULT_SERVER_PORT), origin);
    socket.protocol = socket.protocol === "https:" ? "wss:" : "ws:";
    if (options.trackId) socket.searchParams.set("track", options.trackId);
    return { matchServerUrl: socket.toString(), apiUrl: origin };
  }
  const matchServerUrl = new URL(`ws://${host}:${options.matchServerPort ?? DEFAULT_SERVER_PORT}`);
  if (options.trackId) matchServerUrl.searchParams.set("track", options.trackId);
  return {
    matchServerUrl: matchServerUrl.toString(),
    apiUrl: `http://${host}:${DEFAULT_API_PORT}`,
  };
};

/**
 * Wait for the Match server's one-time `welcome` (ADR 0024) — it names the
 * exact trackId + Revision the server fetched from the API (ADR
 * 0028/0032), which the client must have before it builds anything
 * Track-shaped. Fetching "latest" independently on each side could otherwise
 * race a publish landing mid-connect and desync this client from what the
 * server is actually running.
 *
 * `error`/`close` are watched here too (and every listener is removed together
 * on settlement) — without them, a connection that fails before ever sending a
 * `welcome` (wrong port, server down, a WS handshake failure) would leave this
 * promise permanently unresolved and the whole page stuck on "connecting…"
 * instead of surfacing a real error (code review, ticket 11).
 */
export const awaitWelcome = (socket: ListenerTarget): Promise<WelcomeMessage> =>
  new Promise<WelcomeMessage>((resolve, reject) => {
    const stops: (() => void)[] = [];
    const settle = (finish: () => void): void => {
      for (const stop of stops) stop();
      finish();
    };

    stops.push(
      listen(socket, "message", (event) => {
        const message = JSON.parse((event as MessageEvent<string>).data) as ServerMessage;
        if (message.type !== "welcome") return;
        settle(() => resolve(message));
      }),
      listen(socket, "error", () => {
        settle(() => reject(new Error("WebSocket connection failed before the server's welcome arrived")));
      }),
      listen(socket, "close", (event) => {
        // A Playtest connection's `?track=` can be refused outright (a clear
        // reason string, no `welcome` ever sent — see `apps/server`'s own
        // `?track=` handling) — surface it here rather than the generic
        // fallback, which would otherwise swallow exactly the message a
        // developer needs to see.
        const { reason } = event as CloseEvent;
        settle(() =>
          reject(
            new Error(
              reason ? `WebSocket closed: ${reason}` : "WebSocket closed before the server's welcome arrived",
            ),
          ),
        );
      }),
    );
  });
