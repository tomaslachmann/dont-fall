import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { GRACE_WINDOW_MS, SNAPSHOT_HZ, randomBearerToken, trackSpawn, type ClientMessage } from "@dont-fall/shared";
import type { IncomingMessage } from "node:http";
import type { WebSocket } from "ws";
import { handleLobbyMessage } from "../match/lobby.js";
import type { MatchRuntime } from "../match/matchRuntime.js";
import { send, truncateForCloseReason } from "../net/wire.js";
import { fetchTrack, type FetchedTrack } from "../track/trackSource.js";
import { seatForJoin, seatOf, type Seat } from "./seats.js";

/**
 * What happens when somebody connects, step by step: is there room, does this
 * connection want a different Track loaded first, which seat does it take, and
 * what listens on its socket afterwards.
 */

/**
 * Whether this connection may sit down, and with what place in line: a
 * Reservation's own `joinOrder` (ADR 0112), or `null` for an ordinary
 * connection, which takes the next one free the moment it registers.
 */
type Admission = { seated: false } | { seated: true; joinOrder: number | null };

/**
 * A full server refuses the next connection outright rather than ever seating
 * a Character past `maxPlayers` (grilling session, 2026-09). Checked first and
 * synchronously, before this handler awaits anything. The cap counts every
 * connection this process holds, spectators included — that is what a
 * Player-facing "N SLOTS OPEN" means — every live Reservation (ADR 0112),
 * so a stranger cannot take a seat a Party member is walking into, and every
 * Bot (ADR 0129), whose seat is as taken as anyone's.
 *
 * A connection carrying `?reservation=<token>` of a live Reservation uses it
 * up and takes that seat instead, which is why it passes even when the
 * connections plus the Reservations fill the server: the seat was counted
 * when it was granted. It takes that Reservation's *place in line* too, so
 * arrival order does not decide who hosts (review finding, 2026-09-19 — see
 * `Reservations.grant`). An unknown, expired or spent token is an ordinary
 * connection. Used up here, before any await, so two connections can never
 * both spend one.
 */
const ensureCapacity = (rt: MatchRuntime, socket: WebSocket, req: IncomingMessage): Admission => {
  const token = new URL(req.url ?? "/", "http://match-server").searchParams.get("reservation");
  const reserved = token === null ? null : rt.reservations.use(token);
  // `!== null` rather than truthiness: join order 0 is a real place in line,
  // and the very one a Party host walking into a fresh Lobby holds.
  if (reserved !== null) {
    // One fewer bean arriving: the Lobby's start blocker changed (ADR 0057).
    rt.snapshotDirty = true;
    return { seated: true, joinOrder: reserved };
  }
  if (rt.seatsTaken() < rt.config.maxPlayers) return { seated: true, joinOrder: null };
  socket.close(4003, truncateForCloseReason(`server is full (${rt.config.maxPlayers} players)`));
  return { seated: false };
};

/**
 * The Track Builder's Playtest button — `?track=<id>` on the connection URL,
 * forwarded by `apps/client`'s bootstrap. The one way this always-on dev
 * server ever serves anything other than what it fetched at boot; absent for
 * every ordinary connection, which lands here and leaves unchanged.
 *
 * Returns false when the connection was refused and closed.
 */
const maybeReloadTrack = async (rt: MatchRuntime, socket: WebSocket, req: IncomingMessage): Promise<boolean> => {
  const requestedTrackId = new URL(req.url ?? "/", "http://match-server").searchParams.get("track");
  if (requestedTrackId === null) return true;

  // Always re-fetch by id rather than short-circuiting on the id alone:
  // Playtest republishes to the same reserved id every time as a new Revision
  // (ADR 0032), so comparing ids would pin this server to the first Revision
  // it ever loaded and silently ignore every later edit.
  let candidate: FetchedTrack;
  try {
    candidate = await fetchTrack(rt.config.trackServiceUrl, {
      ...rt.config.trackFetchRetryOptions,
      trackId: requestedTrackId,
    });
    await rt.loadAssetsFor(candidate.track);
  } catch (err) {
    socket.close(4002, truncateForCloseReason(`failed to load Track "${requestedTrackId}": ${(err as Error).message}`));
    return false;
  }

  if (candidate.id === rt.fetched.id && candidate.revision === rt.fetched.revision) return true;

  // Checked *after* the await above and immediately before the synchronous
  // mutation below — a check taken before an await is stale by the time it
  // resolves. An ordinary connection awaits nothing before registering
  // itself, so one landing during that fetch is already counted here.
  if (rt.sockets.size > 0) {
    // This server has no concept of concurrent Matches, so "reload" can only
    // mean "reload for everyone", which is only safe with nobody here.
    socket.close(
      4001,
      truncateForCloseReason(
        `server already has ${rt.sockets.size} player(s) connected on a different Track — restart to test a new one`,
      ),
    );
    return false;
  }
  // Synchronous from here to the end: no other 'connection' handler can run
  // in between, so the reload is atomic with respect to the check above.
  rt.fetched = candidate;
  rt.resetToFreshLobby(candidate.track);
  console.log(`DON'T FALL: reloaded Track "${rt.fetched.id}"@${rt.fetched.revision} for a Playtest connection`);
  return true;
};

/**
 * Seats the connection, gives it its id, and welcomes it. `reservedJoinOrder`
 * is the place in line a spent Reservation kept for it (ADR 0112), `null` for
 * an ordinary connection, which takes the next one.
 */
const registerConnection = (rt: MatchRuntime, socket: WebSocket, seat: Seat, reservedJoinOrder: number | null): string => {
  const id = randomUUID();
  // A reserved connection takes the place its Reservation kept; anyone else
  // takes the next one free, and only then is one spent (`reserveSeats` has
  // already advanced the counter past every place it reserved).
  const joinOrder = reservedJoinOrder ?? rt.joinCount;
  if (reservedJoinOrder === null) rt.joinCount += 1;
  // The spawn slot is the place in line, reserved or not — `buildSimulationFor`
  // re-seats every Player from their own `joinOrder` on every Track pick and
  // every later Round, so a reserved connection given any other spawn index
  // would jump to a different slot the first time the world was rebuilt under
  // it. Its block was claimed before it arrived, so the slot is its own; an
  // unspent Reservation's slot is simply skipped, the same way the monotonic
  // counter already skips one when a Player leaves.
  //
  // The loaded Track's own start frame — free placement puts the start
  // platform anywhere, so M1's world coords are never right (playtest bug, 2026-09).
  const spawn = trackSpawn(rt.fetched.track, joinOrder, rt.library);
  rt.sockets.set(id, socket);
  rt.inputs.add(id);
  // A newcomer has nothing yet, so the next tick must push even though the
  // shared payload is unchanged for everyone else (ADR 0057).
  rt.snapshotDirty = true;
  // The host is the first joiner (M4 ticket 07, ADR 0040) — `resolveHostId`
  // recomputes that from `joinOrder` rather than storing it.
  rt.lobbyPlayers.set(id, {
    id,
    nickname: "Player",
    ready: false,
    joinOrder,
    accountId: null,
    color: null,
    skin: null,
    hat: null,
  });
  seat.take(rt, id, spawn);

  send(socket, {
    type: "welcome",
    playerId: id,
    // A bearer credential the client presents on reconnect (ADR 0024). M2
    // issues it; no reconnect logic acts on it yet.
    sessionToken: randomBearerToken(),
    spawn,
    trackId: rt.fetched.id,
    trackRevision: rt.fetched.revision,
    // Read off the runtime, not the local that seeded it, so a future
    // runtime-adjustable value cannot leave the welcome advertising a number
    // the tick loop no longer uses.
    config: {
      snapshotHz: SNAPSHOT_HZ,
      graceWindowMs: GRACE_WINDOW_MS,
      playersToStart: rt.config.playersToStart,
      maxPlayers: rt.config.maxPlayers,
    },
  });
  return id;
};

/**
 * Everything this socket says. A malformed frame from one client must never
 * take the Match down for everyone else (ADR 0011), so the parse is guarded
 * and an unrecognised message is simply ignored.
 */
const wireMessages = (rt: MatchRuntime, id: string, socket: WebSocket): void => {
  socket.on("message", (raw) => {
    let message: ClientMessage;
    try {
      message = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      return;
    }
    if (message.type === "ping" && typeof message.clientTimeMs === "number") {
      // Transport echo for the client's clock sync (ADR 0019). No server state.
      send(socket, { type: "pong", clientTimeMs: message.clientTimeMs, serverTimeMs: performance.now() });
      return;
    }
    if (message.type === "input" && Array.isArray(message.inputs)) {
      rt.inputs.receive(id, message.inputs);
      return;
    }
    if (message.type === "sync") {
      // A late-attached listener asking for the current state (ADR 0057) —
      // the next tick pushes whether or not anything changed.
      rt.snapshotDirty = true;
      return;
    }
    // Ready / Track pick / start / return, all on this same socket, no second
    // transport (M4 ticket 07, ADR 0040). Every gate they enforce is in `match/lobby.ts`.
    handleLobbyMessage(rt, id, message);
  });
};

/** Everything that happens to this socket: an error it must survive, and its end. */
const wireLifecycle = (rt: MatchRuntime, id: string, socket: WebSocket): void => {
  // One socket erroring (an abrupt reset, a write to a half-closed pipe) must
  // never take the Match down for everyone else (ADR 0011). 'close' still
  // fires afterwards and does the cleanup.
  socket.on("error", () => {});

  socket.on("close", () => {
    // The seat is read now, not remembered from join — see `seatOf`.
    seatOf(rt, id).release(rt, id, rt.match.phase === "RUNNING");
    rt.sockets.delete(id);
    rt.inputs.remove(id);
    rt.lobbyPlayers.delete(id);
    rt.spectators.delete(id);
    // Whoever leaves stops being loaded, and stops being waited for (ADR
    // 0089): a Round held in LOADING by the client that just dropped starts
    // for whoever is left.
    rt.loaded.delete(id);
    // A Bot never outlives the people it plays with (ADR 0129): with nobody
    // left, its seat would keep an empty Lobby counted as occupied forever.
    if (rt.sockets.size === 0) for (const botId of [...rt.bots.ids()]) rt.removeBot(botId);
    // …and out of the Lobby's voice room (ADR 0111), which is this roster and
    // nothing a client says.
    rt.accountRoster.changed(rt.lobbyPlayers.values());
  });
};

/** One connection, start to finish. Refusals close the socket and return without seating anyone. */
export const handleConnection = async (rt: MatchRuntime, socket: WebSocket, req: IncomingMessage): Promise<void> => {
  const admission = ensureCapacity(rt, socket, req);
  if (!admission.seated) return;
  if (!(await maybeReloadTrack(rt, socket, req))) return;
  const id = registerConnection(rt, socket, seatForJoin(rt), admission.joinOrder);
  wireMessages(rt, id, socket);
  wireLifecycle(rt, id, socket);
};
