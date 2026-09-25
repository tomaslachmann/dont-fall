import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import { PARTY_MAX_SIZE } from "@dont-fall/shared";
import type { MatchRuntime } from "../match/matchRuntime.js";

/**
 * The Match server's HTTP side, sharing the WebSocket's own port (grilling
 * session, 2026-09): `GET /status` for anyone outside the Match to poll, and
 * `POST /reservations` for the broker to keep seats for a Party walking in
 * (ADR 0112). Everything else this server does is the WebSocket protocol.
 */
export const createStatusHandler = (rt: MatchRuntime): RequestListener => (req, res) => {
  if (req.method === "GET" && req.url === "/status") {
    answerStatus(rt, res);
    return;
  }
  if (req.method === "POST" && req.url === "/reservations") {
    // A handler that throws here would reject inside the API's own process,
    // where every Lobby runs (ADR 0054/0058) — never let it escape.
    answerReservations(rt, req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
    return;
  }
  res.writeHead(404);
  res.end();
};

/** The header `POST /reservations` must carry this server's `reservationSecret` in (ADR 0112). */
export const RESERVATION_SECRET_HEADER = "x-reservation-secret";

/** `POST /reservations`'s body (ADR 0112): the Accounts to keep a seat for, all or none. */
export interface ReservationRequest {
  accountIds: string[];
}

/** `POST /reservations`'s `200` (ADR 0112): each Account's token, for its client's `?reservation=`. */
export interface ReservationGrant {
  reservations: Record<string, string>;
}

/**
 * Far past any real body (at most {@link PARTY_MAX_SIZE} Account ids); a
 * caller sending more is not the broker, and is not read to the end.
 */
const RESERVATION_BODY_MAX_BYTES = 4 * 1024;

/**
 * The lobby broker's only way to know this Match's live occupancy and phase
 * without joining it as a Player, and (M9 ticket 11 phase 2b) who is in it,
 * for friends presence.
 *
 * `playerCount` counts live Reservations too (ADR 0112): a seat kept for a
 * Party member is taken, so the broker's "N SLOTS OPEN" stays honest. So is
 * a Bot's (ADR 0129).
 *
 * Account ids are identifiers, not credentials, and this port only ever
 * answers localhost. Anonymous seats are omitted rather than reported as null.
 */
const answerStatus = (rt: MatchRuntime, res: ServerResponse): void => {
  const inRound = rt.match.phase === "COUNTDOWN" || rt.match.phase === "RUNNING" || rt.match.phase === "ROUND_END";
  answerJson(res, 200, {
    playerCount: rt.seatsTaken(),
    maxPlayers: rt.config.maxPlayers,
    phase: rt.match.phase,
    round: inRound ? rt.roundResults.length + 1 : null,
    accounts: [...rt.lobbyPlayers.values()].flatMap((p) => (p.accountId === null ? [] : [p.accountId])),
  });
};

/**
 * `POST /reservations` (ADR 0112): a seat for each Account, or for none —
 * `MatchRuntime.reserveSeats` decides. Guarded by the secret the API's
 * `LobbiesService` generated for its process; a server started without one
 * has no such route at all, so its answer is the unknown path's 404.
 */
const answerReservations = async (rt: MatchRuntime, req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const secret = rt.config.reservationSecret;
  if (secret === undefined) {
    res.writeHead(404);
    res.end();
    return;
  }
  // Before the body is read: nobody without the secret gets that far.
  if (!secretMatches(secret, req.headers[RESERVATION_SECRET_HEADER])) {
    answerJson(res, 401, { error: "wrong reservation secret" });
    return;
  }
  const body = await readBody(req);
  const accountIds = body === null ? null : parseAccountIds(body);
  if (accountIds === null) {
    answerJson(res, 400, { error: `expected { accountIds } — 1 to ${PARTY_MAX_SIZE} distinct Account ids` });
    return;
  }
  // Nothing awaits from here to the answer, so the grant is decided against
  // the Lobby as it is now: no connection or Tick lands in between.
  const outcome = rt.reserveSeats(accountIds);
  if ("refused" in outcome) {
    answerJson(res, 409, { error: outcome.refused });
    return;
  }
  answerJson(res, 200, { reservations: outcome.granted } satisfies ReservationGrant);
};

/**
 * Constant-time. Both sides are hashed first so they are always the same
 * length, which `timingSafeEqual` requires, and a wrong guess's length says
 * nothing either.
 */
const secretMatches = (expected: string, given: string | string[] | undefined): boolean => {
  if (typeof given !== "string") return false;
  const digest = (value: string): Buffer => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(expected), digest(given));
};

/** The whole body as text, or `null` for one past {@link RESERVATION_BODY_MAX_BYTES} or cut off. */
const readBody = (req: IncomingMessage): Promise<string | null> =>
  new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let tooLarge = false;
    req.on("data", (chunk: Buffer) => {
      if (tooLarge) return;
      bytes += chunk.length;
      if (bytes > RESERVATION_BODY_MAX_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(tooLarge ? null : Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(null));
  });

/** `{ accountIds }` as 1 to {@link PARTY_MAX_SIZE} distinct, non-empty strings — anything else is `null`. */
const parseAccountIds = (body: string): string[] | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { accountIds } = parsed as Partial<Record<keyof ReservationRequest, unknown>>;
  if (!Array.isArray(accountIds) || accountIds.length === 0 || accountIds.length > PARTY_MAX_SIZE) return null;
  if (!accountIds.every((id): id is string => typeof id === "string" && id.length > 0)) return null;
  if (new Set(accountIds).size !== accountIds.length) return null;
  return accountIds;
};

const answerJson = (res: ServerResponse, status: number, body: unknown): void => {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
  res.end(text);
};
