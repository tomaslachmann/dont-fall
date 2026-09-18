import { STATUS_CODES, type IncomingMessage } from "node:http";
import { connect } from "node:net";
import type { Duplex } from "node:stream";
import { parseMatchSocketPath } from "@dont-fall/shared";

/**
 * A Lobby's Match-server WebSocket through the API's own address (ADR 0107).
 * Online there is one public address (a Codespace's forwarded port), and
 * every Lobby listens on a port of its own (ADR 0054), so the API takes the
 * upgrade at `/match/<port>`, replays the handshake to that port on
 * localhost, and pipes the two sockets together. The Match server sees an
 * ordinary connection to `/`, with the Playtest `?track=` still on it.
 *
 * Only a port a live Lobby holds is ever dialled (`isLobbyPort`), so this is
 * not a way onto anything else the machine listens on.
 */
export const proxyMatchSockets =
  (isLobbyPort: (port: number) => boolean) =>
  (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    const target = parseMatchSocketPath(req.url ?? "");
    if (!target || !isLobbyPort(target.port)) {
      refuse(socket, 404);
      return;
    }
    const upstream = connect(target.port, "127.0.0.1", () => {
      const lines = [`${req.method ?? "GET"} /${target.search} HTTP/${req.httpVersion}`];
      for (let i = 0; i + 1 < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (head.length > 0) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    const closeBoth = (): void => {
      upstream.destroy();
      socket.destroy();
    };
    upstream.on("error", () => (upstream.connecting ? refuse(socket, 502) : closeBoth()));
    socket.on("error", closeBoth);
    upstream.on("close", () => socket.destroy());
    socket.on("close", () => upstream.destroy());
  };

const refuse = (socket: Duplex, status: number): void => {
  if (socket.destroyed) return;
  socket.end(`HTTP/1.1 ${status} ${STATUS_CODES[status]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
};
