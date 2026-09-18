import type { RequestListener } from "node:http";
import type { MatchRuntime } from "../match/matchRuntime.js";

/**
 * `GET /status`, sharing the WebSocket's own port (grilling session, 2026-09).
 *
 * The lobby broker's only way to know this Match's live occupancy and phase
 * without joining it as a Player, and (M9 ticket 11 phase 2b) who is in it,
 * for friends presence. Everything else this server does is the WebSocket
 * protocol; this exists purely so something outside the Match can poll it.
 *
 * Account ids are identifiers, not credentials, and this port only ever
 * answers localhost. Anonymous seats are omitted rather than reported as null.
 */
export const createStatusHandler = (rt: MatchRuntime): RequestListener => (req, res) => {
  if (req.method !== "GET" || req.url !== "/status") {
    res.writeHead(404);
    res.end();
    return;
  }
  const inRound = rt.match.phase === "COUNTDOWN" || rt.match.phase === "RUNNING" || rt.match.phase === "ROUND_END";
  const body = JSON.stringify({
    playerCount: rt.sockets.size,
    maxPlayers: rt.config.maxPlayers,
    phase: rt.match.phase,
    round: inRound ? rt.roundResults.length + 1 : null,
    accounts: [...rt.lobbyPlayers.values()].flatMap((p) => (p.accountId === null ? [] : [p.accountId])),
  });
  res.writeHead(200, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
};
