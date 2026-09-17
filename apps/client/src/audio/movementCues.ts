import {
  COYOTE_MS,
  DASH_COOLDOWN_MS,
  isDownMotionState,
  TICK_MS,
  type CharacterMotionState,
  type Vec3,
} from "@dont-fall/shared";
import { RELAUNCH_KICK, TAKEOFF_MIN_SPEED } from "../render/jumpSequence.js";
import { Landings, type Landing } from "./landings.js";
import { RiseLatch } from "./riseLatch.js";

/**
 * The soonest a drawn burst may start again after the last one (ms). The
 * simulation's own rule is {@link DASH_COOLDOWN_MS}, counted from a burst's
 * start. The drawn start can land a frame or two off the simulated one, so this
 * keeps some room. A replay that loses and then regains a burst it already
 * started makes `dashing` flicker, and it stays silent.
 */
export const DASH_RESTART_MIN_MS = DASH_COOLDOWN_MS * 0.8;

/**
 * The soonest a Character can fire a Spring again (ms). Going again means
 * leaving the trigger and coming back down into it, which takes far longer.
 * A replay's second rise of `launchPadEpoch` comes within a round trip.
 */
export const SPRING_REFIRE_MIN_MS = 400;

/**
 * The soonest a Character can Respawn again (ms). A Respawn stands it on its
 * Checkpoint and it has to fall all the way to the kill plane again. A
 * replay's second rise of `respawnCount` comes within a round trip.
 */
export const RESPAWN_REFIRE_MIN_MS = 500;

/**
 * How long after a Spring fires its takeoff belongs to the Spring (ms). The
 * launch lands on the tick after the Epoch rises, and interpolation can
 * put a frame between them.
 */
export const LAUNCH_TAKEOFF_WINDOW_MS = 150;

/**
 * How long after leaving the ground a mid-air rise still counts as a jump
 * (ms): the coyote time, and a tick of slack for the drawn frame. Later
 * than this, a rise is a bounce or an updraft, not a push-off.
 */
export const JUMP_COYOTE_GRACE_MS = COYOTE_MS + TICK_MS;

/**
 * How far above the kill plane the fall whistle sounds at the latest
 * (units), for a Track whose lowest piece hangs near or under the kill plane.
 */
export const FALL_WHISTLE_MIN_LEAD = 3;

/**
 * Below this capsule-centre height a falling Character has nothing left to
 * land on, so it whistles. That is under the lowest piece of the Track, and
 * never later than {@link FALL_WHISTLE_MIN_LEAD} above the kill plane. A Track
 * that draws nothing has no lowest piece (`Infinity`): the lead alone decides.
 */
export const fallWhistleY = (lowestTrackY: number, killPlaneY: number): number =>
  Math.max(Number.isFinite(lowestTrackY) ? lowestTrackY : -Infinity, killPlaneY + FALL_WHISTLE_MIN_LEAD);

/** What the detectors read off a drawn Character, once a frame. */
export interface MovementFrame {
  /** Capsule centre. */
  position: Vec3;
  velocity: Vec3;
  grounded: boolean;
  motionState: CharacterMotionState;
  dashing: boolean;
  launchPadEpoch: number;
  respawnCount: number;
  nowMs: number;
}

/** What happened to a Character this frame, as far as its getting around is heard. */
export interface MovementCue {
  /** It pushed off. `from` is where it last stood, so the caller can ask what it pushed off from. */
  takeoff: { from: Vec3 } | null;
  /** Its feet came down, under the landing animation's rule (ADR 0071). */
  landing: Landing | null;
  /** A Dash burst started. */
  dashStarted: boolean;
  /** It fired a Spring. */
  launched: boolean;
  /** It was put back on its Checkpoint. */
  respawned: boolean;
  /** It dropped below the Track on its way to the kill plane. Once per fall. */
  falling: boolean;
}

const QUIET: MovementCue = Object.freeze({
  takeoff: null,
  landing: null,
  dashStarted: false,
  launched: false,
  respawned: false,
  falling: false,
});

interface Seen {
  grounded: boolean;
  verticalVelocity: number;
  dashing: boolean;
  /** Where it last stood. */
  groundedAt: Vec3 | null;
  leftGroundAtMs: number;
  dashStartedAtMs: number;
  launchedAtMs: number;
  /** The fall whistle is ready: it has stood, or Respawned, since it last whistled. */
  whistleArmed: boolean;
}

/**
 * The edges a Character's getting-around sounds come from, per Character id
 * (M14 ticket 05, ADR 0087). Local and remote Characters go through the same
 * rules. Each is fed its drawn state once a frame, never the ticks a
 * reconciliation replays.
 *
 * - **Takeoff:** the first airborne frame after standing, rising at least
 *   {@link TAKEOFF_MIN_SPEED}, the same push-off that starts the jump
 *   animation from its crouch. A coyote jump rises mid-air, shortly after
 *   leaving a ledge. Walking off a ledge is no takeoff, and neither is the
 *   launch of a Spring.
 * - **Landing:** {@link Landings}, the rule that plays the landing animation.
 * - **Dash:** `dashing` turning on, no sooner than {@link DASH_RESTART_MIN_MS}
 *   after the last burst.
 * - **Spring and Respawn:** `launchPadEpoch` and `respawnCount` rising, each a
 *   {@link RiseLatch}.
 * - **Fall:** below `fallY` and falling, once until it stands or Respawns.
 *
 * A knocked-down Character neither takes off, lands nor dashes: the knockdown
 * owns the body. It can still fire a Spring, Respawn and fall.
 */
export class MovementCues {
  private readonly seen = new Map<string, Seen>();
  private readonly landings = new Landings();
  private readonly springs = new RiseLatch(SPRING_REFIRE_MIN_MS);
  private readonly respawns = new RiseLatch(RESPAWN_REFIRE_MIN_MS);

  constructor(private readonly fallY: number) {}

  update(id: string, frame: MovementFrame): MovementCue {
    const { position, velocity, grounded, nowMs } = frame;
    const launched = this.springs.rose(id, frame.launchPadEpoch, nowMs);
    const respawned = this.respawns.rose(id, frame.respawnCount, nowMs);
    const previous = this.seen.get(id);
    const down = isDownMotionState(frame.motionState);

    const seen: Seen = previous ?? {
      grounded,
      verticalVelocity: velocity.y,
      dashing: frame.dashing,
      groundedAt: null,
      leftGroundAtMs: -Infinity,
      dashStartedAtMs: -Infinity,
      launchedAtMs: -Infinity,
      whistleArmed: true,
    };
    this.seen.set(id, seen);
    if (launched) seen.launchedAtMs = nowMs;

    let takeoff: MovementCue["takeoff"] = null;
    let landing: Landing | null = null;
    let dashStarted = false;
    // A Respawn is no landing: the air time it would end began over the Track.
    if (down || respawned) this.landings.forget(id);
    if (!down) {
      landing = this.landings.update(id, grounded, velocity.y, nowMs);
      if (previous && !grounded) {
        if (previous.grounded) seen.leftGroundAtMs = nowMs;
        const pushedOff =
          velocity.y >= TAKEOFF_MIN_SPEED &&
          (previous.grounded ||
            (velocity.y - previous.verticalVelocity >= RELAUNCH_KICK && nowMs - seen.leftGroundAtMs <= JUMP_COYOTE_GRACE_MS));
        const sprung = nowMs - seen.launchedAtMs <= LAUNCH_TAKEOFF_WINDOW_MS;
        if (pushedOff && !sprung && seen.groundedAt) takeoff = { from: seen.groundedAt };
      }
      if (previous && frame.dashing && !previous.dashing && nowMs - seen.dashStartedAtMs >= DASH_RESTART_MIN_MS) {
        dashStarted = true;
        seen.dashStartedAtMs = nowMs;
      }
    }

    if (grounded) seen.groundedAt = { ...position };
    if (grounded || respawned) seen.whistleArmed = true;
    const falling = seen.whistleArmed && !grounded && velocity.y < 0 && position.y < this.fallY;
    if (falling) seen.whistleArmed = false;

    seen.grounded = grounded;
    seen.verticalVelocity = velocity.y;
    seen.dashing = frame.dashing;
    return takeoff || landing || dashStarted || launched || respawned || falling
      ? { takeoff, landing, dashStarted, launched, respawned, falling }
      : QUIET;
  }

  /** Drops everything known about `id`: it left, or was eliminated. Seen again, it starts as history. */
  forget(id: string): void {
    this.seen.delete(id);
    this.landings.forget(id);
    this.springs.forget(id);
    this.respawns.forget(id);
  }
}
