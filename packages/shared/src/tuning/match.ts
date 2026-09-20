import { msToTicks } from "./clock.js";

/**
 * A Match's structure: Round clock, Survival, phases, length, Score, its end —
 * configuration, not feel. Part of `tuning/` (see `index.ts`).
 */

// --- Round clock (M4 ticket 03, ADR 0038) -----------------------------------

/**
 * The Time Limit a Revision published before M4 — the M1 seed included —
 * backfills to (ADR 0038), and what the Track builder offers as the default
 * for a new one. Three minutes: comfortably more than any current Track needs,
 * so backfilling it can't make an existing Track unraceable.
 */
export const DEFAULT_TIME_LIMIT_MS = 180_000;

/**
 * Bounds on an authored Time Limit. Not balance values — a floor low enough
 * to be worth authoring at all and a ceiling that keeps a typo (a stray zero)
 * from producing a Round nobody can wait out. Enforced by the API on
 * publish, so a Revision can never carry a nonsense clock.
 */
export const MIN_TIME_LIMIT_MS = 10_000;
export const MAX_TIME_LIMIT_MS = 30 * 60_000;

// --- Survival (M5 ticket 05, ADR 0041/0042) ---------------------------------

/**
 * The Survivor Target (CONTEXT.md) a Track backfills to when it carries no
 * default of its own, and what the Track builder offers for a new one
 * (ticket 07). 1: winner-takes-all, last one standing — the Final Race
 * form's own target (CONTEXT.md), and the smallest number that still means
 * something (0 would end every Survival Round before it could start). A
 * Race never reads this field at all.
 *
 * Ticket 07 gave this a real authored input (the Track builder's own field,
 * written with the Revision exactly as the Time Limit is), so it now has the
 * `MIN_`/`MAX_` siblings ticket 05 deferred.
 */
export const DEFAULT_SURVIVOR_TARGET = 1;

/**
 * Bounds on an authored Survivor Target (ticket 07). Absolute, not relative
 * to how many Players actually joined — that was ticket 05's open question,
 * and absolute wins for the same reason the Time Limit's bounds are: this is
 * validated at publish time, when a Revision is frozen forever (ADR 0032),
 * and nothing at publish time knows how many Players a future Lobby will
 * hold. A target larger than the roster simply ends its Round the moment it
 * starts, which is a Lobby's problem to surface, not a Revision's to prevent.
 *
 * The ceiling is one below ADR 0011's twelve-Player ceiling: at twelve there
 * is no Round left to play, and "everybody survives" is not a Survival Round.
 */
export const MIN_SURVIVOR_TARGET = 1;
export const MAX_SURVIVOR_TARGET = 11;

// --- Match phase (M4 ticket 04, ADR 0040) -----------------------------------

/**
 * How long the Countdown holds before a Round is released (ADR 0040). Long
 * enough to read "3, 2, 1" and get your hands on the keys; short enough that
 * it isn't the part of the Match you remember.
 */
export const COUNTDOWN_MS = 3_000;

/** {@link COUNTDOWN_MS} in Ticks — the Countdown is derived from the server Tick, never a wall clock. */
export const COUNTDOWN_TICKS = msToTicks(COUNTDOWN_MS);

/**
 * How many connected Players it takes to start a Round while there is no
 * Lobby to press start in (M4 ticket 04; the Lobby itself is ticket 07).
 * M4 is a two-player slice (ADR 0011's "validated at 2, shaped for 12"), so
 * two is what a Round waits for.
 *
 * The Match server takes this as config, so a developer working alone can run
 * with one — otherwise a single-browser Playtest would sit in the Lobby
 * forever, with nothing in M4 yet able to press start.
 */
export const PLAYERS_TO_START = 2;

/**
 * How many connections one Match server accepts before refusing the next one
 * outright (grilling session, 2026-09). Below ADR 0011's own architected
 * ceiling ("validated at 2, shaped for 12") — 10 is today's chosen
 * operational default, not a hard engineering limit, so it is configurable
 * the same way {@link PLAYERS_TO_START} is (env var, then this constant).
 */
export const MAX_PLAYERS = 10;

/**
 * How long ROUND_END holds before the Results (M4 ticket 05). A beat, not a
 * screen: long enough to see that the Round is over where you are standing,
 * before the view changes.
 */
export const ROUND_END_MS = 2_500;

/** {@link ROUND_END_MS} in Ticks — every Match duration is measured in Ticks (ADR 0004). */
export const ROUND_END_TICKS = msToTicks(ROUND_END_MS);

/**
 * Ceiling on how long the Standings Screen waits for every connected Player
 * to confirm Ready before advancing into the next Round anyway (M7 ticket
 * 10, ADR 0051) — a safety net against one AFK Player freezing a
 * multi-Round Match, not the expected path. A starting number, not a final
 * one; re-feel it live, same as {@link ROUND_END_MS}'s own warning.
 */
export const STANDINGS_READY_TIMEOUT_MS = 10_000;

// --- Match length (M7, ADR 0049) --------------------------------------------

/**
 * How many Rounds a Match runs before it ends (M7 ticket 04, ADR 0049) —
 * the Lobby's own default (ticket 05 lets the host change it). Three:
 * long enough that a bad first Round doesn't decide the Match, short
 * enough that a Match stays a single sitting.
 */
export const DEFAULT_MATCH_LENGTH = 3;

/**
 * Bounds on a host-set Match length (M7 ticket 05). 1 is the escape hatch
 * that keeps a single-Round Match — Track-builder Playtest among them —
 * behaving exactly as it always has; 10 is a party-game ceiling, not a
 * balance number.
 */
export const MIN_MATCH_LENGTH = 1;
export const MAX_MATCH_LENGTH = 10;

// --- Score (M7 ticket 03, ADR 0049) -----------------------------------------

/**
 * The percentile-normalised Score a Round's own first place pays out — a
 * feel constant, not a balance one (ticket 03): a round number that reads
 * clearly on the Standings Screen. 100 so a placement fraction (e.g. 3rd of
 * 6) shows up as a legible number rather than a decimal.
 */
export const MAX_ROUND_SCORE = 100;

/**
 * Flat bonus a Round adds on top of its percentile Score for Qualifying
 * (ADR 0049: Qualification is redefined as the top scoring tier, not a gate
 * — everyone advances regardless). Smaller than {@link MAX_ROUND_SCORE} so
 * it rewards Qualifying without letting a last-place Qualifier out-score a
 * high-placing non-Qualifier by an amount placement itself never could.
 */
export const QUALIFICATION_SCORE_BONUS = 20;

// --- Match end (ADR 0059) ---------------------------------------------------

/**
 * How long a match server waits after its results are saved before closing
 * itself with Players still connected. Healthy clients navigate to the
 * results page within a tick of `matchOver`; anyone still here after this is
 * wedged, and holding a finished Match's simulation open for them is exactly
 * what this closes. The ordinary path — last socket closes, server follows —
 * needs no waiting at all.
 */
export const MATCH_OVER_CLOSE_GRACE_MS = 60_000;

// --- A Round's Track fetch (ADR 0028; ticket 12) ----------------------------

/**
 * Total bounded time the Match server keeps retrying its startup Track fetch
 * before giving up loudly (ticket 12) — covers the API still coming up
 * (e.g. Docker container start order isn't instant), not the API being
 * genuinely gone.
 */
export const TRACK_FETCH_MAX_WAIT_MS = 30_000;

/** Delay between retry attempts while the startup Track fetch keeps failing. */
export const TRACK_FETCH_RETRY_DELAY_MS = 1_000;

/**
 * Per-attempt timeout on the startup Track fetch itself — bounds a single
 * request that hangs (the API accepts the connection but never
 * responds) so it can't silently eat the whole {@link TRACK_FETCH_MAX_WAIT_MS}
 * budget on one stuck attempt instead of retrying.
 */
export const TRACK_FETCH_ATTEMPT_TIMEOUT_MS = 5_000;

// --- Parties (M15 ticket 16, ADR 0112) --------------------------------------

/**
 * The most Accounts one Party holds, pending invites included (ADR 0112, the
 * user's choice). A public Lobby of {@link MAX_PLAYERS} stays mostly
 * strangers; bigger groups have FRIENDS private Lobbies.
 */
export const PARTY_MAX_SIZE = 4;

/** How long a Party code works before the host is shown a new one — the card's "works for 10 minutes". */
export const PARTY_CODE_TTL_MS = 10 * 60_000;

/** How long a Party invite waits for an answer — the Lobby invite's own TTL. */
export const PARTY_INVITE_TTL_MS = 5 * 60_000;

/**
 * How long a member's Account socket may stay closed before they drop out of
 * their Party — the online window friends presence already uses, so a page
 * reload or a network blip never costs anyone their Party.
 */
export const PARTY_OFFLINE_GRACE_MS = 90_000;

/** How often the API records a presence beat for each open Account socket (ADR 0110's 30 s cadence). */
export const ACCOUNT_BEAT_MS = 30_000;

/**
 * How long a Lobby keeps a seat for an Account the broker sent there (ADR
 * 0112). Long enough for a client to open its socket; short enough that one
 * that never arrives does not hold a Lobby's start for long.
 */
export const SEAT_RESERVATION_TTL_MS = 15_000;
