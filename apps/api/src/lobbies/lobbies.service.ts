import { randomBytes } from "node:crypto";
import {
  LOBBY_PRIVACIES,
  MAX_MATCH_LENGTH,
  MAX_PLAYERS,
  MIN_MATCH_LENGTH,
  invalidLobbyBotsReason,
  type LobbyBots,
  type LobbyEntryGrant,
  type LobbyPrivacy,
  type PartyLobbyView,
  type PartyPlace,
} from "@dont-fall/shared";
import {
  RESERVATION_SECRET_HEADER,
  startServer,
  type MatchServer,
  type PortRange,
  type ReservationGrant,
  type ReservationRequest,
} from "@dont-fall/server";
import { ServiceError } from "../http/errors.js";
import { LobbyRegistry, type LobbyEntry } from "./lobbies.registry.js";

export type { LobbyEntry };

export interface LobbyStatus {
  playerCount: number;
  maxPlayers: number;
  phase: string;
  /**
   * Authed Accounts seated here, anonymous seats omitted (M9 ticket 11 phase
   * 2b) — what friends presence inverts into account → seat. Never
   * broadcast publicly (browse/by-code answers stay occupancy-only).
   */
  accounts: string[];
  /** The running Round's number during COUNTDOWN/RUNNING/ROUND_END, else null. */
  round: number | null;
}

/** The slice of a Match server the lobbies service owns — started here, closed here. */
export interface MatchServerHandle {
  port: number;
  close: () => Promise<void>;
}

/** What spawning one Lobby's Match server is asked for. */
export interface StartMatchServerOptions {
  apiUrl: string;
  maxPlayers: number;
  portRange?: PortRange;
  matchLength?: number;
  /** The Bots it starts with (M17 ticket 10) — PlaySelect's private setup, already validated. */
  bots?: LobbyBots;
  /** What its `POST /reservations` expects (ADR 0112) — this process's own secret, the same for every Lobby it starts. */
  reservationSecret?: string;
  /** Told the Accounts seated in this Lobby whenever that changes (ADR 0111) — the voice relay's roster. */
  onAccountRoster?: (accountIds: readonly string[]) => void;
}

/** Account id → Reservation token, one per Account asked for — a Match server grants all or none (ADR 0112). */
export type Reservations = Readonly<Record<string, string>>;

/** One other member of the caller's Party, as a broker entry reads it. */
export interface PartyEntryMember {
  accountId: string;
  displayName: string;
  place: PartyPlace;
  /** Whether its Account socket is open — only an open one can be told to follow. */
  online: boolean;
}

/**
 * How a signed-in caller enters a Lobby (ADR 0112): with no Party this
 * service knows of; as a member, who leaves first and enters alone; or as the
 * host, who brings every other member (none, in a party of one).
 *
 * A member's `partyLobbyId` is the Lobby its Party sits in with its host:
 * walking back into that one is not going somewhere alone, so it keeps the
 * member in its Party (ADR 0112: only a *different* Lobby leaves it).
 */
export type PartyEntry =
  | { role: "alone" }
  | { role: "member"; hostDisplayName: string; partyLobbyId: string | null }
  | { role: "host"; members: readonly PartyEntryMember[] };

/** The Party half of a broker entry — `PartiesService` in production, a fake in tests. */
export interface PartyEntrySource {
  entryOf(accountId: string): PartyEntry;
  /** Takes a member out of its Party — the display name of the host it left, or `null` when there was nothing to leave. */
  leave(accountId: string): string | null;
  /** The host is in `lobby` (with its join code, when private) holding these Reservations: the Party's Lobby now, and a `follow` to every other member granted one. */
  enteredLobby(accountId: string, lobby: PartyLobbyView, reservations: Reservations): void;
}

export interface LobbiesDeps {
  /** This API's own origin, handed to every Lobby it starts (they fetch Tracks from it). */
  apiUrl: string;
  maxPlayers: number;
  /**
   * Bind Lobby Match servers inside this range instead of OS-ephemeral
   * ports. Set when the API runs where only known ports are reachable
   * (Docker — the compose file publishes this same range); absent locally.
   */
  matchPortRange?: PortRange;
  /** Spawns one Lobby's Match server. Real by default; a fake in tests (no sockets there). */
  startMatchServer?: (opts: StartMatchServerOptions) => Promise<MatchServerHandle>;
  /** Reads one Lobby's live `/status`. Real HTTP by default; a fake in tests. */
  fetchLobbyStatus?: (port: number) => Promise<LobbyStatus | null>;
  /**
   * Asks one Lobby's Match server for a Reservation per Account, all or none
   * (ADR 0112) — `null` when it refuses. Real HTTP by default (`POST
   * /reservations` with this process's secret); a fake in tests.
   */
  reserveSeats?: (port: number, accountIds: readonly string[], secret: string) => Promise<Reservations | null>;
  /** Who is in whose Party — what makes every signed-in entry party-aware. Absent, every caller enters alone. */
  parties?: PartyEntrySource;
  /**
   * Voice chat's rooms (ADR 0111): who is seated in each Lobby, and when a
   * Lobby is gone. A room is a Lobby's own roster, so this is the only thing
   * that ever fills one. Absent (tests, a stack with voice off), no room is
   * ever told anything and voice simply has nobody in it.
   */
  voice?: {
    setRoster: (lobbyPort: number, accountIds: readonly string[]) => void;
    endRoom: (lobbyPort: number) => void;
  };
  /** How often the idle reaper polls. Test-only — production uses a real cadence. */
  statusPollIntervalMs?: number;
  /** How long a Lobby may sit with nobody in it before the reaper closes it. Test-only, like `statusPollIntervalMs`. */
  idleGraceMs?: number;
}

const DEFAULT_STATUS_POLL_INTERVAL_MS = 10_000;
const DEFAULT_IDLE_GRACE_MS = 5 * 60_000;

/** `null` for anything that isn't a clean 200 — an unreachable/crashed Lobby is treated the same as "not joinable," never thrown. */
const fetchLobbyStatusHttp = async (port: number): Promise<LobbyStatus | null> => {
  try {
    const res = await fetch(`http://localhost:${port}/status`);
    if (!res.ok) return null;
    return (await res.json()) as LobbyStatus;
  } catch {
    return null;
  }
};

/**
 * `null` for anything but a clean 200 naming a token for every Account asked
 * for — an unreachable Lobby, a 409 (not in LOBBY, a `start` requested, no
 * room) and a malformed answer all mean the same thing here: no seats.
 */
const reserveSeatsHttp = async (port: number, accountIds: readonly string[], secret: string): Promise<Reservations | null> => {
  try {
    // The Match server's own names for the header and both bodies, so the
    // two sides of this one call cannot drift apart.
    const request: ReservationRequest = { accountIds: [...accountIds] };
    const res = await fetch(`http://localhost:${port}/reservations`, {
      method: "POST",
      headers: { "content-type": "application/json", [RESERVATION_SECRET_HEADER]: secret },
      body: JSON.stringify(request),
    });
    if (res.status !== 200) return null;
    const body = (await res.json()) as Partial<ReservationGrant>;
    const reservations = body.reservations;
    if (typeof reservations !== "object" || reservations === null) return null;
    return accountIds.every((id) => typeof reservations[id] === "string") ? reservations : null;
  } catch {
    return null;
  }
};

const isJoinable = (status: LobbyStatus | null): boolean =>
  status !== null && status.phase === "LOBBY" && status.playerCount < status.maxPlayers;

/** Whether a Lobby's last `/status` leaves room for `seats` more — the Match server's Reservation is still what decides. */
const hasRoomFor = (status: LobbyStatus | null, seats: number): boolean =>
  status !== null && status.phase === "LOBBY" && status.playerCount + seats <= status.maxPlayers;

const NOT_JOINABLE = "that Lobby is no longer joinable — full, or its Match already started";

/** A Lobby that cannot seat the whole Party refuses it, and says so — a Party is never split (ADR 0112). */
const noRoomFor = (seats: number): ServiceError =>
  new ServiceError(409, seats > 1 ? `no room for your party of ${seats}` : NOT_JOINABLE);

/**
 * Who a signed-in entry seats (ADR 0112), decided before anything is
 * spawned or reserved: `seats` is the caller first, then every other
 * member it brings. A member who is not the host enters alone, leaving its
 * Party only once a seat is granted — unless the seat is in `staysIn`, its
 * Party's own Lobby. Empty for an anonymous caller.
 */
interface EntryPlan {
  callerId: string | null;
  seats: readonly string[];
  leavesPartyOf: string | null;
  staysIn: string | null;
}

const realStartMatchServer = (opts: StartMatchServerOptions): Promise<MatchServerHandle> =>
  startServer({
    port: 0,
    trackServiceUrl: opts.apiUrl,
    maxPlayers: opts.maxPlayers,
    ...(opts.portRange ? { portRange: opts.portRange } : {}),
    // ADR 0110: the length PlaySelect's ROUNDS picked — where the host starts, not a lock.
    ...(opts.matchLength !== undefined ? { matchLengthOverride: opts.matchLength } : {}),
    // M17 ticket 10: the Bots PlaySelect's setup picked — again where the host starts.
    ...(opts.bots !== undefined ? { bots: opts.bots } : {}),
    ...(opts.reservationSecret !== undefined ? { reservationSecret: opts.reservationSecret } : {}),
  }).then((server: MatchServer) => ({ port: server.port, close: () => server.close() }));

export interface PublicLobbyInfo {
  id: string;
  port: number;
  playerCount: number;
  maxPlayers: number;
  phase: string;
  joinable: boolean;
}

/**
 * Lobby lifecycle (grilling session, 2026-09): every Lobby is a real,
 * independent `MatchServer`, started **in-process** — one `MatchRuntime` +
 * `WebSocketServer` per Lobby, fully isolated simulation state, no sharing,
 * just not at the OS-process boundary (cheap while idle Lobbies skip physics
 * via `phaseNeedsPhysicsStep`; a switch to real child processes belongs in a
 * superseding ADR, not a silent drift).
 *
 * Framework-free: constructed with its seams, driven by the controller.
 * Owns the idle reaper (a Lobby nobody has joined, or one that emptied back
 * out, is torn down after `idleGraceMs` — every `MatchServer` holds a live
 * simulation/listener nobody's using otherwise) and stops it on `close()`.
 */
export class LobbiesService {
  private readonly registry = new LobbyRegistry();
  /** Every `MatchServer` this service owns, keyed by registry id — the registry is pure bookkeeping, this map is what can actually `close()` one. */
  private readonly servers = new Map<string, MatchServerHandle>();
  private readonly startMatchServer: (opts: StartMatchServerOptions) => Promise<MatchServerHandle>;
  private readonly fetchLobbyStatus: (port: number) => Promise<LobbyStatus | null>;
  private readonly reserveSeatsVia: (port: number, accountIds: readonly string[], secret: string) => Promise<Reservations | null>;
  /**
   * What every Lobby this process starts expects on `POST /reservations`
   * (ADR 0112) — random per process, never configured, since nothing but
   * this service ever needs to know it.
   */
  private readonly reservationSecret = randomBytes(32).toString("hex");
  private readonly idleGraceMs: number;
  private readonly reapInterval: NodeJS.Timeout;

  constructor(private readonly deps: LobbiesDeps) {
    this.startMatchServer = deps.startMatchServer ?? realStartMatchServer;
    this.fetchLobbyStatus = deps.fetchLobbyStatus ?? fetchLobbyStatusHttp;
    this.reserveSeatsVia = deps.reserveSeats ?? reserveSeatsHttp;
    this.idleGraceMs = deps.idleGraceMs ?? DEFAULT_IDLE_GRACE_MS;
    this.reapInterval = setInterval(() => void this.reap(), deps.statusPollIntervalMs ?? DEFAULT_STATUS_POLL_INTERVAL_MS);
  }

  /** Starts one new Lobby end to end: a real `MatchServer`, registered, tracked. */
  async createLobby(
    isPrivate: boolean,
    setup: { matchLength?: number; privacy?: LobbyPrivacy; bots?: LobbyBots; creatorAccountId?: string | null } = {},
  ): Promise<LobbyEntry> {
    if (
      setup.matchLength !== undefined &&
      (!Number.isInteger(setup.matchLength) || setup.matchLength < MIN_MATCH_LENGTH || setup.matchLength > MAX_MATCH_LENGTH)
    ) {
      throw new ServiceError(400, `matchLength must be a whole number ${MIN_MATCH_LENGTH}–${MAX_MATCH_LENGTH}`);
    }
    if (setup.privacy !== undefined && !LOBBY_PRIVACIES.includes(setup.privacy)) {
      throw new ServiceError(400, `privacy must be one of ${LOBBY_PRIVACIES.join(", ")}`);
    }
    // The same rule the Lobby's own `setBots` holds a host to (M17 ticket 10).
    const botsReason = setup.bots === undefined ? undefined : invalidLobbyBotsReason(setup.bots, this.deps.maxPlayers);
    if (botsReason !== undefined) throw new ServiceError(400, botsReason);
    // The voice room is named by the port this server binds, which is only
    // known once it has — and a roster can change the moment the first
    // connection authenticates. So the last one said before the bind resolved
    // is replayed rather than dropped (only the last matters: each is the
    // whole roster).
    const voice = this.deps.voice;
    let voicePort: number | null = null;
    let pendingRoster: readonly string[] | null = null;
    const server = await this.startMatchServer({
      apiUrl: this.deps.apiUrl,
      maxPlayers: this.deps.maxPlayers,
      ...(this.deps.matchPortRange ? { portRange: this.deps.matchPortRange } : {}),
      ...(setup.matchLength !== undefined ? { matchLength: setup.matchLength } : {}),
      ...(setup.bots !== undefined ? { bots: setup.bots } : {}),
      reservationSecret: this.reservationSecret,
      ...(voice
        ? {
            onAccountRoster: (accountIds: readonly string[]) => {
              if (voicePort === null) pendingRoster = accountIds;
              else voice.setRoster(voicePort, accountIds);
            },
          }
        : {}),
    });
    voicePort = server.port;
    if (voice && pendingRoster !== null) voice.setRoster(server.port, pendingRoster);
    const entry = this.registry.add(server.port, isPrivate, {
      ...(setup.privacy !== undefined ? { privacy: setup.privacy } : {}),
      creatorAccountId: setup.creatorAccountId ?? null,
    });
    this.servers.set(entry.id, server);
    return entry;
  }

  /** Whether a live Lobby's Match server listens on `port` — the only ports the socket proxy dials (ADR 0107). */
  isLobbyPort(port: number): boolean {
    return this.registry.all().some((entry) => entry.port === port);
  }

  async closeLobby(id: string): Promise<void> {
    const server = this.servers.get(id);
    this.servers.delete(id);
    this.registry.remove(id);
    if (server) {
      // The voice room outlives its Lobby on purpose (ADR 0111): everyone
      // walks from here to the MatchOver podium, and they keep talking.
      this.deps.voice?.endRoom(server.port);
      await server.close();
    }
  }

  /** Every currently-tracked public Lobby with live occupancy/phase — the quick-match/browse candidate pool. */
  async listPublic(): Promise<PublicLobbyInfo[]> {
    const withStatus = await Promise.all(
      this.registry.listPublic().map(async (entry) => ({ entry, status: await this.fetchLobbyStatus(entry.port) })),
    );
    return withStatus.map(({ entry, status }) => ({
      id: entry.id,
      port: entry.port,
      playerCount: status?.playerCount ?? 0,
      maxPlayers: status?.maxPlayers ?? this.deps.maxPlayers,
      phase: status?.phase ?? "UNKNOWN",
      joinable: isJoinable(status),
    }));
  }

  /**
   * Every tracked Lobby with a live status (M9 ticket 12) — what friends
   * presence inverts into account → seat. Unreachable lobbies drop out
   * (the reaper untracks them on its own pass); never throws.
   */
  async liveSeats(): Promise<{ entry: LobbyEntry; status: LobbyStatus }[]> {
    const withStatus = await Promise.all(
      this.registry.all().map(async (entry) => ({ entry, status: await this.fetchLobbyStatus(entry.port) })),
    );
    return withStatus.filter((row): row is { entry: LobbyEntry; status: LobbyStatus } => row.status !== null);
  }

  /**
   * Asks the Match server on `port` for a Reservation per Account, all or
   * none (ADR 0112) — `null` when it refuses. Also what `PartiesService`
   * uses to let a bean accepted into a Party follow its host into a Lobby.
   */
  reserveSeats(port: number, accountIds: readonly string[]): Promise<Reservations | null> {
    return this.reserveSeatsVia(port, accountIds, this.reservationSecret);
  }

  /**
   * `POST /lobbies/quick-match` — the first open public Lobby that seats the
   * caller's whole Party, else a fresh one (ADR 0112). Anonymous, it is what
   * it always was: whatever public Lobby is open.
   */
  async quickMatch(callerId: string | null = null): Promise<LobbyEntryGrant> {
    const plan = this.plan(callerId);
    const withStatus = await Promise.all(
      this.registry.listPublic().map(async (entry) => ({ entry, status: await this.fetchLobbyStatus(entry.port) })),
    );
    if (plan.seats.length === 0) {
      const open = withStatus.find(({ status }) => isJoinable(status));
      const entry = open ? open.entry : await this.createLobby(false);
      return { id: entry.id, port: entry.port };
    }
    for (const { entry, status } of withStatus) {
      if (!hasRoomFor(status, plan.seats.length)) continue;
      const reservations = await this.reserveSeats(entry.port, plan.seats);
      if (reservations) return this.settle(plan, entry, reservations);
    }
    const fresh = await this.createLobby(false);
    const reservations = await this.reserveSeats(fresh.port, plan.seats);
    if (!reservations) {
      // Nobody will ever enter it, and a Match server left running holds one
      // of the few published ports (ADR 0108) until the idle reaper closes it
      // five minutes later — with every retry starting another.
      await this.closeLobby(fresh.id);
      throw new ServiceError(503, "a fresh Lobby could not hold your seats — try again");
    }
    return this.settle(plan, fresh, reservations);
  }

  /**
   * `POST /lobbies` — a new Lobby, set up as asked (ADR 0110), with the
   * caller's Party seated in it (ADR 0112). The waiting-for check runs
   * before anything is spawned.
   */
  async create(
    isPrivate: boolean,
    setup: { matchLength?: number; privacy?: LobbyPrivacy; bots?: LobbyBots },
    callerId: string | null = null,
  ): Promise<LobbyEntryGrant & { code: string | null; isPrivate: boolean }> {
    const plan = this.plan(callerId);
    const entry = await this.createLobby(isPrivate, { ...setup, creatorAccountId: callerId });
    const created = { code: entry.code ?? null, isPrivate: entry.isPrivate };
    if (plan.seats.length === 0) return { id: entry.id, port: entry.port, ...created };
    const reservations = await this.reserveSeats(entry.port, plan.seats);
    if (!reservations) {
      // As in `quickMatch`: a Lobby this call spawned and nobody can enter is
      // closed here, not left for the idle reaper.
      await this.closeLobby(entry.id);
      throw new ServiceError(503, "the new Lobby could not hold your seats — try again");
    }
    return { ...this.settle(plan, entry, reservations), ...created };
  }

  /**
   * `POST /lobbies/join` — a private Lobby by its join code, or a public one
   * by id (the JOIN behind a friend's Lobby, M9 ticket 12). 404 for unknown
   * (private Lobbies resolve by code only, never by id); 409 when it cannot
   * seat the caller's whole Party, never a split one.
   */
  async join(target: { code?: unknown; lobbyId?: unknown }, callerId: string | null = null): Promise<LobbyEntryGrant> {
    let entry: LobbyEntry | undefined;
    if (typeof target.code === "string" && target.code.length > 0) {
      entry = this.registry.getByCode(target.code);
      if (!entry) throw new ServiceError(404, `no Lobby with code "${target.code}"`);
    } else if (typeof target.lobbyId === "string" && target.lobbyId.length > 0) {
      const byId = this.registry.get(target.lobbyId);
      if (!byId || byId.isPrivate) throw new ServiceError(404, `no public Lobby "${target.lobbyId}"`);
      entry = byId;
    } else {
      throw new ServiceError(400, "send a Lobby code or a lobbyId");
    }
    const plan = this.plan(callerId);
    const status = await this.fetchLobbyStatus(entry.port);
    if (plan.seats.length === 0) {
      if (!isJoinable(status)) throw new ServiceError(409, NOT_JOINABLE);
      return { id: entry.id, port: entry.port };
    }
    if (status === null || status.phase !== "LOBBY") throw new ServiceError(409, NOT_JOINABLE);
    if (!hasRoomFor(status, plan.seats.length)) throw noRoomFor(plan.seats.length);
    const reservations = await this.reserveSeats(entry.port, plan.seats);
    if (!reservations) throw noRoomFor(plan.seats.length);
    return this.settle(plan, entry, reservations);
  }

  /**
   * Who this entry seats (ADR 0112). The host of a Party of two or more
   * brings every member, and waits for any not back in the menus — nobody is
   * pulled off a podium.
   *
   * Only a member whose Account socket is open counts, for both: one that is
   * closed cannot be told to follow, so it is not seated, and it must not be
   * waited for either — its place is kept through the offline grace on
   * purpose (`PartiesService.disconnected`), so a bean who closed the game on
   * a podium would otherwise read as still there and refuse the host's every
   * PLAY for a minute and a half, while the strip shows it OFFLINE. It waits
   * for the next PLAY like a bean accepted too late.
   */
  private plan(callerId: string | null): EntryPlan {
    if (callerId === null) return { callerId, seats: [], leavesPartyOf: null, staysIn: null };
    const entry = this.deps.parties?.entryOf(callerId) ?? { role: "alone" as const };
    if (entry.role === "member") {
      return { callerId, seats: [callerId], leavesPartyOf: entry.hostDisplayName, staysIn: entry.partyLobbyId };
    }
    if (entry.role === "alone") return { callerId, seats: [callerId], leavesPartyOf: null, staysIn: null };
    const bringing = entry.members.filter((member) => member.online);
    const waiting = bringing.find((member) => member.place !== "menu");
    if (waiting) throw new ServiceError(409, `waiting for ${waiting.displayName}`);
    const seats = [callerId, ...bringing.map((member) => member.accountId)];
    // No Lobby can ever hold them, so nothing is spawned or asked: without
    // this the entry would start a Match server, be refused the seats, and
    // leave it holding a port until the idle reaper closes it.
    if (seats.length > this.deps.maxPlayers) {
      throw new ServiceError(409, `your party of ${seats.length} is bigger than a Lobby's ${this.deps.maxPlayers} seats`);
    }
    return { callerId, seats, leavesPartyOf: null, staysIn: null };
  }

  /**
   * Seats granted: a member leaves its Party (not when this is the Party's
   * own Lobby, which it had only stepped out of), the Party's Lobby is set,
   * the others are told to follow, and the caller gets its own Reservation.
   */
  private settle(plan: EntryPlan, lobby: Pick<LobbyEntry, "id" | "port" | "code">, reservations: Reservations): LobbyEntryGrant {
    const callerId = plan.callerId;
    const grant: LobbyEntryGrant = { id: lobby.id, port: lobby.port };
    if (callerId === null) return grant;
    const reservation = reservations[callerId];
    if (reservation !== undefined) grant.reservation = reservation;
    if (plan.leavesPartyOf !== null && plan.staysIn !== lobby.id) {
      grant.leftPartyOf = this.deps.parties?.leave(callerId) ?? plan.leavesPartyOf;
    }
    this.deps.parties?.enteredLobby(
      callerId,
      { id: lobby.id, port: lobby.port, ...(lobby.code !== undefined ? { code: lobby.code } : {}) },
      reservations,
    );
    return grant;
  }

  private async reap(): Promise<void> {
    const now = Date.now();
    for (const entry of this.registry.all()) {
      const status = await this.fetchLobbyStatus(entry.port);
      if (status === null) {
        // Unreachable — the MatchServer behind it is gone or wedged either
        // way; nothing to gracefully close, just stop tracking it.
        this.servers.delete(entry.id);
        this.registry.remove(entry.id);
        continue;
      }
      if (status.playerCount > 0) {
        this.registry.touch(entry.id, now);
        continue;
      }
      if (now - entry.lastNonEmptyAt > this.idleGraceMs) await this.closeLobby(entry.id);
    }
  }

  async close(): Promise<void> {
    clearInterval(this.reapInterval);
    await Promise.all([...this.servers.values()].map((server) => server.close()));
    this.servers.clear();
  }
}

/** Production `maxPlayers`: `MAX_PLAYERS` env when it is a positive integer, else the shared default. */
export const resolveMaxPlayers = (configured: number | undefined): number => {
  if (configured !== undefined) return configured;
  const envMaxPlayers = Number(process.env.MAX_PLAYERS);
  return Number.isInteger(envMaxPlayers) && envMaxPlayers > 0 ? envMaxPlayers : MAX_PLAYERS;
};
