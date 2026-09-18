import { MAX_PLAYERS } from "@dont-fall/shared";
import { startServer, type MatchServer, type PortRange } from "@dont-fall/server";
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
  startMatchServer?: (opts: { apiUrl: string; maxPlayers: number; portRange?: PortRange }) => Promise<MatchServerHandle>;
  /** Reads one Lobby's live `/status`. Real HTTP by default; a fake in tests. */
  fetchLobbyStatus?: (port: number) => Promise<LobbyStatus | null>;
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

const isJoinable = (status: LobbyStatus | null): boolean =>
  status !== null && status.phase === "LOBBY" && status.playerCount < status.maxPlayers;

const realStartMatchServer = (opts: {
  apiUrl: string;
  maxPlayers: number;
  portRange?: PortRange;
}): Promise<MatchServerHandle> =>
  startServer({
    port: 0,
    trackServiceUrl: opts.apiUrl,
    maxPlayers: opts.maxPlayers,
    ...(opts.portRange ? { portRange: opts.portRange } : {}),
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
  private readonly startMatchServer: (opts: { apiUrl: string; maxPlayers: number }) => Promise<MatchServerHandle>;
  private readonly fetchLobbyStatus: (port: number) => Promise<LobbyStatus | null>;
  private readonly idleGraceMs: number;
  private readonly reapInterval: NodeJS.Timeout;

  constructor(private readonly deps: LobbiesDeps) {
    this.startMatchServer = deps.startMatchServer ?? realStartMatchServer;
    this.fetchLobbyStatus = deps.fetchLobbyStatus ?? fetchLobbyStatusHttp;
    this.idleGraceMs = deps.idleGraceMs ?? DEFAULT_IDLE_GRACE_MS;
    this.reapInterval = setInterval(() => void this.reap(), deps.statusPollIntervalMs ?? DEFAULT_STATUS_POLL_INTERVAL_MS);
  }

  /** Starts one new Lobby end to end: a real `MatchServer`, registered, tracked. */
  async createLobby(isPrivate: boolean): Promise<LobbyEntry> {
    const server = await this.startMatchServer({
      apiUrl: this.deps.apiUrl,
      maxPlayers: this.deps.maxPlayers,
      ...(this.deps.matchPortRange ? { portRange: this.deps.matchPortRange } : {}),
    });
    const entry = this.registry.add(server.port, isPrivate);
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
    if (server) await server.close();
  }

  /**
   * Beans online (`GET /game-settings`): every Player seated in any live
   * Lobby, public or private — the in-memory registry the settings endpoint
   * reads, nothing persisted. A dead/unreachable Lobby contributes 0, never
   * a throw — the same leniency as the status reads above.
   */
  async countOnlinePlayers(): Promise<number> {
    const statuses = await Promise.all(this.registry.all().map((entry) => this.fetchLobbyStatus(entry.port)));
    return statuses.reduce((sum, status) => sum + (status?.playerCount ?? 0), 0);
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
   * Resolves a join code to its Lobby — 404 for unknown, 409 when it is
   * full or its Match already started (never the port in that case: no
   * over-capacity seating).
   */
  async lobbyByCode(code: string): Promise<{ id: string; port: number }> {
    const entry = this.registry.getByCode(code);
    if (!entry) throw new ServiceError(404, `no Lobby with code "${code}"`);
    const status = await this.fetchLobbyStatus(entry.port);
    if (!isJoinable(status)) {
      throw new ServiceError(409, "that Lobby is no longer joinable — full, or its Match already started");
    }
    return { id: entry.id, port: entry.port };
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
   * Resolves a public Lobby id to its port (M9 ticket 12) — the JOIN behind
   * a friend's public lobby. 404 for unknown, 409 when it is full or its
   * Match already started (never the port in that case), the same gates as
   * `lobbyByCode`. Private lobbies resolve by code only, never by id.
   */
  async lobbyById(id: string): Promise<{ id: string; port: number }> {
    const entry = this.registry.get(id);
    if (!entry || entry.isPrivate) throw new ServiceError(404, `no public Lobby "${id}"`);
    const status = await this.fetchLobbyStatus(entry.port);
    if (!isJoinable(status)) {
      throw new ServiceError(409, "that Lobby is no longer joinable — full, or its Match already started");
    }
    return { id: entry.id, port: entry.port };
  }

  /** Whatever public Lobby is open, or a fresh one when none is. */
  async quickMatch(): Promise<{ id: string; port: number }> {
    const withStatus = await Promise.all(
      this.registry.listPublic().map(async (entry) => ({ entry, status: await this.fetchLobbyStatus(entry.port) })),
    );
    const open = withStatus.find(({ status }) => isJoinable(status));
    const entry = open ? open.entry : await this.createLobby(false);
    return { id: entry.id, port: entry.port };
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
