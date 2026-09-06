import {
  DEFAULT_SERVER_PORT,
  DEFAULT_TRACK_SERVICE_PORT,
  type ServerMessage,
  type WelcomeMessage,
} from "@dont-fall/shared";
import { listen, type ListenerTarget } from "./listeners.js";

/** Where this client's two backends live — both derived from the host serving the page. */
export interface Endpoints {
  /** The Match server's WebSocket, carrying the Playtest `?track=` when there is one. */
  matchServerUrl: string;
  /** track-service's HTTP origin, for fetching the exact Revision the Match server named. */
  trackServiceUrl: string;
}

/**
 * `trackId` is Track Builder's Playtest button (ADR 0028): forwarded onto the
 * Match server connection so it loads that exact Track instead of whatever it
 * already fetched at boot. Absent for an ordinary player, who connects exactly
 * as before.
 */
export const resolveEndpoints = (host: string, trackId?: string): Endpoints => {
  const matchServerUrl = new URL(`ws://${host}:${DEFAULT_SERVER_PORT}`);
  if (trackId) matchServerUrl.searchParams.set("track", trackId);
  return {
    matchServerUrl: matchServerUrl.toString(),
    trackServiceUrl: `http://${host}:${DEFAULT_TRACK_SERVICE_PORT}`,
  };
};

/**
 * Wait for the Match server's one-time `welcome` (ADR 0024) — it names the
 * exact trackId + Revision the server fetched from track-service (ADR
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
