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
 * How fast the viewer's playout floor may rise on its own, in ms per ms of
 * local time (ADR 0109). The floor is the least-delayed Snapshot arrival — the
 * Interpolation Delay is counted from it, not from the server's "now", so
 * one-way latency no longer eats it — and it drops at once to any arrival
 * that lags less. 3%: in steady play it rides a few ms above the least lag,
 * and a server ticking up to 3% slow is kept up with rather than run ahead of
 * (a bare `setInterval` ran ~2% slow natively, far more in Docker — which is
 * why ADR 0109 also gives the server a scheduler that holds a true 30 Hz).
 * A step up in lag is not left to this rate, which took ~10 s to follow
 * +300 ms: {@link PLAYOUT_FLOOR_WINDOW_MS} catches the floor up within a
 * window's length.
 */
export const PLAYOUT_FLOOR_RISE_RATE = 0.03;

/**
 * How far back (ms of local time) the playout floor's lower bound looks (ADR
 * 0109): the floor is never below the least lag of the Snapshots that arrived
 * in this long. A lag that steps up — a Wi-Fi roam, a route change, a server
 * stall its scheduler forgave, which shifts every later Snapshot for good — is
 * then taken up once the window has seen only the new lag, where the rise
 * alone kept the drawn world past the newest Snapshot, stepping at the
 * snapshot rate, for 3 s after +100 ms. A step up is now followed within
 * this long plus the slew ({@link PLAYOUT_SLEW_MAX_RATE}) — it stops holding
 * 1.4 s after +100 ms and 2.5–2.9 s after +200–260 ms — and one big enough
 * to pass {@link PLAYOUT_SNAP_MS} (~280 ms) in ~1.4 s, through one backward
 * jump. One second: the harness's steady-state numbers are identical with and
 * without it at RTT 2–120 ms, 60 and 144 Hz, since the rise already sits
 * above a second's least lag.
 */
export const PLAYOUT_FLOOR_WINDOW_MS = 1000;

/**
 * Longest gap (ms) between two Snapshot arrivals across which
 * {@link PLAYOUT_FLOOR_WINDOW_MS}'s bound still holds (ADR 0109). Past it the
 * window does not count until arrivals have covered a whole one again, and the
 * floor is {@link PLAYOUT_FLOOR_RISE_RATE}'s alone. Two cases need that: the
 * burst that lands when a transport stall clears, whose Snapshots lag by up to
 * the stall — a window of little else would pull the floor up by that much
 * and draw the world back — and an idle phase's sparse Snapshots (ADR 0057).
 * 200 ms is six Snapshot intervals at 30 Hz, far past any jitter.
 */
export const PLAYOUT_FLOOR_WINDOW_MAX_GAP_MS = 200;

/**
 * Time constant (ms) of the playout clock's correction toward its target
 * (ADR 0109): each frame it closes `elapsed / this` of the gap. In steady play
 * the floor moves a few ms at a time, so the drawn world runs within ~2% of
 * real time on any frame (250 ms let that reach ~4%).
 */
export const PLAYOUT_SLEW_TIME_MS = 500;

/**
 * The most the playout clock may run fast or slow while it corrects, as a
 * fraction of elapsed wall time (ADR 0109). Reached only past a 75 ms gap
 * (`PLAYOUT_SLEW_TIME_MS × this`), so in practice only when the floor has
 * moved a long way at once: dropped — a first Snapshot received 200 ms late is
 * within a third of a Tick in 2 s — or risen through
 * {@link PLAYOUT_FLOOR_WINDOW_MS} after a step up in lag, which it then
 * follows at this rate. Valve's clock correction goes to 20%.
 */
export const PLAYOUT_SLEW_MAX_RATE = 0.15;

/**
 * Gap (ms) past which the playout clock jumps to its target instead of
 * slewing (ADR 0109): when the target moves this far at once. In practice
 * that is the floor dropping because the first Snapshot landed late, and the
 * drawn world jumps forward. It jumps backward — the only way it ever does —
 * when the lag steps up by more than this plus the few tens of ms the floor
 * rose meanwhile: once {@link PLAYOUT_FLOOR_WINDOW_MS} has seen the new lag,
 * or across an arrival gap over ~8 s, long enough for the rise alone. At
 * {@link PLAYOUT_SLEW_MAX_RATE} this much would take seconds of visible slow
 * or fast motion, which costs more than one jump.
 */
export const PLAYOUT_SNAP_MS = 250;

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

/**
 * Least speed (units/s) the server gives a handed-back Prop for its error
 * offset to shrink along that motion only as fast as the drawn server pose
 * advances (ADR 0022, amended by ADR 0109; `decayHandedBackError`), so a Prop
 * still sliding is drawn pausing rather than moving backward while the
 * server's past catches up with where the prediction left it. Below it the
 * offset decays freely: a Prop that slow is settling, and an offset that is a
 * real mispredict (the server's stopped short) is let go back rather than held
 * for as long as the body creeps — Rapier only sleeps one after half a second
 * under ~0.1 u/s. Nothing is lost under it: the offset a hand-back leaves on a
 * Prop that slow is under {@link PROP_ERR_NEAR_M} at any RTT to 120 ms, and at
 * the near half-life that never shrinks faster than the Prop moves.
 */
export const PROP_HANDBACK_MIN_SPEED = 0.5;

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
 * How far behind (ms) a remote rig's drawn yaw trails its Character's
 * interpolated `facing` through a steady turn — the smoothing time of the
 * critically damped follow every remote rig is turned through (ADR 0109,
 * `remoteYaw.ts`). Render-only smoothing of a network artefact, like
 * {@link CAPSULE_ERR_HALFLIFE_MS}: a Tick the server ran on a repeated input
 * holds the facing still for 33 ms and the next steps it twice as far, and a
 * turn shows that where a run does not. ADR 0109's source fixes make such
 * Ticks rare; this evens out the rest.
 *
 * Measured end to end, on the real integrated classes with every ADR 0109
 * fix in: the smallest value that keeps a turning rig's still time (frames
 * turning at under a tenth of the turn's mean speed) under 0.5 frame/s on
 * typical links. It costs 17 ms of turn lag on a 60 Hz screen and 21.5 ms
 * on a 144 Hz one (the trail is this less half a frame). After the facing
 * stops, the drawn turn stays above a tenth of its speed for 49 ms — longer
 * than a one-Tick hold's 33 ms — where 20 ms keeps it for only 39. The
 * one-Tick-hold tests (`remoteYaw.test.ts`, the pool's) run at the worst
 * frame phase and fail below ~24.8 ms, so they bound this value from below.
 */
export const REMOTE_YAW_SMOOTH_MS = 25;

/**
 * Below this magnitude (units) the local Character's render-time correction
 * offset (ADR 0026) is floored to exactly zero instead of left to fade forever
 * at diminishing, invisible fractions — a few millimetres.
 */
export const CAPSULE_ERR_FLAT_EPSILON_M = 0.0005;

// --- The prediction LEAD (ADR 0021, ADR 0026, ADR 0109; `net/lead.ts`) ------

/**
 * The low edge of the band the client's LEAD feedback holds the server's
 * smoothed `commandQueueDepth` in (ADR 0021): under it the queue is starving —
 * the server is about to run a Tick no input has arrived for and repeat the
 * last one — so a tick is injected, at most once per
 * {@link LEAD_INJECT_COOLDOWN_MS}.
 */
export const QUEUE_DEPTH_LOW = 1;

/**
 * The high edge of the LEAD band (ADR 0021): over it the queue is fat — every
 * input waits longer than it has to before the server runs it — so the
 * prediction clock drains by {@link LEAD_DRAIN_TIME_FRACTION}. Between the two
 * edges nothing is adjusted, which is what holds the queue near ~1.5 without
 * hunting.
 */
export const QUEUE_DEPTH_HIGH = 2.5;

/**
 * The smoothed depth a fresh LEAD controller starts from (ADR 0021): inside
 * the band, where the controller holds the queue, so the average begins at
 * "healthy" and the first reports move it from there. Nothing acts on it
 * before one arrives ({@link LEAD_FEEDBACK_FRESH_MS}).
 */
export const QUEUE_DEPTH_START = 1.5;

/**
 * How far each reported `commandQueueDepth` moves the LEAD's moving average,
 * as a share of the way to it (ADR 0021): a fifth, so five reports — ~170 ms
 * at {@link SNAPSHOT_HZ} — move it two-thirds of the way. A single report is
 * one Tick's queue, which jitter alone swings by a tick or two; the average is
 * what the band is judged on. Only the end of
 * {@link LEAD_DRAIN_SATURATED_FRACTION}'s drain reads the newest report.
 */
export const QUEUE_DEPTH_REPORT_WEIGHT = 0.2;

/**
 * Share of each frame's elapsed time the client's LEAD feedback gives up while
 * the server's command queue sits over the target band (ADR 0026, ADR 0021's
 * gentle-drain amendment, counted in time per ADR 0109) — continuous and
 * small, never a full tick at once, which would yank the render-interpolation
 * alpha in a single frame (a second, connection-quality-scaled backward pop,
 * distinct from the position correction {@link RECONCILE_POSITION_EPSILON}
 * governs).
 *
 * It is time dilation of the owner's own prediction: while it runs, the local
 * Character is drawn this much slower, and each tick sent carries 1/(1 − this)
 * of the body's usual turn. So the gentlest value that still converges (ADR
 * 0109's harness: a true 30 Hz server, 60–240 Hz displays, RTT 40–120 ms). At
 * 0.1 a surplus tick is gone after 333 ms of draining, 0.8–1 s after it
 * appears once the feedback has seen it. 0.3 recovered 0.3 s sooner but
 * slowed the owner by 30% and left the per-tick turn less even (CV 5–13%
 * against 3–8%). 0.05 was a little smoother but took 1.3–1.5 s. The 3 ticks a
 * second 0.1 can drain is far more than a server on its true 30 Hz leaves
 * over, though not enough for the 25 Hz a `setInterval` server drifted to in
 * Docker before ADR 0109. It is too slow to climb out of a surplus the size of
 * the server's whole queue, which is what {@link LEAD_DRAIN_SATURATED_FRACTION}
 * is for.
 */
export const LEAD_DRAIN_TIME_FRACTION = 0.1;

/**
 * The LEAD's drain once the server's queue is at its cap — a smoothed depth of
 * {@link MAX_QUEUED_INPUTS} − 1 or more, and the newest report there too (ADR
 * 0109). There the server keeps only the newest inputs and sheds the oldest,
 * which is the one it was about to run, so none of this Player's input is
 * applied until the lead comes back down. At {@link LEAD_DRAIN_TIME_FRACTION}'s
 * 3 ticks a second that took 2.2 s after a 500 ms server stall and 7.3 s after
 * a 1 s one, where the frame-counted controller before ADR 0109 took 0.8 s and
 * 3.5 s at 60 Hz.
 *
 * The trade: the owner's own Character is drawn at half speed while it runs,
 * and each tick it sends carries twice the body's usual turn — but the server
 * is already discarding those inputs, so a brief half-speed owner costs less
 * than a second of ignored input. Measured (real `PredictionLoop`,
 * `InputRouter` and controller; a true 30 Hz server sending a Snapshot every
 * other Tick, 40 ms one-way, 60 and 144 Hz alike): 0.5 takes the 500 ms stall
 * to 0.77 s and the 1 s one to 1.8 s, and a 3 s spike of +200 ms one-way from
 * 1.4 s to 0.8 s. 0.3 left 2.7 s on the 1 s stall; 0.75 saved another 0.5 s
 * there for a quarter-speed owner. It never fires in steady play: nothing
 * reaches the cap without a stall or a spike.
 *
 * How fast it gets out depends on latency: the drain runs on for a round trip
 * after the queue is back under the cap, and a long enough round trip carries
 * the queue on into starvation. With a Snapshot every Tick, as
 * {@link SNAPSHOT_HZ} sends them, the two stalls take 0.6 s and 1.6 s at 40 ms
 * one-way (2.6 s and 7.6 s at the ordinary drain), and 1.6 s and 2.6 s at
 * 150 ms, starving 7–10 Ticks after the queue is back under the cap. Left on
 * the average rather than the newest report, the drain starved 21 there and
 * took 1.9 s and 2.9 s.
 */
export const LEAD_DRAIN_SATURATED_FRACTION = 0.5;

/**
 * Least time (ms) between two ticks the client's LEAD feedback injects while
 * the server's command queue is starving (ADR 0021, ADR 0109). An inject shows
 * in the reported depth a round trip later, plus the time the per-snapshot
 * moving average takes to move, so a shorter cooldown fires a second tick
 * before the first is seen: after a 200 ms jump in RTT, 200 ms overshot to a
 * smoothed depth of 2.95 where 300 ms held 2.5, and every surplus tick then
 * costs a second of {@link LEAD_DRAIN_TIME_FRACTION} to drain. The ticks
 * starved on the way were the same at 100–400 ms.
 */
export const LEAD_INJECT_COOLDOWN_MS = 300;

/**
 * How recent (ms) the server's last queue-depth report must be for the LEAD to
 * act on it (ADR 0109). The depth only changes when a Snapshot arrives, and
 * outside COUNTDOWN, RUNNING and ROUND_END a Snapshot is sent only when
 * something in it changed (ADR 0057) while the server keeps consuming inputs
 * every Tick — so an average left outside the band on the last live Snapshot
 * used to go on injecting or draining blind through the whole of RESULTS (up
 * to 30 ticks of lead in its 10 s), and the next Round on the same Track could
 * start with the server ignoring this Player's input for seconds. A stalled
 * link is the same case.
 *
 * Several Snapshot intervals at {@link SNAPSHOT_HZ}, so ordinary jitter never
 * gates a live Round, and shorter than {@link LEAD_INJECT_COOLDOWN_MS}, so one
 * idle-phase report can buy at most one inject.
 */
export const LEAD_FEEDBACK_FRESH_MS = 250;

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
