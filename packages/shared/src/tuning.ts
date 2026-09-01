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

/**
 * How long (ticks) a Prop stays locally simulated on a client after the local
 * player last touched it (M2 ticket 06). A short grace so a brief loss of
 * contact mid-push doesn't snap the Prop back to the server snapshot and then
 * immediately hand it back; once it lapses, the Prop returns to purely
 * following the authoritative snapshot.
 */
export const PROP_LOCAL_SIM_GRACE_TICKS = 8;

/**
 * Distance (units) a locally-simulated Prop may diverge from the server's
 * snapshot before the client hard-corrects it mid-push (M2 ticket 06) — e.g.
 * another player shoved the same Prop from the other side and the server
 * resolved it somewhere the local prediction didn't.
 */
export const PROP_HARD_CORRECT_DISTANCE = 0.5;

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
 * server's authoritative position before a reconciliation fires — the
 * comparison is same-tick (predicted position at the acknowledged input tick
 * vs the server's report for that tick), so this can be small: it is real
 * misprediction, not the ~speed × RTT latency gap ticket 03 could not tell
 * apart. Below it, the deterministic shared step (ADR 0005) has kept client
 * and server together and no correction is needed.
 */
export const RECONCILE_POSITION_ERROR = 0.2;

/**
 * Cap on how many recent prediction ticks the client keeps buffered inputs /
 * positions for (~4 s at {@link TICK_RATE_HZ}). A reconciliation never needs to
 * reach past roughly one round trip; this only bounds memory if snapshots stop
 * arriving (a stalled or dropped connection).
 */
export const MAX_BUFFERED_INPUT_TICKS = 120;
