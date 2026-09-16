import { GRAVITY_Y, JUMP_VELOCITY } from "@dont-fall/shared";
import { clipPoseInSequence, lastClipPose, type CharacterActions, type ClipPose } from "./characterModel.js";

/**
 * The jump as one sequence (ADR 0071): the rig's five pieces laid end to end
 * on a single timeline — `Jump_Start` → `Jump_Rise` → `Jump_Apex` →
 * `Jump_Fall` → `Jump_Land`. That is exactly what `Jump_Full` is: the pieces
 * are that clip cut at its section boundaries, pose for pose
 * (`modelBones.test.ts` pins it against the file). The pieces are what gets
 * bound, not the full clip, because `Jump_Full` also lifts its own root by
 * 1.2 units — height the simulation already owns.
 *
 * **Every frame of it is shown, on every jump** (bug report 2026-09-16: the
 * jump "can't be seen whole"). The pieces never fit this game's arc at their
 * authored pace. A jump leaves the floor the frame the button goes down, the
 * arc runs ~0.9 s unheld and ~1.13 s held, and a Spring can keep you up for
 * seconds. The previous version picked a piece by vertical speed and let it
 * run at its own pace. That cut the takeoff down to the crouch alone, cut the
 * rise in half, and held the fall on the frames where the legs brace for the
 * floor. Here a playhead walks the timeline and only ever moves forward. It
 * is paced to reach the top of Apex when the Character reaches the top of its
 * arc, and the end of Fall when it gets back down to the floor it left. It can
 * run faster or slower than authored, and it waits on a frame when it is
 * early, but it never skips one.
 *
 * **Floating is the one exception** (ADR 0077). Held up by an updraft, a
 * Character bobs over the column for seconds, and a forward-only playhead
 * would freeze it on one frame. While Floating, the playhead becomes a
 * function of vertical speed, both ways, walking back and forth across
 * `Jump_Rise` → `Jump_Apex` → `Jump_Fall` as the updraft's bob rises and
 * sinks. The user picked this over resting on the apex, from the fan
 * prototype (2026-09-16).
 */
const JUMP_PIECES = ["jumpStart", "jumpRise", "jumpApex", "jumpFall", "jumpLand"] as const;

/**
 * Where the sequence's landmarks sit on its timeline (s), measured from the
 * rig's own piece lengths — BLIP's are 0.367 / 0.733 / 1.033 / 1.1 / 1.6.
 */
export interface JumpTimeline {
  /** `Jump_Start` ends: the push-off is done and the feet are off the floor. */
  liftoff: number;
  /** The middle of `Jump_Apex` — the top of the arc, where vertical speed is zero. */
  apex: number;
  /** Late in `Jump_Fall`, just before the legs brace — where the air pose waits for the floor. */
  brace: number;
  /** `Jump_Fall` ends: the feet touch down. */
  contact: number;
  /** `Jump_Land` ends: the sequence is over. */
  end: number;
}

/**
 * How long `Jump_Fall` spends bracing for the floor at its very end (s) — its
 * last two 30 fps frames, where the pelvis drops from 0.68 to 0.57 to meet the
 * ground. They belong to the impact, so they play on contact rather than
 * being held in mid-air through a long fall.
 */
export const BRACE_SECONDS = 2 / 30;

/**
 * The timeline for `actions`' rig, or `null` if it has no air pieces at all.
 * A missing piece takes up no time, so a partial rig still animates through
 * what it does have.
 */
export const jumpTimeline = (actions: CharacterActions): JumpTimeline | null => {
  const [start, rise, apex, fall, land] = JUMP_PIECES.map((piece) => actions[piece]?.getClip().duration ?? 0) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const contact = start + rise + apex + fall;
  if (contact === 0) return null;
  return {
    liftoff: start,
    apex: start + rise + apex / 2,
    brace: contact - Math.min(BRACE_SECONDS, fall),
    contact,
    end: contact + land,
  };
};

/**
 * The piece under `playhead` (s on the timeline) and its local time, resting
 * on the landing's last frame at the end. Drawn with `pinClipPose`: the
 * sequence is posed frame by frame, never left to the mixer's own clock.
 */
export const jumpPoseAt = (playhead: number, actions: CharacterActions): ClipPose | null => {
  const pieces = JUMP_PIECES.map((piece) => actions[piece]);
  return clipPoseInSequence(playhead, pieces) ?? lastClipPose(pieces);
};

/**
 * Crossfade for the jump's pieces (s) — much shorter than
 * `LOCOMOTION_CROSSFADE_SECONDS`, which is tuned for blending gaits that both
 * run for seconds. The pieces meet pose for pose, so this only has to cover
 * the step from a gait into the takeoff and back out of the landing.
 */
export const JUMP_CROSSFADE_SECONDS = 0.08;

/**
 * The fastest the sequence ever plays (× authored pace): when it has to catch
 * up after a short hop, or finish its air pieces after landing early on a
 * higher floor. Past this the pieces blur into a twitch — seen whole, but not
 * readably.
 */
export const MAX_PLAYBACK_RATE = 3;

/**
 * Pace of the landing for a Character still holding a direction (× authored).
 * `Jump_Land` is a 500 ms crouch-and-recover, which reads well if you land and
 * stand still, but played at full length mid-sprint it reads as a stumble. It
 * is sped up here rather than cut short, so the recovery is still seen. This is
 * the first number to change if a running landing looks wrong.
 */
export const LANDING_MOVING_RATE = 2;

/**
 * Upward speed (units/s) that counts as a push-off. Leave the floor slower than
 * this (off a ramp lip, or on a Ride's stray ungrounded frame, ADR 0061) and
 * the sequence joins the arc wherever that speed sits on it, with no takeoff.
 * A jump leaves at `JUMP_VELOCITY`, and a remote Character's first airborne
 * snapshot is at most a couple of ticks of gravity below that.
 */
export const TAKEOFF_MIN_SPEED = JUMP_VELOCITY / 2;

/**
 * A rise in vertical speed this large (units/s) between two frames is a fresh
 * launch mid-air — a bounce, a launch pad — so the sequence starts over.
 * Gravity only ever takes speed away, and an updraft adds well under this per
 * tick.
 */
export const RELAUNCH_KICK = 5;

/**
 * How long a Character must have been off the ground for the landing to be
 * worth drawing (ms). Below this there was nothing to recover from — a step
 * off a kerb, a ramp lip, the odd ungrounded frame a Ride produces (ADR
 * 0061) — and a half-second crouch for one of those reads as tripping.
 */
export const LANDING_MIN_AIRBORNE_MS = 180;

/**
 * How long (ms) Floating outlasts leaving every updraft. The bob carries a
 * Character a couple of units over the column's top every cycle, for about
 * 0.9 s with the fan's field. Without this latch the Float would drop out
 * and back in on every bob.
 */
export const FLOAT_RELEASE_MS = 1000;
/**
 * Which stretch of the air pieces the Float's loop walks, as a share of
 * liftoff → brace. On BLIP, 0 is the end of `Jump_Start`, 0.55 the apex,
 * and 1 the frame before the legs brace.
 */
export const FLOAT_LOOP_FROM = 0.15;
export const FLOAT_LOOP_TO = 0.9;
/** A slow sway of the playhead on top of the speed mapping (s of timeline), so a steady speed still moves. */
export const FLOAT_BREATHE_SECONDS = 0.06;
export const FLOAT_BREATHE_HZ = 0.7;
/** How fast the playhead closes on the loop's target (1/s): smooths the sim's 30 Hz speed steps. */
export const FLOAT_SETTLE_RATE = 7;
/** How long the Float's overlay takes to come in, and to go (s). */
export const FLOAT_BLEND_IN_SECONDS = 0.35;
export const FLOAT_BLEND_OUT_SECONDS = 0.3;

/** What {@link JumpSequences.advance} needs to know about a Character this frame. */
export interface JumpFrame {
  grounded: boolean;
  /** Units/s, up positive. */
  verticalVelocity: number;
  /** The Character's height this frame, in any fixed frame — only differences are used. */
  height: number;
  /** Still holding a direction — a landing mid-stride plays faster. */
  moving: boolean;
  deltaSeconds: number;
  nowMs: number;
  /**
   * Inside a Volume that holds a Character up (`holdsAloft`) this frame. It
   * starts a Float, and keeps one going (ADR 0077). Absent means no.
   */
  inUpdraft?: boolean;
}

interface Sequence {
  playhead: number;
  /** False once the feet are down and the landing is playing. */
  airborne: boolean;
  leftGroundAtMs: number;
  /** The height the feet left from — the floor the fall is paced to meet. */
  takeoffHeight: number;
  lastVerticalVelocity: number;
  /** Latched: held up by an updraft (see {@link FLOAT_RELEASE_MS}). */
  floating: boolean;
  lastInUpdraftMs: number;
  /** 0 → 1 as the Float takes the body: how much of its overlay to draw. */
  floatWeight: number;
}

/**
 * Where a sequence starts for a Character leaving the ground at `speed`: from
 * the very first frame if it pushed off, otherwise at the point on the arc
 * that matches its speed. The authored arc is a parabola, so clip time is
 * linear in vertical speed — `JUMP_VELOCITY` at liftoff, zero at the apex.
 * Walking off a ledge therefore starts at the top.
 */
const entryPoint = (speed: number, timeline: JumpTimeline): number => {
  if (speed >= TAKEOFF_MIN_SPEED) return 0;
  const onArc = timeline.apex - (speed / JUMP_VELOCITY) * (timeline.apex - timeline.liftoff);
  return Math.min(timeline.brace, Math.max(timeline.liftoff, onArc));
};

/**
 * Seconds until a Character `height` above its takeoff floor, moving at
 * `speed` (≤ 0), falls back to that floor under plain gravity. Zero or less
 * means it is already below that floor, so there is nothing to pace against.
 */
/**
 * Where a Float's loop wants the playhead for vertical `speed` at `nowMs`.
 * On the authored parabola clip time is linear in vertical speed (as in
 * {@link entryPoint}), and here the mapping runs both ways. Pushed up at
 * `JUMP_VELOCITY` it reaches the rise end of the loop, weightless the apex,
 * and sinking at that speed the fall end.
 */
export const floatLoopTarget = (speed: number, nowMs: number, timeline: JumpTimeline): number => {
  const span = timeline.brace - timeline.liftoff;
  const from = timeline.liftoff + FLOAT_LOOP_FROM * span;
  const to = timeline.liftoff + FLOAT_LOOP_TO * span;
  const apex = Math.min(to, Math.max(from, timeline.apex));
  const share = Math.max(-1, Math.min(1, speed / JUMP_VELOCITY));
  const bySpeed = share >= 0 ? apex - share * (apex - from) : apex - share * (to - apex);
  const breathe = FLOAT_BREATHE_SECONDS * Math.sin(2 * Math.PI * FLOAT_BREATHE_HZ * (nowMs / 1000));
  return Math.min(to, Math.max(from, bySpeed + breathe));
};

const approach = (value: number, target: number, step: number): number =>
  value < target ? Math.min(target, value + step) : Math.max(target, value - step);

const secondsToFloor = (height: number, speed: number): number => {
  const g = -GRAVITY_Y;
  const discriminant = speed * speed + 2 * g * height;
  return discriminant < 0 ? 0 : (speed + Math.sqrt(discriminant)) / g;
};

/**
 * Each Character's place in its jump sequence, keyed by id like the
 * renderer's other per-Character bookkeeping.
 */
export class JumpSequences {
  private readonly sequences = new Map<string, Sequence>();

  /**
   * Advances `id`'s sequence by one frame and returns its playhead (s on
   * `timeline`), or `null` when there is no jump to draw. Call it every frame
   * for every Character: this call is also what starts a sequence on takeoff,
   * cuts it off when a hop was too short to count, and ends it once the
   * landing has played.
   *
   * A non-null playhead on a grounded frame is the landing, drawn over
   * locomotion. It loses to a Grab and a Hit reaction like the rest of the
   * sequence, and jumping again during it starts a new sequence.
   */
  advance(id: string, frame: JumpFrame, timeline: JumpTimeline): number | null {
    const sequence = this.sequences.get(id);
    if (frame.grounded) return sequence ? this.land(id, sequence, frame, timeline) : null;

    const speed = frame.verticalVelocity;
    // A bounce or a launch pad starts over. A Float never does: its speed
    // swings are the updraft's own, not a fresh launch.
    const relaunched = sequence?.airborne === true && !sequence.floating && speed - sequence.lastVerticalVelocity >= RELAUNCH_KICK;
    if (!sequence || !sequence.airborne || relaunched) {
      const fresh: Sequence = {
        playhead: entryPoint(speed, timeline),
        airborne: true,
        // A relaunch is still the same stretch of air.
        leftGroundAtMs: sequence?.airborne ? sequence.leftGroundAtMs : frame.nowMs,
        takeoffHeight: frame.height,
        lastVerticalVelocity: speed,
        floating: false,
        lastInUpdraftMs: sequence?.lastInUpdraftMs ?? -Infinity,
        floatWeight: sequence?.floatWeight ?? 0,
      };
      this.sequences.set(id, fresh);
      this.float(fresh, frame);
      return fresh.playhead;
    }

    this.float(sequence, frame);
    if (sequence.floating && sequence.playhead >= timeline.liftoff) {
      // Held up: the loop, paced by the updraft's own bob. The push-off
      // before liftoff finishes at the ordinary pace, below.
      const target = floatLoopTarget(speed, frame.nowMs, timeline);
      sequence.playhead += (target - sequence.playhead) * (1 - Math.exp(-FLOAT_SETTLE_RATE * frame.deltaSeconds));
    } else {
      // Rising, aim for the top of Apex at the top of the arc. Falling, aim
      // for the brace at the takeoff floor. Plain gravity is assumed on the
      // way up: a held jump rises for longer than that, so the playhead
      // arrives a little early and waits there.
      const target = speed > 0 ? timeline.apex : timeline.brace;
      const secondsLeft = speed > 0 ? speed / -GRAVITY_Y : secondsToFloor(frame.height - sequence.takeoffHeight, speed);
      const rate = secondsLeft > 0 ? Math.min(MAX_PLAYBACK_RATE, (target - sequence.playhead) / secondsLeft) : 1;
      const stepped = Math.min(target, sequence.playhead + Math.max(0, rate) * frame.deltaSeconds);
      // Never backwards: rising again after the apex without Floating (a
      // weak updraft) just waits.
      sequence.playhead = Math.max(sequence.playhead, stepped);
    }
    sequence.lastVerticalVelocity = speed;
    return sequence.playhead;
  }

  /**
   * How much of the Float's overlay to draw for `id` this frame, 0 to 1
   * (ADR 0077). It rises while Floating and fades once the Float lets go,
   * the landing included.
   */
  floatWeight(id: string): number {
    return this.sequences.get(id)?.floatWeight ?? 0;
  }

  /** Whether `id` is Floating right now. */
  isFloating(id: string): boolean {
    return this.sequences.get(id)?.floating ?? false;
  }

  /** The Float's latch and its overlay weight, for an airborne frame. */
  private float(sequence: Sequence, frame: JumpFrame): void {
    if (frame.inUpdraft) {
      sequence.lastInUpdraftMs = frame.nowMs;
      sequence.floating = true;
    } else if (frame.nowMs - sequence.lastInUpdraftMs > FLOAT_RELEASE_MS) {
      sequence.floating = false;
    }
    this.blend(sequence, frame.deltaSeconds);
  }

  private blend(sequence: Sequence, deltaSeconds: number): void {
    const seconds = sequence.floating ? FLOAT_BLEND_IN_SECONDS : FLOAT_BLEND_OUT_SECONDS;
    sequence.floatWeight = approach(sequence.floatWeight, sequence.floating ? 1 : 0, deltaSeconds / seconds);
  }

  private land(id: string, sequence: Sequence, frame: JumpFrame, timeline: JumpTimeline): number | null {
    // Feet down ends a Float at once. Its overlay fades out under the landing.
    sequence.floating = false;
    this.blend(sequence, frame.deltaSeconds);
    if (sequence.airborne) {
      if (frame.nowMs - sequence.leftGroundAtMs < LANDING_MIN_AIRBORNE_MS) {
        this.sequences.delete(id);
        return null;
      }
      sequence.airborne = false;
    }
    // Whatever the air still owes is shown first, quickly. Then the brace and
    // the landing play at their own pace, or faster mid-stride.
    const rate =
      sequence.playhead < timeline.brace ? MAX_PLAYBACK_RATE : frame.moving ? LANDING_MOVING_RATE : 1;
    sequence.playhead += rate * frame.deltaSeconds;
    if (sequence.playhead >= timeline.end) {
      this.sequences.delete(id);
      return null;
    }
    return sequence.playhead;
  }

  /**
   * Drops `id`'s sequence. Call it when something else takes over the whole
   * body (a knockdown), so a Character getting back up doesn't finish a jump
   * it was in before it went down.
   */
  forget(id: string): void {
    this.sequences.delete(id);
  }

  reset(): void {
    this.sequences.clear();
  }
}
