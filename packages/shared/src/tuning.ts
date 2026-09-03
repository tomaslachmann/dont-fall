/**
 * Tuning constants for the DON'T FALL simulation.
 *
 * Every value the game's feel depends on lives here as a named constant — never
 * as a magic number scattered through the sim or the client. M1 fills this in as
 * movement verbs land (see docs/milestones/M1.md).
 */

/** Fixed simulation rate. The sim always steps at this cadence (ADR 0004). */
export const TICK_RATE_HZ = 30;

/** Seconds of simulated time advanced by one {@link TICK_RATE_HZ} tick. */
export const TICK_DT = 1 / TICK_RATE_HZ;

/** Milliseconds of simulated time advanced by one tick. */
export const TICK_MS = TICK_DT * 1000;

/** Convert a duration in milliseconds to whole simulation ticks. */
export const msToTicks = (ms: number): number => Math.round(ms / TICK_MS);

/**
 * Upper bound on how many sim steps a single frame may run before the loop
 * gives up catching up (avoids the "spiral of death" after a long stall).
 */
export const MAX_STEPS_PER_FRAME = 5;

// --- Character ---------------------------------------------------------------

/** Downward acceleration (units/s²). Stronger than real gravity for snappier falls. */
export const GRAVITY_Y = -22;

/** Ground movement speed (units/s) while Controlled. */
export const WALK_SPEED = 6;

/**
 * Small downward speed (units/s) kept while grounded so the character controller
 * always has a non-degenerate vertical to solve — a flat `0` makes Rapier's
 * controller stall when the capsule rests exactly flush after a step-down. The
 * controller's own depenetration keeps the capsule from actually sinking.
 */
export const GROUND_STICK_SPEED = 2;

// --- Jump ------------------------------------------------------------------

/** Upward speed (units/s) applied at the moment of a jump. */
export const JUMP_VELOCITY = 10;

/** How long holding jump keeps the ascent boosted after take-off (ms). */
export const JUMP_HOLD_MAX_MS = 260;

/** Gravity multiplier while jump is held and the Character is still rising (<1 = floatier). */
export const JUMP_HOLD_GRAVITY_SCALE = 0.5;

/** Grace period after walking off an edge during which a jump still works (ms). */
export const COYOTE_MS = 100;

/** {@link JUMP_HOLD_MAX_MS} in whole ticks. */
export const JUMP_HOLD_MAX_TICKS = msToTicks(JUMP_HOLD_MAX_MS);

/** {@link COYOTE_MS} in whole ticks. */
export const COYOTE_TICKS = msToTicks(COYOTE_MS);

// --- Dash ------------------------------------------------------------------

/** Peak horizontal speed (units/s) reached at the end of a dash's build-up. */
export const DASH_SPEED = 15;

/** How long the dash burst lasts (ms). */
export const DASH_DURATION_MS = 1000;

/**
 * How long the dash takes to release back to 0 at the very end (ms) — a
 * "nitro" build, not a ramp-in: speed builds continuously toward
 * {@link DASH_SPEED} across the whole burst (see `dashEnvelope`), then only
 * this final window eases it back down instead of cutting dead at full speed.
 */
export const DASH_RELEASE_MS = 90;

/**
 * Minimum time between dashes (ms), measured from the *start* of the previous
 * one — must stay comfortably above {@link DASH_DURATION_MS} or there is no
 * real rest after the burst ends (DashController's cooldown and duration
 * timers start together and count down in lockstep).
 */
export const DASH_COOLDOWN_MS = 1500;

/** {@link DASH_DURATION_MS} in whole ticks. */
export const DASH_DURATION_TICKS = msToTicks(DASH_DURATION_MS);

/** {@link DASH_RELEASE_MS} in whole ticks. */
export const DASH_RELEASE_TICKS = msToTicks(DASH_RELEASE_MS);

/** {@link DASH_COOLDOWN_MS} in whole ticks. */
export const DASH_COOLDOWN_TICKS = msToTicks(DASH_COOLDOWN_MS);

/** Capsule radius (units). */
export const CAPSULE_RADIUS = 0.35;

/** Half-height of the capsule's cylindrical part, excluding the hemispherical caps (units). */
export const CAPSULE_HALF_HEIGHT = 0.5;

/** Distance from the capsule centre to its lowest point. */
export const CAPSULE_BOTTOM_OFFSET = CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS;

// --- Kinematic character controller -----------------------------------------

/** Skin width kept between the capsule and surfaces (units). */
export const CHARACTER_CONTROLLER_OFFSET = 0.01;

// --- Impact & ragdoll state machine (ADR 0006) ------------------------------

/** Impulse magnitude below which an Impact is ignored entirely. */
export const IMPACT_STAGGER_MIN = 4;

/** Impulse magnitude at or above which an Impact knocks the Character to Ragdoll. */
export const IMPACT_RAGDOLL_MIN = 9;

/** How long a Stagger lasts before recovering to Controlled (ms). */
export const STAGGER_MS = 350;

/** Movement input multiplier while Staggered. */
export const STAGGER_INPUT_SCALE = 0.35;

/** Minimum time spent in Ragdoll before it can begin getting up (ms). */
export const RAGDOLL_MIN_MS = 500;

/** Hard cap on Ragdoll time — get up even if the body has not settled (ms). */
export const RAGDOLL_MAX_MS = 4000;

/** Max speed (units/s) of any ragdoll bone for the body to count as settled. */
export const RAGDOLL_SETTLE_SPEED = 1.2;

/** How long the GettingUp blend from ragdoll pose back to standing takes (ms). */
export const GETUP_MS = 450;

/** Where the capsule centre is placed above the settled pelvis when GettingUp begins (units). */
export const GETUP_CAPSULE_LIFT = 0.7;

/** Angular / linear damping on ragdoll bones — higher settles the flop faster. */
export const RAGDOLL_ANGULAR_DAMPING = 3;
export const RAGDOLL_LINEAR_DAMPING = 0.12;

/**
 * Extra constraint-solver iterations on each ragdoll bone body (M2 ticket 08).
 * The joint solver's documented worst case is a jointed body "pushed with a
 * large force" against another body — exactly a dash-crash into a Prop, now
 * that ragdoll bones collide with Props. Extra iterations keep the skeleton
 * from tearing apart on the hit (research §3.2).
 */
export const RAGDOLL_SOLVER_ITERATIONS = 6;

/**
 * Contact skin (units) on ragdoll bone colliders — a small margin that keeps
 * bones from deep-penetrating a Prop on a fast hit, which Rapier's own docs
 * note "can increase performance, and in some cases, stability".
 */
export const RAGDOLL_CONTACT_SKIN = 0.01;

/** Friction on ragdoll bone colliders (they should slide a little, not stick). */
export const RAGDOLL_FRICTION = 0.9;

/** Peak magnitude of the gentle, varied flop impulse applied on a post-Fall Respawn. */
export const RESPAWN_FLOP_IMPULSE = 1.5;

/**
 * Fraction of its pre-hit velocity a Character's ragdoll keeps when the
 * knockdown was a *crash* — a dash into a wall/Prop, a Bump, a Spinner (M2
 * ticket 08). The collision absorbs most of the forward momentum, so the
 * ragdoll tumbles rather than keeping full dash speed and rocketing through
 * whatever it hit. A Fall keeps its momentum (no impact impulse ⇒ this doesn't
 * apply).
 */
export const RAGDOLL_IMPACT_VELOCITY_SCALE = 0.2;

/** {@link STAGGER_MS} in whole ticks. */
export const STAGGER_TICKS = msToTicks(STAGGER_MS);

/** {@link RAGDOLL_MIN_MS} in whole ticks. */
export const RAGDOLL_MIN_TICKS = msToTicks(RAGDOLL_MIN_MS);

/** {@link RAGDOLL_MAX_MS} in whole ticks. */
export const RAGDOLL_MAX_TICKS = msToTicks(RAGDOLL_MAX_MS);

/** {@link GETUP_MS} in whole ticks. */
export const GETUP_TICKS = msToTicks(GETUP_MS);

// --- Fall & respawn ---------------------------------------------------------

/** Default height below which a Character has Fallen out of the playground (units). */
export const DEFAULT_KILL_PLANE_Y = -8;

// --- Dash into a wall (ticket 06) --------------------------------------------

/**
 * Impulse magnitude of the Knockback applied when a Dash burst is blocked by a
 * near-vertical surface. Always at or above {@link IMPACT_RAGDOLL_MIN} — dashing
 * into a wall always knocks the Character down, never just Staggers it.
 */
export const DASH_WALL_IMPACT_MAGNITUDE = 14;

/**
 * A collision normal counts as a "wall" (not a floor or ceiling) when the
 * absolute value of its Y component is below this. Above it, the surface is
 * treated as roughly horizontal and ignored for the dash-into-wall check.
 */
export const WALL_NORMAL_MAX_Y = 0.5;

/**
 * A collision normal counts as "ground" for Surface lookup (ticket 01, ADR
 * 0036) when its Y component is above this — deliberately a *separate*
 * constant from {@link WALL_NORMAL_MAX_Y} even though it starts at the same
 * value: that one is tuned for "is this steep enough to dash-crash into,"
 * this one for "is this floor-like enough to trust for a Surface lookup."
 * Sharing one knob between the two would mean a future dash-feel tuning pass
 * silently retunes which collisions report a Surface too (code review,
 * ticket 01).
 */
export const SURFACE_GROUND_NORMAL_MIN_Y = 0.5;

/** Upward bias mixed into the wall-bounce direction, before normalising, for a visible pop. */
export const DASH_WALL_LIFT_RATIO = 0.3;

/**
 * Minimum current Dash speed, as a fraction of {@link DASH_SPEED}, for hitting
 * a wall to force Ragdoll. Below this — early in the build-up or late in the
 * release (`dashEnvelope`) — a wall hit is just an ordinary blocked walk, not
 * a knockdown; only a hit near the top of the build counts as a real crash.
 */
export const DASH_WALL_MIN_SPEED_RATIO = 0.6;

// --- Spinner Obstacle (ticket 06) --------------------------------------------

/** Knockback imparted per unit of tangential speed (units/s) at the point hit. */
export const SPINNER_KNOCKBACK_SCALE = 0.6;

/** Extra upward Knockback (units/s) added to every Spinner hit, for a visible pop. */
export const SPINNER_KNOCKBACK_LIFT = 2;

// --- Dynamic props (M1 ticket 06 / M2 ticket 06) ---------------------------

/** Push impulse applied to a Prop per unit of the Character's horizontal speed. */
export const PROP_PUSH_SCALE = 0.5;

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

// --- Character-to-Character Bump (M2 ticket 04) -----------------------------

/**
 * Impact magnitude delivered to a Bumped Character per unit of *closing speed*
 * (units/s) — how fast the mover is approaching along the contact normal,
 * relative to the target's own motion. Tuned against the shared
 * {@link IMPACT_STAGGER_MIN} / {@link IMPACT_RAGDOLL_MIN} thresholds: a plain
 * walk into a standing player (closing ≈ {@link WALK_SPEED}) lands ~3.6, under
 * Stagger — a physical shove, no state change; a dash near full speed (closing
 * ≳ 15) clears {@link IMPACT_RAGDOLL_MIN} and knocks them down.
 */
export const BUMP_IMPULSE_SCALE = 0.6;

/**
 * Upward bias mixed into the Bump knockback direction before normalising, for
 * a visible pop off the ground — same idea as {@link DASH_WALL_LIFT_RATIO}.
 */
export const BUMP_LIFT_RATIO = 0.3;

// --- Client reconciliation (M2 ticket 05, ADR 0013) ------------------------

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

// --- track-service fetch (ADR 0028; ticket 12) ------------------------------

/**
 * Total bounded time the Match server keeps retrying its startup Track fetch
 * before giving up loudly (ticket 12) — covers track-service still coming up
 * (e.g. Docker container start order isn't instant), not track-service being
 * genuinely gone.
 */
export const TRACK_FETCH_MAX_WAIT_MS = 30_000;

/** Delay between retry attempts while the startup Track fetch keeps failing. */
export const TRACK_FETCH_RETRY_DELAY_MS = 1_000;

/**
 * Per-attempt timeout on the startup Track fetch itself — bounds a single
 * request that hangs (track-service accepts the connection but never
 * responds) so it can't silently eat the whole {@link TRACK_FETCH_MAX_WAIT_MS}
 * budget on one stuck attempt instead of retrying.
 */
export const TRACK_FETCH_ATTEMPT_TIMEOUT_MS = 5_000;
