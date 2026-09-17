import {
  GRAB_COOLDOWN_MS,
  HIT_CHARGE_MAX_MS,
  HIT_COOLDOWN_MS,
  hitImpactMagnitude,
  IMPACT_RAGDOLL_MIN,
  isDownMotionState,
  type CharacterMotionState,
  type RagdollCause,
  type Vec3,
} from "@dont-fall/shared";
import { RiseLatch } from "./riseLatch.js";

/**
 * The soonest a drawn swing, or a drawn grab attempt, may fire again (ms): the
 * verb's own cooldown, less some room for the drawn frame. `hitEpoch` and
 * `grabEpoch` are not in `ReconcileBase`, so a replay across the tick that
 * raised them raises them again.
 */
export const SWING_REFIRE_MIN_MS = HIT_COOLDOWN_MS * 0.8;
export const REACH_REFIRE_MIN_MS = GRAB_COOLDOWN_MS * 0.8;

/**
 * The soonest a Character can be heard going down again (ms). A knockdown
 * lies and gets up for well over this. A mispredicted knockdown the server
 * undoes and then confirms after all is one knockdown, not two.
 */
export const KNOCKDOWN_REFIRE_MIN_MS = 500;

/** The same for entering Stagger, whose wobble outlasts it. */
export const BUMP_REFIRE_MIN_MS = 400;

/**
 * How long a landed Hit or a Respawn owns the Stagger or knockdown that
 * follows it (ms). The simulation enters the state a tick after the Epoch or
 * counter rises. A Stagger inside this window is that Hit's or Respawn's, not a
 * Bump.
 */
export const CAUSED_STATE_WINDOW_MS = 300;

/**
 * How far back a landed Hit looks for the swing that threw it (ms), and how far
 * from the one hit that swing may have been (units). Your own swing is
 * predicted, a round trip and the interpolation delay ahead of the
 * reaction it causes on anyone else.
 */
export const HIT_PAIR_WINDOW_MS = 600;
export const HIT_PAIR_REACH = 5;

/** A knockdown's weight by its cause: a machine or a wall hits harder than a Character. */
export const KNOCKDOWN_WEIGHT: Readonly<Record<RagdollCause, "heavy" | "medium">> = {
  WallImpact: "heavy",
  Obstacle: "heavy",
  Spinner: "heavy",
  Bump: "medium",
  Hit: "medium",
  Fall: "medium",
  Disconnect: "medium",
};

/**
 * Whether a swing at `charge` (0..1) lands heavy: hard enough to knock down,
 * by the simulation's own rule (`hitImpactMagnitude` against
 * `IMPACT_RAGDOLL_MIN`).
 */
export const isHeavyHit = (charge: number): boolean => hitImpactMagnitude(charge) >= IMPACT_RAGDOLL_MIN;

/** What the fighting detectors read off a drawn Character, once a frame. */
export interface FightFrame {
  /** Capsule centre. */
  position: Vec3;
  motionState: CharacterMotionState;
  hitEpoch: number;
  hitChargeMs: number;
  hitReactEpoch: number;
  grabEpoch: number;
  grabbingId: string | null;
  ragdollEpoch: number;
  ragdollCause: RagdollCause;
  /** This frame's Respawn, from `MovementCues`. */
  respawned: boolean;
  nowMs: number;
}

/** What happened to a Character this frame, as far as fighting is heard. */
export interface FightCue {
  /** It swung, at this charge (0..1). */
  swing: { charge: number } | null;
  /** A Hit landed on it. How hard is {@link FightCues.chargeOfHitOn}'s answer. */
  struck: boolean;
  /** It reached out to grab. */
  reached: boolean;
  /** Its reach caught someone: a hold started. */
  gripped: boolean;
  /** It went down, heavy or medium. */
  knockdown: { weight: "heavy" | "medium" } | null;
  /** It started getting up. */
  gettingUp: boolean;
  /** It was knocked off balance by something other than a Hit or a Respawn: a Bump, a machine. */
  bumped: boolean;
}

const QUIET: FightCue = Object.freeze({
  swing: null,
  struck: false,
  reached: false,
  gripped: false,
  knockdown: null,
  gettingUp: false,
  bumped: false,
});

interface Seen {
  motionState: CharacterMotionState;
  grabbing: boolean;
  /** The last charge seen while a Hit was held: what the next swing fires at. */
  chargeMs: number;
  struckAtMs: number;
  respawnedAtMs: number;
  downAtMs: number;
  staggeredAtMs: number;
}

interface Swing {
  strikerId: string;
  position: Vec3;
  charge: number;
  atMs: number;
}

const distance = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/**
 * The edges fighting is heard from, per Character id (M14 ticket 06, ADR
 * 0087), next to 05's `MovementCues` and under the same rules: the drawn
 * Character once a frame, the first sight of an id is history, and a
 * replay's second rise is silent.
 *
 * - **Swing:** `hitEpoch` rising, at the last charge seen while held.
 * - **Struck:** `hitReactEpoch` rising. Every swing is remembered for a
 *   moment, and a landed Hit takes the charge of the latest swing near it
 *   ({@link chargeOfHitOn}).
 * - **Reach and grip:** `grabEpoch` rising, and `grabbingId` becoming set.
 * - **Knockdown:** entering `Ragdoll`. Its weight is `ragdollCause`'s when
 *   `ragdollEpoch` rose with it. A knockdown the server forced on a
 *   predicting client (a reconciliation snaps into `Ragdoll` without raising
 *   the Epoch) is a Hit or a Bump, which is medium.
 * - **Getting up:** entering `GettingUp`.
 * - **Bump:** entering `Stagger`, or a medium knockdown, unless a Hit or a
 *   Respawn just caused it.
 */
export class FightCues {
  private readonly seen = new Map<string, Seen>();
  private readonly swings = new RiseLatch(SWING_REFIRE_MIN_MS);
  private readonly reaches = new RiseLatch(REACH_REFIRE_MIN_MS);
  private readonly strikes = new RiseLatch();
  private readonly knockdowns = new RiseLatch();
  private recentSwings: Swing[] = [];

  update(id: string, frame: FightFrame): FightCue {
    const { motionState, nowMs } = frame;
    const swung = this.swings.rose(id, frame.hitEpoch, nowMs);
    const struck = this.strikes.rose(id, frame.hitReactEpoch, nowMs);
    const reached = this.reaches.rose(id, frame.grabEpoch, nowMs);
    const epochRose = this.knockdowns.rose(id, frame.ragdollEpoch, nowMs);
    const previous = this.seen.get(id);
    const seen: Seen = previous ?? {
      motionState,
      grabbing: frame.grabbingId !== null,
      chargeMs: 0,
      struckAtMs: -Infinity,
      respawnedAtMs: -Infinity,
      downAtMs: -Infinity,
      staggeredAtMs: -Infinity,
    };
    this.seen.set(id, seen);
    if (struck) seen.struckAtMs = nowMs;
    if (frame.respawned) seen.respawnedAtMs = nowMs;

    let swing: FightCue["swing"] = null;
    if (swung) {
      const charge = Math.min(1, seen.chargeMs / HIT_CHARGE_MAX_MS);
      swing = { charge };
      this.forgetSwingsBefore(nowMs);
      this.recentSwings.push({ strikerId: id, position: { ...frame.position }, charge, atMs: nowMs });
      seen.chargeMs = 0;
    }
    // A charge is only ever discarded by losing control, which also ends it here.
    if (frame.hitChargeMs > 0) seen.chargeMs = frame.hitChargeMs;
    else if (motionState !== "Controlled" && motionState !== "Sliding") seen.chargeMs = 0;

    const entered = previous !== undefined && motionState !== previous.motionState;
    const caused = nowMs - Math.max(seen.struckAtMs, seen.respawnedAtMs) <= CAUSED_STATE_WINDOW_MS;
    let knockdown: FightCue["knockdown"] = null;
    let bumped = false;
    if (entered && motionState === "Ragdoll" && nowMs - seen.downAtMs >= KNOCKDOWN_REFIRE_MIN_MS) {
      seen.downAtMs = nowMs;
      const weight = epochRose ? KNOCKDOWN_WEIGHT[frame.ragdollCause] : "medium";
      knockdown = { weight };
      bumped = weight === "medium" && !caused && (!epochRose || frame.ragdollCause === "Bump");
    }
    if (entered && motionState === "Stagger" && !isDownMotionState(previous.motionState)) {
      if (!caused && nowMs - seen.staggeredAtMs >= BUMP_REFIRE_MIN_MS) bumped = true;
      seen.staggeredAtMs = nowMs;
    }
    const gettingUp = entered && motionState === "GettingUp";

    const grabbing = frame.grabbingId !== null;
    const gripped = previous !== undefined && grabbing && !previous.grabbing;

    seen.motionState = motionState;
    seen.grabbing = grabbing;
    return swing || struck || reached || gripped || knockdown || gettingUp || bumped
      ? { swing, struck, reached, gripped, knockdown, gettingUp, bumped }
      : QUIET;
  }

  /**
   * The charge (0..1) of the Hit that just landed on `victimId` at `position`:
   * the latest swing by anyone else within {@link HIT_PAIR_REACH} and
   * {@link HIT_PAIR_WINDOW_MS}, which it uses up. `null` when no swing was
   * seen. Ask it after every Character's {@link update} for the frame, since a
   * swing and the Hit it lands arrive on the same snapshot.
   */
  chargeOfHitOn(victimId: string, position: Vec3, nowMs: number): number | null {
    this.forgetSwingsBefore(nowMs);
    let match = -1;
    for (let i = this.recentSwings.length - 1; i >= 0; i -= 1) {
      const swing = this.recentSwings[i]!;
      if (swing.strikerId !== victimId && distance(swing.position, position) <= HIT_PAIR_REACH) {
        match = i;
        break;
      }
    }
    if (match < 0) return null;
    const [swing] = this.recentSwings.splice(match, 1);
    return swing!.charge;
  }

  private forgetSwingsBefore(nowMs: number): void {
    this.recentSwings = this.recentSwings.filter((swing) => nowMs - swing.atMs <= HIT_PAIR_WINDOW_MS);
  }

  forget(id: string): void {
    this.seen.delete(id);
    this.swings.forget(id);
    this.reaches.forget(id);
    this.strikes.forget(id);
    this.knockdowns.forget(id);
    this.recentSwings = this.recentSwings.filter((swing) => swing.strikerId !== id);
  }
}
