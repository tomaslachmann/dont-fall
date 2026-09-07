import type { ServerMessage } from "@dont-fall/shared";
import type { WebSocket } from "ws";


/**
 * A WebSocket close reason is capped at 123 UTF-8 bytes (RFC 6455) — `ws`
 * throws if handed more. Truncating defensively here means a future longer
 * message (a longer trackId, a longer underlying fetch error) degrades
 * gracefully instead of crashing the connection handler outright.
 */
const CLOSE_REASON_MAX_BYTES = 123;
export const truncateForCloseReason = (reason: string): string => {
  // Pops whole Unicode code points, not UTF-16 code units (code review) —
  // `.slice(0, -1)` on the raw string can cut a surrogate pair in half,
  // turning a multi-byte character right at the boundary into a lone
  // surrogate that re-encodes as U+FFFD instead of truncating cleanly.
  const codePoints = Array.from(reason);
  while (Buffer.byteLength(codePoints.join(""), "utf8") > CLOSE_REASON_MAX_BYTES) codePoints.pop();
  return codePoints.join("");
};



/**
 * Send to one client, swallowing any failure. A socket can drop between a
 * `readyState` check and the write, and `ws` then throws synchronously or emits
 * `'error'` — neither may escape the tick loop or the connection handler and
 * take the Match down for everyone else (ADR 0011). The `'close'` handler does
 * the cleanup regardless.
 */
export const trySend = (socket: WebSocket, payload: string): void => {
  try {
    socket.send(payload);
  } catch {
    // dropped mid-write — 'close' will clean up
  }
};

export const send = (socket: WebSocket, message: ServerMessage): void => {
  trySend(socket, JSON.stringify(message));
};
