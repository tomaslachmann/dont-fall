import type { TICK_RATE_HZ } from "./clock.js";

/**
 * Prediction, reconciliation and the wire (ADR 0013/0018–0027) —
 * configuration, not feel. Part of `tuning/` (see `index.ts`).
 */

// --- Wire protocol v2 (ADR 0018–0025; docs/networking-model.md) -------------

/**
 * Snapshots per second the server broadcasts. Decoupled from {@link TICK_RATE_HZ}
 * in code (ADR 0020); M2 ships at 1:1 (30/30). The target for the 12-player path
 * is 20, adopted only after binary encoding lands.
 */
export const SNAPSHOT_HZ = 30;

/**
 * How long (ms) a disconnected Character stays parked and its `sessionToken`
 * stays valid (ADR 0024). 90 s — the returning-player hold for a co-op/party
 * game (revised up from a 45 s draft, which was the separate "new player claims
 * the freed slot" window).
 */
export const GRACE_WINDOW_MS = 90_000;

/**
 * `cl_interp_ratio` — how many snapshot intervals of playout delay the client
 * renders the non-predicted world behind (ADR 0020). Valve's default and the
 * near-universal smoothness-vs-accuracy compromise. Interp delay =
 * `clamp(INTERP_RATIO / snapshotHz * 1000, min, 250)` ms.
 */
export const INTERP_RATIO = 2;

/**
 * How many of the last unacknowledged inputs the client re-sends in every
 * packet (ADR 0021) — a fixed count, not RTT-adaptive (Quake `cl_packetdup`).
 * The packet always carries the current tick's input plus this many older ones.
 */
export const INPUT_REDUNDANCY = 2;

/**
 * How many un-applied inputs the server keeps queued per client (ADR 0021).
 * A fast or hitching client can briefly outrun the tick rate; keeping only
 * the newest few means the server never falls a growing number of ticks
 * behind a client's intent.
 *
 * Lives here with {@link INPUT_REDUNDANCY} and {@link MAX_BUFFERED_INPUT_TICKS}
 * rather than in the server: the four numbers describe one pipeline, and
 * anyone tuning it should find them together.
 */
export const MAX_QUEUED_INPUTS = 6;

// --- Pushed-Prop prediction (ADR 0022 — supersedes ADR 0016) ----------------

//
// The one Prop the local Character is contacting is simulated locally for a
// short grace after last contact; every *other* Prop is interpolation-only. The
// predicted Prop's Rapier body always holds the authoritative state — what is
// *rendered* is the sim pose plus a render-time error offset that decays
// exponentially toward zero (Glenn Fiedler, "State Synchronization"). All four
// smoothing numbers below are verbatim from Fiedler.

/**
 * Ticks a Prop stays locally predicted after the local Character last contacted
 * it. A **derived heuristic**, not a documented formula:
 * `clamp(ceil(RTT / TICK_MS), 2, 8)` at the call site once RTT is known — long
 * enough that the server's acknowledgement of the push is already in the
 * interpolation buffer by the time prediction hands back. This constant is the
 * fallback used until {@link TimeSync} has an RTT estimate.
 */
export const PROP_PREDICT_GRACE_TICKS = 4;

/** Lower / upper caps on the RTT-derived grace (ticks). */
export const PROP_PREDICT_GRACE_MIN_TICKS = 2;
export const PROP_PREDICT_GRACE_MAX_TICKS = 8;

/** Position error at/below which the offset decays slowly ({@link PROP_ERR_HALFLIFE_NEAR_MS}). Fiedler: "25cms or less". */
export const PROP_ERR_NEAR_M = 0.25;

/** Position error at/above which the offset decays fast ({@link PROP_ERR_HALFLIFE_FAR_MS}). Fiedler: "1m error or above". */
export const PROP_ERR_FAR_M = 1.0;

/** Half-life (ms) of the render-time error offset for a small error — Fiedler's ≈0.95/frame\@60. */
export const PROP_ERR_HALFLIFE_NEAR_MS = 200;

/** Half-life (ms) of the render-time error offset for a large error — Fiedler's ≈0.85/frame\@60. */
export const PROP_ERR_HALFLIFE_FAR_MS = 70;

/** Position error (units) past which the offset is dropped and the Prop visually teleports — a genuine desync, not rubber-banded. Fiedler (2004). */
export const PROP_ERR_HARDSNAP_M = 2.0;

/**
 * Quaternion-dot band the rotation error offset blends its decay rate across:
 * at/above `_HI` (small angular error) it uses the near half-life, at/below
 * `_LO` (large error) the far one. Fiedler, verbatim.
 */
export const PROP_ERR_ROT_DOT_LO = 0.1;
export const PROP_ERR_ROT_DOT_HI = 0.5;

/**
 * `|error.rotation.w|` below which the rotation offset is dropped and the Prop's
 * orientation visually snaps — the rotation analogue of {@link PROP_ERR_HARDSNAP_M}.
 * `0.26` ≈ a 150° error; only a genuine desync reaches it.
 */
export const PROP_ERR_ROT_HARDSNAP_DOT = 0.26;

/** Residual position offset (units) below which a handed-back Prop is treated as settled and re-pinned. */
export const PROP_ERR_SETTLED_M = 0.02;

/** `|error.rotation.w|` above which the residual rotation offset counts as settled (≈3.6°). */
export const PROP_ERR_ROT_SETTLED_DOT = 0.9995;

// --- Client reconciliation (M2 ticket 05, ADR 0013) -------------------------

/**
 * How far (units) the client's *tick-aligned* prediction may sit from the
 * server's authoritative position before the *simulation* reconciles — the
 * comparison is same-tick (predicted position at the acknowledged input tick
 * vs the server's report for that tick). ADR 0026: this is a float-noise
 * floor, not a "some visible drift is fine" gate — a hard `0.2` threshold
 * used to equal exactly one 30 Hz walk-step (`WALK_SPEED / TICK_RATE_HZ`),
 * which let an ordinary one-tick phase slip pop the rendered pose. The
 * simulation now reconciles on any real disagreement; the render-time
 * {@link CAPSULE_ERR_HALFLIFE_MS} offset is what makes that invisible.
 */
export const RECONCILE_POSITION_EPSILON = 0.02;

/**
 * Position error (units) past which a reconciliation drops the local
 * Character's render-time error offset and snaps outright instead of easing —
 * that far apart is a genuine desync, not something to rubber-band across
 * (ADR 0026). Reuses {@link PROP_ERR_HARDSNAP_M}'s Fiedler-derived value.
 */
export const RECONCILE_HARDSNAP_M = PROP_ERR_HARDSNAP_M;

/**
 * Half-life (ms) of the local Character's own render-time correction offset
 * (ADR 0026) — the same decaying-offset mechanism {@link PROP_ERR_HALFLIFE_NEAR_MS}
 * ships for pushed Props, but with a single fixed half-life tuned for a capsule
 * you are steering rather than a shoved crate. Valve `cl_smoothtime` and Unreal
 * `NetworkSimulatedSmoothLocationTime` both default to 0.1 s; the harness sweep
 * (`predictionRegression.harness.test.ts`) found 75–200 ms all clean and 50 ms
 * leaking a visible ~2.7 cm.
 */
export const CAPSULE_ERR_HALFLIFE_MS = 100;

/**
 * Below this magnitude (units) the local Character's render-time correction
 * offset (ADR 0026) is floored to exactly zero instead of left to fade forever
 * at diminishing, invisible fractions — a few millimetres.
 */
export const CAPSULE_ERR_FLAT_EPSILON_M = 0.0005;

/**
 * Fraction of a tick the client's LEAD feedback drains per frame while the
 * server's command queue sits over the target band (ADR 0026, ADR 0021's
 * gentle-drain amendment) — continuous and small, never a full tick at once,
 * which would yank the render-interpolation alpha in a single frame (a second,
 * connection-quality-scaled backward pop, distinct from the position
 * correction {@link RECONCILE_POSITION_EPSILON} governs).
 */
export const LEAD_DRAIN_FRACTION = 0.15;

/**
 * Cap on how many recent prediction ticks the client keeps buffered inputs /
 * positions for (~4 s at {@link TICK_RATE_HZ}). A reconciliation never needs to
 * reach past roughly one round trip; this only bounds memory if snapshots stop
 * arriving (a stalled or dropped connection).
 */
export const MAX_BUFFERED_INPUT_TICKS = 120;

// --- Tick-addressed server input (ADR 0027) ---------------------------------

/**
 * Clamp bounds (ticks) on the one-time initial LEAD estimate — `ceil((rtt/2) /
 * TICK_MS) + 1`, Overwatch's "½ RTT + one command frame" — used to seed the
 * client's `predictionTick` into the server's own tick space on the first
 * estimate (ADR 0027). Ongoing drift is corrected by the existing
 * `commandQueueDepth` feedback (ADR 0021); this only sets a sane starting point
 * so that feedback isn't fighting a wildly-wrong guess for the first second.
 */
export const INITIAL_LEAD_TICKS_MIN = 1;

/**
 * 6, not the ongoing LEAD band's smaller ceiling: this only sizes the ONE-TIME
 * initial guess before any feedback has run, and a worse-than-median RTT
 * (`docs/…/13-tick-addressed-server-input.md`'s own "bad" profile — 90 ms
 * one-way, ±45 ms jitter, ~270 ms worst-case RTT) needs `ceil(270/2/33.3) + 1
 * = ceil(4.05) + 1 = 6` ticks of lead just to land the input in time on the
 * very first packets. Clamping this to the same low ceiling as steady-state
 * LEAD understates a genuinely bad connection's real starting requirement —
 * pinned by `tickAddressedInput.integration.test.ts` against a real,
 * timer-driven server.
 */
export const INITIAL_LEAD_TICKS_MAX = 6;
