import { FACING_TURN_SPEED_MAX, REMOTE_YAW_SMOOTH_MS, wrapAngle } from "@dont-fall/shared";
import { measuredYawRate } from "./modelFacing.js";

/**
 * A drawn yaw and how fast it is turning, in `facing`'s convention (ADR
 * 0045) — what a remote rig is turned to, never read by the sim.
 */
export interface YawFollow {
  /** The drawn facing (radians). */
  yaw: number;
  /** How fast it turns (rad/s). */
  rate: number;
}

/**
 * One frame of a critically damped spring pulling `state.yaw` onto `target`
 * the short way round (ADR 0109) — Unity's `SmoothDamp`, but solved exactly
 * for a target held across the frame rather than stepped, so a swing lands
 * in the same place whatever the frame rate. Through a steady turn it trails the
 * target by `smoothSeconds` (less half a frame: each frame's target is held
 * across it); a turn that stops is never overshot, and one that stalls for a
 * Tick is carried through it on the rate it had.
 */
export const followYaw = (
  state: YawFollow,
  target: number,
  deltaSeconds: number,
  smoothSeconds = REMOTE_YAW_SMOOTH_MS / 1000,
): YawFollow => {
  const omega = 2 / smoothSeconds;
  const error = -wrapAngle(target - state.yaw);
  const pull = state.rate + omega * error;
  const decay = Math.exp(-omega * deltaSeconds);
  return {
    yaw: wrapAngle(target + (error + pull * deltaSeconds) * decay),
    rate: (state.rate - omega * pull * deltaSeconds) * decay,
  };
};

/** What {@link RemoteYaws.draw} needs about a remote Character this frame — all replicated. */
export interface YawFrame {
  /** Its interpolated `facing`. */
  facing: number;
  /** Its Respawn Epoch: a Respawn is a teleport, not a turn, so a new one snaps. */
  respawnCount: number;
  /** Whether it is in a hold, either role — which covers every Spin (ADR 0104). */
  pinned: boolean;
  deltaSeconds: number;
}

interface Entry extends YawFollow {
  respawnCount: number;
  /**
   * Whether the last frame drew it pinned, at its facing exactly — only then
   * is a pinned frame's step from `yaw` a turn rather than the follow's lag.
   */
  pinned: boolean;
}

/**
 * The drawn yaw of every remote rig (ADR 0109), keyed by id like the
 * renderer's other per-Character bookkeeping (`Knockdowns`, `JumpSequences`).
 *
 * Nothing snaps but a first sight, a Respawn and the start of a hold (see
 * {@link RemoteYaws.draw}) — no gap is too wide to swing: a long stall or a
 * get-up turns through {@link followYaw} in about four smoothing times, where
 * a pop would read as the very jerk this exists to remove.
 */
export class RemoteYaws {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly smoothSeconds = REMOTE_YAW_SMOOTH_MS / 1000) {}

  /**
   * The facing to draw `id` at this frame.
   *
   * Pinned, it is the facing exactly: a Held body is placed at its grabber's
   * carry point from the server's facing, so a grabber drawn behind it would
   * turn away from its own hands. The follow only keeps pace meanwhile — the
   * yaw, and the rate it was seen turning at — so a hold that ends mid-Spin
   * carries on turning instead of starting from rest.
   *
   * The frame a hold starts closes the follow's lag in one step: a pop of at
   * most the turn rate × ({@link REMOTE_YAW_SMOOTH_MS} less half a frame),
   * about 11.5° at {@link FACING_TURN_SPEED_MAX} on a 60 Hz screen and 15°
   * on a 144 Hz one. Accepted as the price of drawing both ends of a hold
   * exactly, and drawn on the frame the catch itself snaps the Held body into
   * the carry, which hides it. That step is the lag, not a turn, so the rate
   * is measured only between two pinned frames; on the first, the follow's
   * own rate already is the turn's, and stands — so a pin one frame long
   * hands back the turn it found instead of a made-up one. A measured rate is
   * still clamped to {@link FACING_TURN_SPEED_MAX}, which nothing an owner
   * sends and no Spin exceeds: the Held body's own facing flips half a turn
   * across one Tick as it is caught, and that is no turn to carry on with.
   */
  draw(id: string, { facing, respawnCount, pinned, deltaSeconds }: YawFrame): number {
    const entry = this.entries.get(id);
    if (!entry || entry.respawnCount !== respawnCount) {
      this.entries.set(id, { yaw: facing, rate: 0, respawnCount, pinned: false });
      return facing;
    }
    if (pinned) {
      // A frame that took no time measured nothing, nor did the frame a hold
      // started: the rate it had stands.
      if (entry.pinned && deltaSeconds > 0) {
        const rate = measuredYawRate(facing, entry.yaw, deltaSeconds);
        entry.rate = Math.max(-FACING_TURN_SPEED_MAX, Math.min(FACING_TURN_SPEED_MAX, rate));
      }
      entry.yaw = facing;
      entry.pinned = true;
      return facing;
    }
    const next = followYaw(entry, facing, deltaSeconds, this.smoothSeconds);
    entry.yaw = next.yaw;
    entry.rate = next.rate;
    entry.pinned = false;
    return next.yaw;
  }

  /**
   * The facing to draw `id` at while it is down: the one it went down with,
   * held still (ADR 0076), so its get-up turns it to the live facing through
   * the follow instead of snapping there on the first frame back. One first
   * seen down has none yet, and takes the facing it is shown with.
   */
  rest(id: string, { facing, respawnCount }: Pick<YawFrame, "facing" | "respawnCount">): number {
    const entry = this.entries.get(id);
    if (!entry) {
      this.entries.set(id, { yaw: facing, rate: 0, respawnCount, pinned: false });
      return facing;
    }
    entry.rate = 0;
    entry.pinned = false;
    return entry.yaw;
  }

  /** Drops `id`'s drawn yaw — the rig is gone, so one that comes back snaps. */
  forget(id: string): void {
    this.entries.delete(id);
  }

  reset(): void {
    this.entries.clear();
  }
}
