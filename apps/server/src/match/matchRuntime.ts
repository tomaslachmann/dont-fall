import {
  ASSET_PLACEMENT_MODULES,
  DEFAULT_MATCH_LENGTH,
  DEFAULT_ROUND_TYPE,
  MODULE_LIBRARY,
  assetIdsOf,
  missingAssetIds,
  RapierSimulation,
  raceTargets,
  resolveRoundRules,
  resolveTrack,
  roundStartBlockedReason,
  roundTypeOverrides,
  trackSpawn,
  type AssetLibraryLoader,
  type CheckpointArrivals,
  type DnfEntry,
  type LobbyPlayer,
  type MatchState,
  type Module,
  type RaceTargets,
  type RoundResult,
  type RoundRules,
  type RoundType,
  type Track,
} from "@dont-fall/shared";
import type { WebSocket } from "ws";
import { InputRouter } from "../net/inputRouter.js";
import { httpAccountResolver, type AccountResolver } from "./accountResolution.js";
import { httpBettingNotifier, type BettingNotifier } from "./betting.js";
import { httpMatchResultsNotifier, type MatchResultsNotifier } from "./matchResults.js";
import { httpTrackPlayRecorder, type TrackPlayRecorder } from "./trackPlays.js";
import { httpPersonalBestRecorder, type PersonalBestRecorder } from "./personalBests.js";
import { drawRound, type RoundSlotPick } from "./roundDraw.js";
import { AccountRoster } from "../server/accountRoster.js";
import type { ServerRuntimeConfig } from "../server/config.js";
import { Reservations } from "../server/reservations.js";
import type { FetchedTrack } from "../track/trackSource.js";

/** One Round's fully-resolved plan (M7 ticket 05) — what {@link MatchRuntime.matchStructure} holds per slot. */
export interface MatchStructureEntry {
  fetched: FetchedTrack;
  roundType: RoundType;
}

/**
 * What {@link MatchRuntime.reserveSeats} answered (ADR 0112): a token per
 * Account, or why nobody got one, in words.
 */
export type SeatReservation = { granted: Record<string, string> } | { refused: string };

/**
 * Everything `startServer`'s config resolved to, fixed for the life of the
 * process ({@link ServerRuntimeConfig}), plus the three things the boot itself
 * makes rather than reads.
 */
export interface MatchConfig extends ServerRuntimeConfig {
  /**
   * This Match's own id (ticket 14) — a boot UUID. Rides every snapshot so
   * the API (betting pools keyed by `(matchId, round)`) and every client
   * share one stable name for the Match.
   */
  matchId: string;
  /**
   * Measurement only (M13 ticket 02): handed to every simulation this Match
   * builds, so the tick log can split a tick into Rapier's own phases. Set
   * only when the process runs with `DONTFALL_PERF=1`.
   */
  profileClock?: (() => number) | undefined;
  /**
   * Where Asset collision comes from (memory-footprint ticket 01, ADR 0080):
   * the ids each Track places are loaded before a world is built on it.
   * Omitted (tests handing in a finished library), the library is taken as
   * complete and nothing is loaded.
   */
  assets?: AssetLibraryLoader | undefined;
  /**
   * Called with the Accounts seated here whenever that set changes (ADR
   * 0111) — see {@link MatchRuntime.accountRoster}. Absent in every test and
   * in a standalone server: nobody is listening, so nothing is walked.
   */
  onAccountRoster?: ((accountIds: readonly string[]) => void) | undefined;
}

/**
 * One Match's live state, and the operations that reset it.
 *
 * This exists because the state genuinely is shared: the connection handler,
 * the Lobby handlers and the tick loop all read and write the same phase, the
 * same tick counter and the same world, and they now live in three files. The
 * alternative to naming it is threading a dozen mutable variables through
 * every call, which hides the coupling rather than removing it.
 *
 * Fields are mutable on purpose — this is the thing that changes every tick.
 * What is `readonly` is what never gets replaced: the collections and the
 * resolved config.
 */
export class MatchRuntime {
  readonly sockets = new Map<string, WebSocket>();

  /**
   * Every connected Player as the Lobby sees them (M4 ticket 07, ADR 0040) —
   * nickname, Ready, and the join order that decides who the host is
   * (`resolveHostId`, recomputed, never stored). Kept in step with `sockets`
   * one-for-one: populated in the same place a connection registers itself,
   * deleted in the same place `'close'` cleans everything else up.
   */
  readonly lobbyPlayers = new Map<string, LobbyPlayer>();

  /**
   * Players who connected mid-Match and sit out its Rounds (M7 ticket 08) —
   * in the Lobby's list, not in the Round: they get no Character until a
   * fresh Match seats everyone again. Match-scoped like `roundResults`:
   * cleared by {@link resetToFreshLobby}, never per Round, so a spectator
   * waits out the whole Match rather than joining Round two halfway.
   */
  readonly spectators = new Set<string>();

  readonly inputs = new InputRouter();

  /**
   * Seats kept for Accounts the broker sent here that have not connected yet
   * (ADR 0112) — each counts as taken in the capacity check and in
   * `/status.playerCount`, and while any is live the Lobby cannot start.
   * Not Match-scoped: a Track pick resets the Lobby under a Party still
   * walking in, and its seats must survive that.
   */
  readonly reservations: Reservations;

  /** The world. Replaced wholesale by a Playtest reload or a Lobby Track pick. */
  simulation: RapierSimulation;
  fetched: FetchedTrack;
  /**
   * This Round's rules (M5 ticket 02, ADR 0041/0043) — the Track's own
   * defaults under this Match's overrides, resolved once by
   * {@link buildSimulationFor} every time `simulation`/`fetched` are, and
   * fixed in between. Replicated on the snapshot beside `phase`
   * (`matchLoop.ts`) so the client predicts against the identical record.
   */
  roundRules: RoundRules;
  /**
   * The Round type this Lobby will start (M5 ticket 07) — a name, and the
   * only place in the server one exists. Everything downstream reads
   * {@link roundRules}, which {@link setRoundType} re-resolves from this;
   * nothing branches on the name itself (ADR 0043).
   *
   * Survives a Track pick and the return from Results: a host who chose
   * Survival chose it for this Lobby, not for one Round.
   */
  roundType: RoundType = DEFAULT_ROUND_TYPE;
  /**
   * Whether the currently-loaded Track has a Finish Zone at all (M5 ticket
   * 07) — resolved with the simulation, since `resolveTrack` already
   * answers it, rather than re-flattening the Track every time the Lobby
   * asks. This is the *only* thing that decides whether a Race can run
   * here; no Track is ever tagged with the Round types it allows (ADR 0041).
   */
  trackHasFinishZone: boolean;
  /**
   * Where a runner heads on the loaded Track — each Checkpoint's centre, then
   * the Finish Zones (ADR 0088). Resolved with the simulation, like
   * {@link trackHasFinishZone}; what live Race placement measures against.
   */
  raceTargets: RaceTargets;
  /**
   * The Tick each Character first reached each Checkpoint this Round (ADR
   * 0088) — recorded every RUNNING Tick by the loop, cleared on RUNNING
   * entry. Only the server has every Character's exact arrival, which is why
   * splits are computed here and replicated rather than derived by a client.
   */
  checkpointArrivals: CheckpointArrivals = {};

  /**
   * The server's own monotonic tick — advances by exactly one every interval,
   * unconditionally, from before any client connects (ADR 0027).
   */
  serverTick = 0;
  /**
   * The shared (non-per-client) payload of the last broadcast snapshot, as
   * JSON — what the idle-phase dirty check in `matchLoop.ts` compares
   * against (ADR 0057). `null` until the first broadcast.
   */
  lastBroadcastJson: string | null = null;
  /**
   * Whether the next tick must broadcast even in an idle phase (ADR 0057) —
   * set when a client joins (a newcomer has nothing yet while the shared
   * payload may be unchanged for everyone else). Spent by the broadcast
   * itself. Phase transitions and Lobby mutations need no flag: they change
   * the compared payload, so the dirty check catches them on its own.
   */
  snapshotDirty = true;
  /** The Tick this Round's clock counts from — set by the COUNTDOWN → RUNNING transition (ADR 0038). */
  roundStartTick = 0;
  match: MatchState = { phase: "LOBBY", phaseStartTick: 0 };

  /** Players who dropped while the Round was being raced (M4 ticket 05). */
  dnf: DnfEntry[] = [];

  /**
   * Ids who have confirmed Ready on the current Standings Screen (M7 ticket
   * 10, ADR 0051) — Round-scoped exactly like `dnf`: cleared on every fresh
   * COUNTDOWN (`matchLoop.ts`), never carried across Rounds. Checked against
   * `sockets` live (`allStandingsConfirmed`), never a snapshot of who was
   * connected when RESULTS began, so a mid-Standings disconnect can't block
   * the rest.
   */
  readonly standingsReady = new Set<string>();

  /**
   * Ids whose client has this Round's Track built and has said so (ADR
   * 0089) — Round-scoped like {@link standingsReady}, cleared whenever a
   * Round starts loading or the Track changes under it. {@link allLoaded}
   * reads it against who is connected *now*, so someone leaving mid-load
   * never holds the Round.
   */
  readonly loaded = new Set<string>();

  /**
   * How many Rounds this Match runs before it ends (M7 ticket 04/05, ADR
   * 0049) — Lobby-scoped, like `roundType`: a host who set it for one Match
   * set it for this Lobby, not for one Match, so it survives
   * {@link resetToFreshLobby}. Host-settable via `setMatchLength` (ticket 05).
   */
  matchLength = DEFAULT_MATCH_LENGTH;
  /**
   * Every Round's result so far this Match (M7 ticket 04, ADR 0049) —
   * Match-scoped: cleared on a fresh Match ({@link resetToFreshLobby}),
   * never on a fresh Round. Score is a pure fold over this (`matchScore`),
   * computed by whoever needs it rather than stored.
   */
  roundResults: RoundResult[] = [];
  /**
   * The number of the Round this Match is on, or just finished while in
   * RESULTS (ADR 0110) — `0` in LOBBY. Set on LOADING entry to
   * `roundResults.length + 1`, the number its betting pool opens under, and
   * held until the next Round loads, so an abandoned Round (never pushed to
   * `roundResults`) still reads as the Round it was.
   */
  round = 0;
  /**
   * When the current Standings move on without everyone's Ready, on the
   * server's clock (the grid time snapshots are stamped with, ADR 0109) —
   * `null` outside RESULTS (ADR 0110). The Standings Screen counts down to it.
   */
  standingsDeadlineMs: number | null = null;
  /**
   * The last Round whose board this server closed because one runner was
   * left (ADR 0110) — so the close is sent once per Round, not every Tick.
   */
  bettingClosedRound = 0;
  /**
   * Every Round's Track id, parallel to `roundResults` — the career
   * history's row names. Match-scoped and cleared with it
   * ({@link resetToFreshLobby}); recorded at the Round's actual end from the
   * world it was raced on, never from the draw (a failed draw replays the
   * current Track, so the plan and the raced world can differ).
   */
  roundTrackIds: string[] = [];
  /**
   * Every racer's nickname, kept for the results save (ADR 0059) —
   * Match-scoped, cleared on a fresh Match ({@link resetToFreshLobby}).
   * Accumulated from each finished Round's own rows rather than read live at
   * Match end: a Player who dropped mid-Match has no `LobbyPlayer` row left
   * to read, but their earlier Rounds still name them.
   */
  matchNicknames = new Map<string, string>();
  /**
   * Every authed racer's Account id, kept for the results save (M9 ticket 11
   * phase 2b) — Match-scoped and accumulated exactly like `matchNicknames`
   * above, for the same reason: a dropped Player's row is gone by Match
   * end. What RECENT reads. Anonymous seats are simply absent, never null.
   */
  matchAccountIds = new Map<string, string>();
  /**
   * Every racer's equipped body color, kept for the results save — the
   * podium wears these under no skin. Accumulated exactly like
   * `matchNicknames` above: read off the live lobby row at each finished
   * Round (or the drop record when the row is already gone), since a
   * dropped Player's row is gone by Match end. Anonymous seats are simply
   * absent, never null — the podium defaults them.
   */
  matchColors = new Map<string, number>();
  /** Every racer's equipped skin (ADR 0091), kept the same way for the same podium. No skin, no entry. */
  matchSkins = new Map<string, string>();
  /** Every racer's equipped hat (ADR 0083), kept the same way for the same podium. No hat, no entry. */
  matchHats = new Map<string, string>();
  /**
   * Every racer's falls across every Round they raced (ADR 0059) — the one
   * MatchOver stat Score derivation can't recover (the sim only ever holds
   * the current Round's counts). Match-scoped, like `matchNicknames` above.
   */
  totalFalls: Record<string, number> = {};
  /**
   * Every racer's longest stay in one Survival Round of this Match, in ms
   * (ADR 0110) — the career's BEST SURVIVAL. Match-scoped like `totalFalls`.
   */
  matchSurvivalMs = new Map<string, number>();
  /** Every racer's Struggles won across the Match (ADR 0110) — the career's GRABS BROKEN. */
  matchGrabsBroken = new Map<string, number>();
  /**
   * The Match id whose results landed in the API (ADR 0059) — `null` until
   * the terminal save succeeds, which is exactly what the snapshot's
   * `matchOver` reads. Set once per Match; a fresh Match clears it
   * ({@link resetToFreshLobby}), never a fresh Round.
   */
  resultsSavedMatchId: string | null = null;
  /** Wall clock of the save above — what the straggler close-grace measures from. */
  resultsSavedAtMs: number | null = null;
  /** A save is in flight — the tick loop never stacks a second one on top of it. */
  savingResults = false;
  /** Last `serverTick` a save was attempted on — retries back off in ticks, never hammer the API. */
  lastSaveAttemptTick: number | null = null;
  /** The self-close below already fired — the tick loop asks once, never every tick after. */
  closeRequested = false;
  /**
   * The host's own picks for Rounds after the one about to start (M7 ticket
   * 05) — keyed by 0-based Round index (`1` is Round 2's slot; `0`, Round
   * 1's own slot, is never a key here — see `PickRoundSlotMessage`).
   * Match-scoped, like `roundResults`: a pick was about specific upcoming
   * Rounds of *this* Match, which have either happened or been discarded by
   * the time another one starts.
   */
  pendingRoundPicks = new Map<number, RoundSlotPick>();
  /**
   * Every Round's fully-resolved plan for this Match (M7 ticket 05), index
   * matching `roundResults.length` at the Tick each Round starts — `[0]` is
   * Round 1's, copied from `fetched`/`roundType` the instant `start` fires
   * (Round 1 keeps its existing pick mechanism; this ticket adds no second
   * one for it). `[1..matchLength-1]` are drawn by `buildMatchStructure`,
   * kicked off the same instant, well before any of them are actually
   * needed — Round 1 alone almost always outlasts the fetch. `undefined`
   * until drawn; "do not reveal a drawn Track early" means this is
   * deliberately never sent to a client before its Round is the current one.
   */
  matchStructure: (MatchStructureEntry | undefined)[] = [];
  /** The in-flight (or already-settled) draw for every entry of `matchStructure` past `[0]` — `nextRoundReady` awaits this rather than polling. */
  matchStructurePromise: Promise<void> | undefined;
  /** Track ids already used this Match (M7 ticket 05) — mutated by `drawRound`; reset when the pool is exhausted. Match-scoped. */
  usedTrackIds = new Set<string>();
  /**
   * Whether the next Round's world is built and waiting (M7 ticket 04) — a
   * level, not an edge: set `false` the instant RESULTS begins with Rounds
   * still remaining, and read by `advanceMatchPhase` every Tick after that
   * until `matchStructure`'s draw (ticket 05) resolves and this is set `true`.
   */
  nextRoundReady = false;

  /** One-shot edge, set by a Lobby handler and spent by the next tick. */
  startRequested = false;
  /** Guards a `selectTrack` whose fetch is still in flight against a newer pick. */
  selectTrackSeq = 0;
  /**
   * Guards an in-flight {@link buildMatchStructure} against a Match that
   * ended before it finished (code review, M7 ticket 05) — bumped by
   * {@link resetToFreshLobby}, the same `selectTrackSeq` idiom. Without
   * this, a draw still running when the last Player left (`resetToFreshLobby`
   * clears `matchStructure`/`usedTrackIds` for whatever Match starts next)
   * would resolve later and write its stale result into that *new* Match's
   * state — this `MatchRuntime` instance outlives any one Match.
   */
  matchStructureSeq = 0;

  /** Whether this Round has met either of its endings, as of the last Tick simulated (M4 ticket 05). */
  roundEnding = { allQualified: false, timeExpired: false };
  /** What the Round clock read when the Round ended, so it stops rather than springs back. */
  finalTimeLeftMs = 0;

  /**
   * Monotonic across the process so each joiner gets a distinct spawn slot,
   * and a distinct place in line (`LobbyPlayer.joinOrder`, which is what
   * `resolveHostId` reads). Advanced one at a time by a connection
   * registering, and a whole block at a time by {@link reserveSeats}, which
   * claims the places the Party walking in will take (ADR 0112) — so a
   * Reservation nobody spends leaves a gap here.
   */
  joinCount = 0;

  /**
   * Set once `startServer`'s own `close()` runs (M7 ticket 05) — checked by
   * {@link buildMatchStructure} between draws so a background Match-structure
   * build stops making the API requests the moment its server is gone,
   * rather than continuing to draw for a Match nothing is listening to
   * anymore. Without this, a closed-but-still-drawing runtime is real,
   * indefinite background load on the API — harmless in production
   * (a process exit kills it outright) but real in a test suite that starts
   * and closes many servers against one shared the API instance in a
   * single process, where it compounds across every test that ever called
   * `start` without pinning `matchLengthOverride: 1`.
   */
  closed = false;

  /**
   * Every Module either side may resolve (M8 ticket 02) — the static
   * procedural registry composed with the fetched asset half. Instance
   * state, not a module-level mutation: tests (and a future second runtime
   * in one process) build their own world from their own bytes. Since
   * memory-footprint ticket 01 it holds only the Assets the Tracks this
   * Match has loaded place, and grows through {@link loadAssetsFor}.
   */
  library: Record<string, Module>;

  /**
   * The match server's half of spectator wagering (ticket 14) — opened and
   * settled from the tick loop, injectable so tests pin the hooks' arguments
   * without HTTP. Defaults to the real API calls over this Match's own
   * track-service URL (the merged API, ADR 0058).
   */
  readonly betting: BettingNotifier;

  /**
   * The match server's half of persisted results (ADR 0059) — saved from the
   * tick loop at the terminal RESULTS, injectable so tests pin the save
   * without HTTP, the same seam `betting` above already follows.
   */
  readonly matchResults: MatchResultsNotifier;

  /**
   * The match server's half of anonymous play counts (M9 ticket 16) —
   * reported from the tick loop on every Countdown entry, injectable so
   * tests pin the hook without HTTP, the same seam `betting` above already
   * follows.
   */
  readonly trackPlays: TrackPlayRecorder;

  /**
   * Session-token → Account resolution (M9 ticket 11 phase 2b) — the `auth`
   * message's verifier, injectable so tests bind accounts without HTTP, the
   * same seam `betting` follows.
   */
  readonly accounts: AccountResolver;

  /**
   * Personal Best reporting (ADR 0088) — every authed finisher's run time when
   * a Race Round ends, injectable so tests pin the report without HTTP, the
   * same seam `trackPlays` follows.
   */
  readonly personalBests: PersonalBestRecorder;

  /**
   * Who is seated here by Account (ADR 0111), reported to whoever started
   * this server whenever it changes. The API's voice relay is the one
   * listener: a voice room *is* the Lobby's roster. Told by the two places
   * that can move it — an `auth` binding a seat to an Account, and a socket
   * closing.
   */
  readonly accountRoster: AccountRoster;

  constructor(
    readonly config: MatchConfig,
    fetched: FetchedTrack,
    library: Record<string, Module> = MODULE_LIBRARY,
    betting: BettingNotifier = httpBettingNotifier(config.trackServiceUrl),
    matchResults: MatchResultsNotifier = httpMatchResultsNotifier(config.trackServiceUrl),
    trackPlays: TrackPlayRecorder = httpTrackPlayRecorder(config.trackServiceUrl),
    accounts: AccountResolver = httpAccountResolver(config.trackServiceUrl),
    personalBests: PersonalBestRecorder = httpPersonalBestRecorder(config.trackServiceUrl),
  ) {
    this.library = library;
    this.fetched = fetched;
    this.betting = betting;
    this.matchResults = matchResults;
    this.trackPlays = trackPlays;
    this.accounts = accounts;
    this.personalBests = personalBests;
    this.matchLength = config.matchLengthOverride ?? DEFAULT_MATCH_LENGTH;
    this.reservations = new Reservations(config.reservationTtlMs);
    this.accountRoster = new AccountRoster(config.onAccountRoster);
    // The Match starts with no players; ticket 01's single-player default
    // Character is opted out here rather than added and immediately disposed.
    const built = this.buildSimulationFor(fetched.track);
    this.simulation = built.simulation;
    this.roundRules = built.roundRules;
    this.trackHasFinishZone = built.trackHasFinishZone;
    this.raceTargets = built.raceTargets;
  }

  /**
   * This Round's rules, from the three sources ADR 0041 allows and no
   * others: the Track Revision's own authored defaults, under the Lobby's
   * Round-type pick, under this Match's own configured overrides.
   *
   * Ordering is the ADR's own — a Round's override beats a Track's default —
   * and the Round type sits between the two because it *is* a Round-level
   * choice, just one a host makes instead of a process config.
   */
  private resolveRules(): RoundRules {
    return resolveRoundRules(
      { timeLimitMs: this.fetched.timeLimitMs, fallBehavior: "respawn", survivorTarget: this.fetched.survivorTarget },
      {
        ...roundTypeOverrides(this.roundType),
        // Spread conditionally, not assigned as a possibly-`undefined` value:
        // an explicit `undefined` here would clobber a field the Round type
        // had just set, the day a Round type overrides more than
        // `fallBehavior`. Same idiom `startServer` uses building this config.
        ...(this.config.timeLimitMsOverride !== undefined ? { timeLimitMs: this.config.timeLimitMsOverride } : {}),
        ...(this.config.survivorTargetOverride !== undefined ? { survivorTarget: this.config.survivorTargetOverride } : {}),
      },
    );
  }

  /**
   * The host picked a Round type (M5 ticket 07). Re-resolves this Round's
   * rules and hands them straight to the live simulation — no rebuild: a
   * Round type changes what the rules *say*, never what the world *is*,
   * unlike a Track pick, which changes both.
   */
  setRoundType(roundType: RoundType): void {
    this.roundType = roundType;
    this.roundRules = this.resolveRules();
    this.simulation.syncRoundRules(this.roundRules);
  }

  /**
   * The host set this Match's length (M7 ticket 05, ADR 0049). Trims any
   * `pendingRoundPicks` for a slot that no longer exists — a pick for Round
   * 4 of what is now a 3-Round Match means nothing, and a stale entry would
   * otherwise resurface confusingly if the host raised the length again.
   */
  setMatchLength(matchLength: number): void {
    this.matchLength = matchLength;
    for (const roundIndex of [...this.pendingRoundPicks.keys()]) {
      if (roundIndex >= matchLength) this.pendingRoundPicks.delete(roundIndex);
    }
  }

  /**
   * The host picked (or cleared) a Track/Round-type for a future Round slot
   * (M7 ticket 05) — always the slot's full desired state, replacing
   * whatever was there (`PickRoundSlotMessage`'s own contract). Storing
   * `{ trackId: null, roundType: null }` rather than deleting the map entry
   * for an all-cleared slot is deliberately the same either way here — both
   * read back as "the server draws this" — so this can't drift from
   * `pendingRoundPicks.get(roundIndex)` simply returning `undefined` for an
   * index nobody has touched yet.
   */
  pickRoundSlot(roundIndex: number, pick: RoundSlotPick): void {
    this.pendingRoundPicks.set(roundIndex, pick);
  }

  /**
   * Why this Lobby can't start right now, in words a Player can read, or
   * `undefined` when it can (M5 ticket 07, ADR 0112). One expression, read by both the
   * `start` gate that refuses and the snapshot field that explains — so what
   * a Player is told and what the server enforces can never disagree.
   */
  startBlockedReason(): string | undefined {
    const trackReason = roundStartBlockedReason(this.roundType, this.trackHasFinishZone);
    if (trackReason !== undefined) return trackReason;
    // ADR 0112: a Party following its host into this Lobby is never started
    // without, which would land it as spectators. Second to the Track's
    // reason because that one is the host's to fix; this one clears itself
    // within a Reservation's lifetime, whether the beans arrive or not.
    const arriving = this.reservations.liveCount();
    if (arriving > 0) return `Waiting for ${arriving} ${arriving === 1 ? "bean" : "beans"} to arrive.`;
    return undefined;
  }

  /**
   * Reserves a seat for every one of `accountIds`, or for none (ADR 0112) — a
   * Party is seated together or refused, never split by whoever connects
   * between two of its members.
   *
   * Refused outside LOBBY, and once a `start` is queued: `match.phase` only
   * leaves LOBBY on the tick after `start` (see `startRequested`), and a seat
   * granted in that window would be a bean walking into a Round already
   * loading. Refused, too, when the connections plus the seats already kept
   * leave no room for all of them — the same cap `ensureCapacity` holds a
   * connection to.
   *
   * Synchronous from the checks to the grant, so no connection, `start` or
   * other request can land between the two.
   */
  reserveSeats(accountIds: readonly string[]): SeatReservation {
    if (this.match.phase !== "LOBBY") return { refused: "this Lobby's Match has already started" };
    if (this.startRequested) return { refused: "this Lobby is starting" };
    const taken = this.sockets.size + this.reservations.liveCount();
    const needed = this.reservations.seatsNeededFor(accountIds);
    if (taken + needed > this.config.maxPlayers) {
      const free = Math.max(0, this.config.maxPlayers - taken);
      return { refused: `no room for ${accountIds.length} (${free} of ${this.config.maxPlayers} seats free)` };
    }
    // The seats kept here claim a contiguous block of join orders starting at
    // the next free one, so who hosts this Lobby stops depending on whose
    // socket wins the race in (review finding, 2026-09-19) — see
    // `Reservations.grant`. Advanced by what the grant actually took: an
    // Account already holding a live Reservation keeps the place it already
    // has, and takes no second one. A Reservation nobody spends simply leaves
    // its number unused — a gap no reader of `joinOrder` minds
    // (`resolveHostId` takes the lowest, `trackSpawn` the number modulo its
    // twelve slots).
    const { tokens, joinOrdersTaken } = this.reservations.grant(accountIds, this.joinCount);
    this.joinCount += joinOrdersTaken;
    // The Lobby's start blocker changed, and an idle Lobby only broadcasts on
    // change (ADR 0057) — this is one, as `loaded` is.
    this.snapshotDirty = true;
    return { granted: tokens };
  }

  /**
   * Whether this Match has more Rounds scheduled after the one that just
   * ended (M7 ticket 04/05, ADR 0049) — one accessor instead of
   * `roundResults.length < matchLength` written out at every call site
   * (code review): `advanceMatchPhase`'s own gate and the round-result-push
   * gate must never be able to disagree about what "the Match is over"
   * means.
   */
  roundsRemaining(): boolean {
    return this.roundResults.length < this.matchLength;
  }

  /**
   * Whether the Match should keep running on its own — Rounds remain
   * *and* enough Players are still here to run one (code review, M7 ticket
   * 04): `advanceMatchPhase`'s original single-Round Lobby gate
   * (`sockets.size >= playersToStart`, `lobby.ts`'s `start` handler) never
   * had a sibling for the automatic RESULTS → COUNTDOWN this ticket added,
   * so a population drop between Rounds (to 1, not to 0 — `advanceMatchPhase`'s
   * own `connectedPlayers === 0` check already handles that) used to carry
   * whoever was left into a fresh Round alone regardless of the Lobby's own
   * bar for starting one in the first place.
   *
   * `false` here makes RESULTS terminal exactly as it is with no Rounds
   * left — the Match can't silently deadlock waiting for players who, with
   * no reconnection built yet (ADR 0024), are never coming back this Match.
   */
  canContinueMatch(): boolean {
    return !this.matchAbandoned && this.roundsRemaining() && this.sockets.size >= this.config.playersToStart;
  }

  /**
   * A Round ended with every racer gone (all rows DNF — found live
   * 2026-09-18: both tabs refreshed mid-Round leave only spectator seats
   * behind). Such a Round is no result (`rows: []` is exactly what the API's
   * validation refuses), and a Match whose racers all left has nobody to
   * keep running Rounds for — so it makes RESULTS terminal through
   * {@link canContinueMatch}, the same level-not-edge reading that gate
   * already has. Cleared by {@link resetToFreshLobby} with the rest of the
   * Match-scoped state.
   */
  matchAbandoned = false;

  /**
   * Whether every currently connected Player has confirmed Ready on the
   * Standings Screen (M7 ticket 10, ADR 0051) — read live against `sockets`,
   * not a roster captured when RESULTS began, so a Player who disconnects
   * mid-Standings drops out of the gate the instant they leave rather than
   * blocking the rest forever. Vacuously `true` with nobody connected, same
   * as the Lobby's own `allReady` over an empty roster — never the deciding
   * factor, since `connectedPlayers === 0` already forces LOBBY first.
   */
  /**
   * Whether every connected client has this Round's world built (ADR 0089) —
   * what ends the LOADING phase. An empty server is deliberately `false`:
   * nobody having loaded is not everybody having loaded, the same reading
   * `allQualified` takes.
   */
  allLoaded(): boolean {
    if (this.sockets.size === 0) return false;
    for (const id of this.sockets.keys()) if (!this.loaded.has(id)) return false;
    return true;
  }

  allStandingsConfirmed(): boolean {
    for (const id of this.sockets.keys()) {
      if (!this.standingsReady.has(id)) return false;
    }
    return true;
  }

  /**
   * Loads the Assets `track` places that this Match does not hold yet, and
   * adds them to {@link library} (memory-footprint ticket 01, ADR 0080).
   * Every path that builds a world on a new Track awaits this first: the
   * boot, a Playtest reload, a Lobby Track pick, each drawn Round. A Match
   * built with a finished library (no loader) has nothing to load.
   */
  async loadAssetsFor(track: Track): Promise<void> {
    if (!this.config.assets) return;
    const loaded = await this.config.assets.load(assetIdsOf(track));
    this.library = { ...this.library, ...loaded };
  }

  /**
   * Draws every not-yet-drawn Round slot for this Match (M7 ticket 05, ADR
   * 0049) — kicked off once, the instant `start` fires (`lobby.ts`), well
   * before any Round but the first needs an answer: Round 1 alone almost
   * always outlasts a the API fetch. `matchStructure[0]` is filled in
   * synchronously, right here, from whatever `fetched`/`roundType` already
   * are — Round 1 keeps its existing pick mechanism (`selectTrack`/
   * `setRoundType`), this adds no second one for it.
   *
   * Sequential, not `Promise.all`-parallel: each draw updates
   * `usedTrackIds` before the next one runs, so "not drawn twice until the
   * pool is exhausted" holds across the whole Match, not just within one
   * batch of concurrent fetches.
   *
   * A single Round's draw failing (the API unreachable mid-fetch, no
   * published Track supports a forced Race) is caught and logged rather
   * than left to reject the whole Promise — every other Round still gets
   * its own attempt, and `matchLoop.ts`'s own COUNTDOWN transition falls
   * back to replaying the current Track for whichever slot never resolved,
   * rather than the Match silently stalling in RESULTS forever.
   */
  async buildMatchStructure(): Promise<void> {
    // Captured once, not re-read from `this.matchLength` on every loop
    // iteration (code review): a `setMatchLength` racing this draw — sent
    // in the post-`start`, pre-tick window before this ran — used to
    // desync the loop's own exit condition from the array `matchStructure`
    // was already sized to. That window is now closed at the source
    // (`lobby.ts` refuses `setMatchLength` once `startRequested`), but
    // capturing here is what actually guarantees this draw always builds
    // exactly the Match length it started with, regardless.
    const matchLength = this.matchLength;
    // Claims a fresh generation, invalidating whatever `buildMatchStructure`
    // call (if any) was still running — see `matchStructureSeq`'s own doc.
    // `resetToFreshLobby` bumps the same counter if this Match ends before
    // this call finishes, which is the check below actually exists for.
    const seq = ++this.matchStructureSeq;
    this.matchStructure = new Array<MatchStructureEntry | undefined>(matchLength);
    this.matchStructure[0] = { fetched: this.fetched, roundType: this.roundType };
    this.usedTrackIds.add(this.fetched.id);
    for (let i = 1; i < matchLength; i += 1) {
      // The server closed, or this Match ended (a fresh Lobby, possibly a
      // whole new Match already under way) — stop drawing for it either way.
      if (this.closed || seq !== this.matchStructureSeq) return;
      try {
        const drawn = await drawRound(
          {
            trackServiceUrl: this.config.trackServiceUrl,
            trackFetchRetryOptions: this.config.trackFetchRetryOptions,
            usedTrackIds: this.usedTrackIds,
            // Every Module a Track may place, as defs (M8 ticket 04): the
            // draw only asks whether a Track has a Finish Zone, which needs
            // no geometry, so it never waits on Assets it may not keep.
            library: { ...MODULE_LIBRARY, ...ASSET_PLACEMENT_MODULES },
          },
          this.pendingRoundPicks.get(i),
        );
        if (this.closed || seq !== this.matchStructureSeq) return;
        // The drawn Track's Assets load now, so the Round can never start
        // before its world can be built (memory-footprint ticket 01). A
        // Track that still cannot resolve counts as a failed draw, like one
        // that could not be fetched.
        await this.loadAssetsFor(drawn.fetched.track);
        resolveTrack(this.library, drawn.fetched.track);
        if (this.closed || seq !== this.matchStructureSeq) return;
        this.matchStructure[i] = drawn;
      } catch (err) {
        if (!this.closed && seq === this.matchStructureSeq) {
          console.error(`DON'T FALL: could not draw Round ${i + 1} of this Match — it will replay the current Track instead: ${(err as Error).message}`);
        }
      }
    }
  }

  /**
   * Builds a fresh simulation for `track` and re-seats every currently
   * connected Player into it at a spawn for their own join order (M4 ticket
   * 07) — the one thing the original boot-time-only reload (Track Builder's
   * own Playtest `?track=`) never had to do, since it only ever ran with
   * `sockets.size === 0`. A Lobby's host picking a different Track can do this
   * with others already sitting in it; nobody's Character should vanish just
   * because the world under it changed.
   *
   * Also resolves `roundRules` (M5 ticket 02, ADR 0041/0043) — `this.fetched`
   * is always updated by the caller before this runs (`selectTrack`, the
   * connect-time reload, going again), so its Time Limit is the fresh Track's
   * own. `timeLimitMsOverride` is this Match's own Round-level override,
   * folded through the same mechanism as everything else rather than staying
   * a special case (ticket 02's own requirement) — the only override this
   * ticket has a source for; a real per-Round choice (a future Lobby control)
   * is more overrides added to the same call, not a new mechanism.
   *
   * `fallBehavior`'s own "Track default" is always the constant `"respawn"`
   * (M5 ticket 03, ADR 0041) — no Track carries a Round-type opinion, so
   * every Round is a Race until the Lobby's own pick says otherwise
   * (`roundType`, ticket 07). `survivorTarget`, by contrast, is a real Track
   * default the Revision authors (ticket 07) — see {@link resolveRules}.
   *
   * Returns both rather than assigning `this.roundRules` as a side effect:
   * `new RapierSimulation` can throw (an unknown Module id), and only the
   * caller (`resetToFreshLobby`) knows it is safe to commit either field —
   * the same "build before discarding the old one" discipline it already
   * follows for `simulation` itself.
   */
  buildSimulationFor(track: Track): {
    simulation: RapierSimulation;
    roundRules: RoundRules;
    trackHasFinishZone: boolean;
    raceTargets: RaceTargets;
  } {
    const missing = missingAssetIds(track, this.library);
    if (missing.length > 0) {
      throw new Error(`the Track places Assets this server has not loaded: ${missing.join(", ")}`);
    }
    const roundRules = this.resolveRules();
    const resolved = resolveTrack(this.library, track);
    // Retired Modules (ADR 0064) resolve as plain geometry — audible here so
    // a Track whose pads silently stopped firing gets re-authored, not wondered at.
    for (const warning of resolved.warnings) console.warn(`DON'T FALL: ${warning}`);
    const simulation = new RapierSimulation({
      ...resolved,
      withDefaultCharacter: false,
      roundRules,
      ...(this.config.profileClock === undefined ? {} : { profileClock: this.config.profileClock }),
    });
    // Onto the Tick the server is already on, before anyone is seated in it
    // (M5 ticket 08) — a Character added at tick 0 and only then jumped
    // forward would carry a `phaseStartTick` thousands of Ticks in its own
    // past. No-op at construction, where `serverTick` is 0.
    simulation.syncTick(this.serverTick);
    for (const [playerId, player] of this.lobbyPlayers) {
      // A mid-Match spectator is in the Lobby's list, not in the Round (M7
      // ticket 08) — seating them here would drop a fresh Character into a
      // Race already in progress (M4 ticket 05's own refusal) or hand them
      // Score for Rounds they never played. They are seated by the next
      // fresh Match instead, once `resetToFreshLobby` has cleared the set.
      if (this.spectators.has(playerId)) continue;
      simulation.addCharacter(playerId, trackSpawn(track, player.joinOrder, this.library));
    }
    return {
      simulation,
      roundRules,
      trackHasFinishZone: resolved.finishZones.length > 0,
      raceTargets: raceTargets(resolved.checkpoints, resolved.finishZones),
    };
  }

  /**
   * The world-rebuild every "start a fresh Round on `track`" transition
   * shares (code review, M7 ticket 04) — {@link resetToFreshLobby} and
   * {@link startNextRound} used to duplicate this five-line sequence, which
   * is exactly the kind of drift the ticket's own "Watch out for" warns
   * about: a future fix to eliminated-Character reseating applied to one
   * copy and not the other would silently reintroduce the M5 ticket 08
   * ghost-Character bug on whichever path was missed.
   *
   * The replacement is built before the old one is disposed
   * (`buildSimulationFor` can throw — an unknown Module id in a Track
   * published against a newer library); disposing first would leave this
   * server holding a freed Rapier world for every subsequent tick.
   *
   * The Match's Tick epoch is *not* restarted (M5 ticket 08, found live).
   * `state.tick` and `serverTick` must keep agreeing (ADR 0027 addresses
   * every input by Tick number), and the way to keep them agreeing across a
   * rebuild is to hand the new simulation the Tick the server is already on
   * — `syncTick`, inside `buildSimulationFor` — not to send both back to
   * zero.
   *
   * Sending both to zero looks equivalent and is not, because a *connected*
   * client's own prediction tick is seeded into the server's Tick space
   * exactly once, at join (ADR 0027, `PredictionLoop.seed`), and never
   * re-seeded. Restarting the epoch under it left every client already in
   * the Lobby stamping inputs from an epoch the server no longer used: the
   * server's `takeFor(id, thisTick)` never found them, `lastInputTick` ran
   * away ahead of what the client had sent, and nobody who was already
   * connected could move again for the rest of the Match. Live, that meant
   * the host picking a different Track — or anyone going again from Results
   * — froze everyone who was already there, on a Track they could see and
   * not walk on.
   *
   * Sets `roundStartTick` too, even though whichever phase the caller lands
   * on next isn't RUNNING yet — harmless (the real RUNNING transition
   * overwrites it again before it's ever read) and one less thing for a
   * caller to remember.
   *
   * Callers own everything specific to their own trigger: the destination
   * phase, and whatever else that transition means (`fetched`, `dnf`,
   * `roundResults`, Ready state).
   */
  private rebuildSimulation(track: Track): void {
    const built = this.buildSimulationFor(track);
    this.simulation.dispose();
    this.simulation = built.simulation;
    this.roundRules = built.roundRules;
    this.trackHasFinishZone = built.trackHasFinishZone;
    this.raceTargets = built.raceTargets;
    this.checkpointArrivals = {};
    // A new world is a new thing to load (ADR 0089): every client must build
    // this Track before anyone's Round starts on it.
    this.loaded.clear();
    this.roundStartTick = this.serverTick;
  }

  /**
   * The one reset every "return to the Lobby" transition shares — the
   * connect-time `?track=` reload, a live Lobby `selectTrack`, and M4
   * ticket 08's return from Results: {@link rebuildSimulation} plus landing
   * in LOBBY and clearing everything Match-scoped.
   *
   * Also clears `startRequested` — a live `selectTrack`'s own `await` leaves a
   * window where a `start` sent right behind it can be validated and queued
   * against the *old* Lobby before this reset lands, then get spent by the
   * tick loop right after, starting a Round on the just-swapped-away Track.
   *
   * Also clears `roundResults` (M7 ticket 04, ADR 0049) — every way back to
   * a fresh Lobby is the end of whatever Match was running, if any, and a
   * second Match must not inherit the first one's Score. `matchStructure`/
   * `matchStructurePromise`/`usedTrackIds` are Match-scoped the same way
   * (ticket 05) — cleared here too, for the identical reason.
   *
   * **Ticket 08 resolution of the known gap above:** the wipe stands, but it
   * is a Match boundary now, not corruption. A dropped Player's Score has a
   * lifetime independent of their socket *within* a Match — the union of
   * `roundResults` rows, Match-scoped and attached to neither `dnf` (cleared
   * every Countdown) nor `eliminated` (per-Character), so later Rounds score
   * zero for the absence while earlier ones keep paying. Only an empty
   * server wipes, and then there is nobody left to read the Score: without
   * reconnection (`reclaim`, still unimplemented per ADR 0024) a returning
   * Player is a new id anyway, so preserving rows across an empty Lobby
   * would only leak stale totals into whatever Match starts next.
   */
  resetToFreshLobby(track: Track): void {
    // Cleared before the rebuild below, not after it: a fresh Match seats
    // everyone waiting (M7 ticket 08 — a mid-Match spectator plays from the
    // next Match), and the rebuild is what does the seating.
    this.spectators.clear();
    this.rebuildSimulation(track);
    this.match = { phase: "LOBBY", phaseStartTick: this.serverTick };
    this.startRequested = false;
    this.roundResults = [];
    this.round = 0;
    this.standingsDeadlineMs = null;
    this.bettingClosedRound = 0;
    this.roundTrackIds = [];
    this.matchNicknames.clear();
    this.matchAccountIds.clear();
    this.matchColors.clear();
    this.matchSkins.clear();
    this.matchHats.clear();
    this.totalFalls = {};
    this.matchSurvivalMs.clear();
    this.matchGrabsBroken.clear();
    this.resultsSavedMatchId = null;
    this.resultsSavedAtMs = null;
    this.savingResults = false;
    this.lastSaveAttemptTick = null;
    this.matchAbandoned = false;
    this.closeRequested = false;
    this.pendingRoundPicks.clear();
    this.matchStructure = [];
    this.matchStructurePromise = undefined;
    this.usedTrackIds.clear();
    // Invalidates any `buildMatchStructure` still running for whatever
    // Match just ended — see `matchStructureSeq`'s own doc.
    this.matchStructureSeq += 1;
  }

  /**
   * Rebuild the world for the Round following this one (M7 ticket 04, ADR
   * 0049) — {@link rebuildSimulation}, landing in COUNTDOWN instead of
   * LOBBY: a Match's later Rounds never pass through the Lobby.
   *
   * This is also where an eliminated Character comes back properly (M5
   * ticket 08's own "world rebuilt, not just phase reset" fix applies here
   * too — `buildSimulationFor` re-seats every connected Player fresh, so
   * nobody carries a disabled collider or a stale `finishTick` into the
   * next Round). `dnf` is deliberately left alone here — the tick loop
   * already clears it on every entry into COUNTDOWN, this path included.
   */
  startNextRound(track: Track): void {
    this.rebuildSimulation(track);
    // Into LOADING, not straight into the Countdown (ADR 0089): every client
    // has a new Track to build before this Round can start.
    this.match = { phase: "LOADING", phaseStartTick: this.serverTick };
  }
}
