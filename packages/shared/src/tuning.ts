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

/**
 * Ground movement **target** (units/s) while Controlled (ticket 05, M3.6,
 * ADR 0035) — not, since this ticket, an instantaneous value assigned
 * straight into velocity every tick. It is what `beginCapsuleTick`'s
 * accelerate → drag → cap pipeline (`movementVerbs.ts`'s `accelerateVelocity`)
 * chases; at today's (full-grip) `MOVE_ACCEL_FACTOR`/`MOVE_FRICTION_FACTOR`
 * it still reaches this target within a single tick, so the change is
 * structural, not felt — a Surface with its own, slower factors (ticket 06,
 * ice/mud) is what turns "target reached over time" into something a player
 * can actually feel.
 */
export const WALK_SPEED = 6;

/**
 * Small downward speed (units/s) kept while grounded so the character controller
 * always has a non-degenerate vertical to solve — a flat `0` makes Rapier's
 * controller stall when the capsule rests exactly flush after a step-down. The
 * controller's own depenetration keeps the capsule from actually sinking.
 *
 * This is *not* what keeps the Character glued to a downhill slope (ticket 02,
 * M3.6) — that was the actual unit bug: a fixed velocity produces a per-tick
 * probe distance that shrinks relative to the ground the faster you're moving
 * or the steeper the slope, capping clean descent at `atan(2/WALK_SPEED) ≈
 * 18°` (about 5° mid-Dash). That job now belongs to Rapier's own
 * `enableSnapToGround` (a real distance, not a speed) — see
 * `GROUND_SNAP_DISTANCE`. This constant's remaining job is narrower: give the
 * controller a small, constant, non-zero downward velocity to solve each
 * grounded tick, so a Character walking off a ledge starts falling from a
 * small speed rather than whatever happened to accumulate while grounded.
 */
export const GROUND_STICK_SPEED = 2;

/**
 * How far below the capsule's feet Rapier's own snap-to-ground (ticket 02,
 * M3.6/ADR 0037) will look for ground to pull the Character down onto — the
 * actual fix for the ground-stick unit bug documented on
 * {@link GROUND_STICK_SPEED}. Settled by a spike: enabling it on the
 * installed `@dimforge/rapier3d-compat@0.20.0` was measured against the
 * M1-era edge-stalling/Dash-hitching symptoms it was originally disabled
 * for, and reproduced neither (see ticket 02's own notes for the numbers).
 * `0.5` comfortably covers the worst case this project cares about — a
 * ~40° slope at full Dash speed — while staying far short of any
 * intentional gap/Fall in the current Track (the M1 seed's smallest
 * kill-plane drop is 7.5 units).
 */
export const GROUND_SNAP_DISTANCE = 0.5;

// --- Movement model: accelerate -> drag -> cap (ticket 05, M3.6, ADR 0035) --
//
// `movementVerbs.ts`'s `accelerateVelocity` replaces the old direct
// `velocity.xz = wish` assignment with Source's own `Friction()`/
// `Accelerate()` shape (the reference implementation ADR 0035 names
// alongside Quake 3's `PM_Friction`/`PM_Accelerate`) — chosen deliberately
// over a naive "step by a flat units/s² amount every tick" design: a flat
// step's magnitude doesn't scale with anything, so a drag step and an
// accelerate step of comparable size can fully cancel each other at low
// speed, permanently stalling far short of the real target — verified
// during this ticket's own development, not a hypothetical. Source's shapes
// avoid this because `Accelerate()`'s magnitude scales with the *target*
// speed (`wishSpeed`, a roughly-constant, comparatively large quantity) while
// `Friction()`'s scales with the *current* speed (small until real motion
// has built up) — different quantities, not the same one racing itself.

/**
 * Defensive backstop on the Character's own horizontal move velocity — the
 * final "cap" stage of the pipeline. Comfortably above any speed the walk
 * model can currently produce (`WALK_SPEED` × the highest Surface/slope
 * multiplier, plus `DASH_SPEED`, ≈ 22.5 units/s), so it never actually fires
 * today — it exists so a future stacked combination of Surface/slope/Dash
 * effects fails safe instead of accumulating without bound.
 */
export const MOVE_VELOCITY_CAP = 30;

/**
 * Source's `sv_accelerate` — a dimensionless multiplier on `wishSpeed` (not
 * an absolute units/s² rate): `accelerateVelocity`'s Accelerate() stage adds
 * `min(MOVE_ACCEL_FACTOR * wishSpeed * TICK_DT, addSpeed)` toward the wish
 * velocity every tick. `* TICK_DT >= 1` (true here, with generous margin —
 * the exact threshold is `TICK_RATE_HZ`) guarantees the addable amount
 * always reaches (never merely approaches) `wishSpeed`, saturating every
 * tick — deliberate, not an oversight: this ticket's whole job is
 * introducing the accelerate → drag → cap *shape*, numerically **identical**
 * today to the direct assignment it replaces. A separately-tuned, genuinely
 * gradual value only appears once a Surface (ticket 06, ice/mud) supplies
 * its own, per the "one scalar per Surface multiplies both" rule (ADR 0035)
 * — that scalar multiplies this constant (and `MOVE_FRICTION_FACTOR` below)
 * directly, exactly like Source's own `surfaceFriction`.
 */
export const MOVE_ACCEL_FACTOR = 1000;

/**
 * Source's `sv_friction` — the Friction() stage's own dimensionless rate,
 * kept as an independent constant from {@link MOVE_ACCEL_FACTOR} (Source's
 * own reference values, 10 and 4, aren't equal either) even though both
 * happen to need the same "saturates every tick" property today. Drop this
 * tick is `max(speed, MOVE_STOP_SPEED) * MOVE_FRICTION_FACTOR * TICK_DT`;
 * saturating (same `* TICK_DT >= 1` reasoning as above) fully zeroes any
 * residual velocity every tick, matching the old model's implicit "no input
 * held, no memory of the last direction" behaviour exactly.
 */
export const MOVE_FRICTION_FACTOR = 1000;

/**
 * Source's `sv_stopspeed` — a floor under Friction()'s `control` term, so a
 * small residual speed gets a real, fast stop instead of an exponential tail
 * that never quite reaches zero. Inert today: at {@link MOVE_FRICTION_FACTOR}'s
 * current saturating value, drop already exceeds any realistic speed on its
 * own, so this floor is never what decides the outcome. It starts mattering
 * only once a Surface (ticket 06) supplies a much smaller friction scalar.
 */
export const MOVE_STOP_SPEED = 1;

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

// --- Speed pads (M3.7 ticket 01, ADR 0035) ----------------------------------

/**
 * How long a speed/slow pad's raised (or lowered) speed cap holds at full
 * magnitude after the one-shot trigger, before {@link SPEED_PAD_FADE_MS}
 * starts fading it back to 1 — SuperTuxKart's zipper model (`max-speed-
 * increase` held for `duration`, then a linear fade over `fade-out-time`;
 * `docs/research/surface-and-volume-mechanics.md` §1.2). A pure continuous
 * multiplier (no hold, no one-shot write) was rejected: on a short pad the
 * very next tick's cap would clip it right back down, doing almost nothing.
 * Provisional, like every other Surface/pad number in this project so far —
 * a measurement against a real pad, not a decision, once one exists.
 */
export const SPEED_PAD_HOLD_MS = 3000;

/** How long the cap takes to linearly fade from its peak back to 1 (ms), once {@link SPEED_PAD_HOLD_MS} elapses. */
export const SPEED_PAD_FADE_MS = 1000;

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

/**
 * Movement input multiplier while Sliding (ticket 03, M3.6, ADR 0037) — some
 * steering authority remains (unlike Ragdoll/GettingUp's 0), but reduced
 * (unlike Controlled's 1), matching CONTEXT.md's "keeps reduced movement
 * input while gravity carries it down the slope." A placeholder value —
 * this milestone's numbers are deliberately provisional, tuned later against
 * a real ramp, not decided here.
 */
export const SLIDE_INPUT_SCALE = 0.3;

/**
 * How far the horizontal velocity blends toward the (already-reduced)
 * steering target each tick while Sliding (ticket 03, M3.6, ADR 0037) — 0
 * would mean no steering at all, 1 would mean instant full authority every
 * tick. Bounded blending, not integration (code review): steering is a
 * *velocity* target, and integrating it as if it were an acceleration grows
 * without bound the longer a direction is held. A placeholder value, like
 * every other number this milestone defers to real-ramp tuning.
 */
export const SLIDE_STEER_BLEND = 0.15;

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

// --- Wall Impact (ticket 06, M1; re-expressed as a speed threshold, M3.7 ticket 03, ADR 0037) --

/**
 * A collision normal counts as a "wall" (not a floor or ceiling) when the
 * absolute value of its Y component is below this. Above it, the surface is
 * treated as roughly horizontal and ignored for the wall-Impact check.
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

// --- Slopes: walkable / Sliding / wall (ticket 03, M3.6, ADR 0037) ----------

/**
 * Steeper than this (radians, from horizontal) and a grounded Character
 * slides instead of walking with full control — the walkable/Sliding
 * boundary. Deliberately independent of {@link WALL_NORMAL_MAX_Y} (the
 * Sliding/wall boundary): a single threshold would make a steep ramp either
 * "walk up it" or "unclimbable wall," with no band to slide down in between
 * — the entire point of tilted geometry (ADR 0037). Replaces Rapier's own
 * coincident `maxSlopeClimbAngle`/`minSlopeSlideAngle` defaults (both 45°,
 * verified against the installed 0.20.0) — see `CharacterController`'s
 * constructor, which sets both of Rapier's own knobs to the *wall* angle
 * instead (derived from `WALL_NORMAL_MAX_Y`) and leaves the walkable/Sliding
 * split entirely to this project's own state machine. A placeholder value,
 * like every other number this milestone defers to real-ramp tuning.
 */
export const WALKABLE_SLOPE_MAX_ANGLE = (35 * Math.PI) / 180;

/**
 * How strongly walking speed scales with the signed slope angle (ticket 04,
 * M3.6) — `slopeSpeedMultiplier` (`movementVerbs.ts`) computes
 * `1 - SLOPE_SPEED_ANGLE_FACTOR * angle`, where `angle` is the slope's tilt
 * toward the direction of travel (positive uphill, negative downhill —
 * Unity's Character Controller package's own documented convention). Bounded
 * automatically by {@link WALKABLE_SLOPE_MAX_ANGLE}: since this multiplier
 * only ever applies while walking (never `Sliding`), the steepest angle it
 * ever sees is that limit, giving roughly 0.76x uphill / 1.24x downhill at
 * the walkable ceiling with this value — a provisional number, like every
 * other one this milestone defers to real-ramp tuning.
 */
export const SLOPE_SPEED_ANGLE_FACTOR = 0.4;

/**
 * Defensive floor on {@link import("../simulation/movementVerbs.js").slopeSpeedMultiplier}'s
 * output — never lets an (unexpectedly, given the bound above) steep uphill
 * angle multiply speed down to zero or negative.
 */
export const SLOPE_SPEED_MULTIPLIER_MIN = 0.1;

/** Upward bias mixed into the wall-Impact knockback direction, before normalising, for a visible pop. */
export const WALL_IMPACT_LIFT_RATIO = 0.3;

/**
 * Minimum closing speed (units/s) — how fast the Character is moving *into*
 * the wall along its own normal, not just "how fast is this Character" in
 * general — for hitting a near-vertical surface to force Ragdoll (M3.7
 * ticket 03, ADR 0037). Re-expressed from the old Dash-specific
 * `DASH_WALL_MIN_SPEED_RATIO * DASH_SPEED` ratio to this same numeric value
 * (`DASH_SPEED * 0.6 = 9`) as a standalone absolute speed: the rule cares
 * *how fast*, never *why* — a bounce, a launch pad or an updraft crossing
 * this same threshold qualifies exactly like a full-strength Dash always
 * did, with no second, parallel rule for "launched" states (two rules for
 * one event drift apart under tuning, and then neither can be blamed).
 * Below this — early in a Dash's build-up or late in its release
 * (`dashEnvelope`), or simply walking fast on a downhill Surface — a wall
 * hit is just an ordinary blocked walk, not a knockdown; only real speed
 * counts as a real crash.
 */
export const WALL_IMPACT_MIN_SPEED = DASH_SPEED * 0.6;

/**
 * Impact magnitude per unit of closing speed (M3.7 ticket 03) — replaces the
 * old flat `DASH_WALL_IMPACT_MAGNITUDE` (always 14, however fast the Dash
 * actually was) with a magnitude that genuinely scales, so a glancing,
 * barely-qualifying hit lands softer than someone launched into the same
 * wall at twice the speed. Derived from the two previous, separately-tuned
 * constants (`14 / DASH_SPEED`) so a full-strength Dash into a wall reaches
 * *exactly* the same magnitude it always did — "Dashing into a wall feels
 * as it did" is the ticket's own explicit requirement, not a coincidence.
 */
export const WALL_IMPACT_SCALE = 14 / DASH_SPEED;

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
 * a visible pop off the ground — same idea as {@link WALL_IMPACT_LIFT_RATIO}.
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
 * from producing a Round nobody can wait out. Enforced by track-service on
 * publish, so a Revision can never carry a nonsense clock.
 */
export const MIN_TIME_LIMIT_MS = 10_000;
export const MAX_TIME_LIMIT_MS = 30 * 60_000;

// --- Survival (M5 ticket 05, ADR 0041/0042) ---------------------------------

/**
 * The Survivor Target (CONTEXT.md) a Track backfills to when it carries no
 * default of its own, and what the Track builder offers for a new one
 * (ticket 07) — the same "backfill, never leave a value that means nothing"
 * discipline `DEFAULT_TIME_LIMIT_MS` follows. 1: winner-takes-all, last one
 * standing — the Final Race form's own target (CONTEXT.md), and the
 * smallest number that still means something (0 would end every Survival
 * Round before it could start). A Race never reads this field at all.
 */
export const DEFAULT_SURVIVOR_TARGET = 1;

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
 * How long ROUND_END holds before the Results (M4 ticket 05). A beat, not a
 * screen: long enough to see that the Round is over where you are standing,
 * before the view changes.
 */
export const ROUND_END_MS = 2_500;

/** {@link ROUND_END_MS} in Ticks — every Match duration is measured in Ticks (ADR 0004). */
export const ROUND_END_TICKS = msToTicks(ROUND_END_MS);
