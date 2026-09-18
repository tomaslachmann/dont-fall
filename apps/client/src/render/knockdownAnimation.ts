import { CAPSULE_BOTTOM_OFFSET, type CharacterMotionState, type Vec3 } from "@dont-fall/shared";
import * as THREE from "three";
import { RAGDOLL_PELVIS_TO_FEET, type CharacterActions, type ClipPose, type KnockdownDirection } from "./characterModel.js";

/**
 * The knockdown as the rig authored it (ADR 0076): `KO_X`, held down, then
 * `GetUp_X`, with X the way the Character was pushed. Physics still decides
 * where the body is; these clips decide only what it looks like.
 */

/**
 * The six falls, clockwise from the rig's forward (+Z) toward its +X, one
 * every 60°. `modelBones.test.ts` measures each `KO_X` against this order
 * in the real file: `KO_F` lays the body along +Z, `KO_FR` 60° toward +X,
 * and so on round.
 */
export const KNOCKDOWN_SECTORS: readonly KnockdownDirection[] = ["F", "FR", "BR", "B", "BL", "FL"];

/** Below this horizontal speed (units/s) there is no push to read a direction from. */
export const KNOCKDOWN_MIN_PUSH_SPEED = 0.05;

/** The fall for a knockdown with no push to read: onto its back, like a stumble. */
export const KNOCKDOWN_FALLBACK: KnockdownDirection = "B";

/**
 * How long (s) a knockdown keeps looking for its push. Its first frames
 * stand the same way in every direction, so a push that turns up a frame or
 * two late still picks the fall without a visible switch — and within this
 * window the LAST non-null read wins, because the first one is usually the
 * Character's own stale walk velocity, not the shove (found live 2026-09-18).
 */
export const KNOCKDOWN_PICK_SECONDS = 0.1;

/**
 * Crossfade into and between the knockdown's clips (s). `KO_X` ends pose for
 * pose where `GetUp_X` begins, so the fade only has to cover the step out of
 * whatever the Character was doing when it went down.
 */
export const KNOCKDOWN_CROSSFADE_SECONDS = 0.08;

/**
 * Which way a Character pushed along `push` (world space; only the
 * horizontal part counts) falls, for a model rotated by `modelQuaternion`.
 * Returns `null` when there is no push to read. Sectors are 60° wide around
 * each fall's centre, lower edge inclusive, so a push exactly between two
 * falls takes the next one clockwise (the rig's own manifest rule).
 */
export const knockdownDirection = (push: Vec3, modelQuaternion: THREE.Quaternion): KnockdownDirection | null => {
  const local = new THREE.Vector3(push.x, 0, push.z).applyQuaternion(modelQuaternion.clone().invert());
  if (Math.hypot(local.x, local.z) < KNOCKDOWN_MIN_PUSH_SPEED) return null;
  const degrees = ((Math.atan2(local.x, local.z) * 180) / Math.PI + 360) % 360;
  return KNOCKDOWN_SECTORS[Math.floor((degrees + 30) / 60) % KNOCKDOWN_SECTORS.length]!;
};

/** What {@link Knockdowns.advance} needs to know about a Character this frame. */
export interface KnockdownFrame {
  /** The replicated motion state this rig is drawing. */
  motionState: CharacterMotionState;
  /** World units/s. While `Ragdoll`, the ragdoll's own velocity: the push. */
  velocity: Vec3;
  /** The model's world rotation, read only while a fall is picking its direction. */
  modelQuaternion: THREE.Quaternion;
  /**
   * Doing anything but standing still: moving, off the ground, dashing,
   * holding or being held. Only read once the Character is back in
   * `Controlled`, where it cuts the get-up's remaining frames short.
   */
  busy: boolean;
  deltaSeconds: number;
}

interface Knockdown {
  direction: KnockdownDirection;
  phase: "ko" | "getUp";
  /** Seconds into the current phase's clip. */
  seconds: number;
  /** Past `GettingUp` already, playing the get-up's last frames in `Controlled`. */
  inTail: boolean;
}

/**
 * Each Character's place in its knockdown, keyed by id like the renderer's
 * other per-Character bookkeeping (`JumpSequences`, `GrabAnimations`). The
 * phases follow the replicated `motionState` edges, on render-side clocks:
 *
 * - `Ragdoll`: `KO_X` from its first drawn frame, held on its last.
 * - `GettingUp`: `GetUp_X` from its first drawn frame. A rig first seen here,
 *   with no fall to take a direction from, gets up as {@link KNOCKDOWN_FALLBACK}.
 * - Back in `Controlled`: the rest of `GetUp_X`, while the Character stands
 *   still. Anything else ends it: being busy, a `Stagger`, a reconciliation
 *   that went straight from `Ragdoll` to `Controlled`.
 */
export class Knockdowns {
  private readonly entries = new Map<string, Knockdown>();

  /**
   * Advances `id`'s knockdown by one frame and returns the pose to draw, or
   * `null` when there is none. Call it every frame for every Character: this
   * call is also what starts a knockdown, moves it on to the get-up, and
   * ends it.
   */
  advance(id: string, frame: KnockdownFrame, actions: CharacterActions): ClipPose | null {
    const entry = this.entries.get(id);
    const { motionState, deltaSeconds } = frame;

    if (motionState === "Ragdoll") {
      // A fresh fall, or a new one landing during the last one's get-up tail.
      if (!entry || entry.phase !== "ko") return this.start(id, "ko", frame, actions);
      entry.seconds += deltaSeconds;
      // Re-picked every frame of the window, last non-null read wins (found
      // live 2026-09-18: every fall played the same clip). Latching the first
      // non-null read defeated the window's whole purpose: a *moving*
      // Character's first drawn Ragdoll frame still carries its own walk
      // velocity — the drawn world runs a beat behind the push — so the fall
      // always followed the run, never the shove that caused it. The clips'
      // first frames stand the same in every direction, which is exactly what
      // makes a switch inside the window invisible.
      if (entry.seconds <= KNOCKDOWN_PICK_SECONDS) this.pick(entry, frame);
      return poseOf(entry, actions);
    }

    if (motionState === "GettingUp") {
      // A get-up whose fall was never drawn: nothing to take a direction from.
      if (!entry || entry.inTail) return this.start(id, "getUp", frame, actions);
      if (entry.phase === "ko") {
        entry.phase = "getUp";
        entry.seconds = 0;
      } else {
        entry.seconds += deltaSeconds;
      }
      return poseOf(entry, actions);
    }

    if (!entry) return null;
    // Only the get-up's tail survives into `Controlled`, and only standing
    // still: a fall that never got up was undone by a correction, and a
    // Wobble or anything the Player does owns the body from here.
    if (entry.phase === "ko" || motionState !== "Controlled" || frame.busy) {
      this.entries.delete(id);
      return null;
    }
    entry.inTail = true;
    entry.seconds += deltaSeconds;
    const clip = actions.getUp[entry.direction];
    if (!clip || entry.seconds >= clip.getClip().duration) {
      this.entries.delete(id);
      return null;
    }
    return poseOf(entry, actions);
  }

  /** Whether `id` is anywhere in a knockdown, its get-up's tail included. */
  has(id: string): boolean {
    return this.entries.has(id);
  }

  /** Drops `id`'s knockdown — something else took the body (a Hit reaction), or the rig is gone. */
  forget(id: string): void {
    this.entries.delete(id);
  }

  reset(): void {
    this.entries.clear();
  }

  private start(id: string, phase: Knockdown["phase"], frame: KnockdownFrame, actions: CharacterActions): ClipPose | null {
    const entry: Knockdown = { direction: KNOCKDOWN_FALLBACK, phase, seconds: 0, inTail: false };
    if (phase === "ko") this.pick(entry, frame);
    this.entries.set(id, entry);
    return poseOf(entry, actions);
  }

  private pick(entry: Knockdown, frame: KnockdownFrame): void {
    const direction = knockdownDirection(frame.velocity, frame.modelQuaternion);
    if (direction !== null) entry.direction = direction;
  }
}

/** The frame `entry` is on, resting on the clip's last frame once it has played. `null` if the rig lacks the clip. */
const poseOf = (entry: Knockdown, actions: CharacterActions): ClipPose | null => {
  const action = (entry.phase === "ko" ? actions.ko : actions.getUp)[entry.direction];
  if (!action) return null;
  return { action, time: Math.min(entry.seconds, action.getClip().duration) };
};

/**
 * Where standing feet would be for a Character reported at `positionY` while
 * down. While `Ragdoll`, that position is the physics pelvis. While
 * `GettingUp`, it rises from there to the standing capsule's centre.
 */
export const knockdownFeetY = (motionState: CharacterMotionState, positionY: number): number =>
  positionY - (motionState === "Ragdoll" ? RAGDOLL_PELVIS_TO_FEET : CAPSULE_BOTTOM_OFFSET);

/** How far above a down Character's `position` the floor probe starts: clear of a pelvis sunk into the deck. */
export const KNOCKDOWN_FLOOR_PROBE = 0.5;
/** How far the floor probe reaches down from its start. A floor further below is out of reach, and the body is in the air. */
export const KNOCKDOWN_FLOOR_REACH = 3;
/** A floor-height change bigger than this in one frame (units) is a step, eased rather than drawn as a pop. */
export const KNOCKDOWN_ORIGIN_STEP = 0.02;
/** How fast an eased step closes (s, time constant). */
export const KNOCKDOWN_ORIGIN_EASE_SECONDS = 0.12;

/** The floor's height under a point, or `null` with no floor within reach. */
export type FloorQuery = (x: number, y: number, z: number) => number | null;

/**
 * Where a down rig's origin stands, vertically (ADR 0076). The clips are
 * authored to be played on the floor, so lying on a deck the origin is the
 * floor under the Character. Launched into the air or knocked off an edge,
 * standing feet (from the physics position) are higher than any floor in
 * reach, and the origin follows those instead.
 *
 * A jump in that target, such as sliding off an edge or onto a lower step,
 * is eased out over {@link KNOCKDOWN_ORIGIN_EASE_SECONDS} instead of drawn
 * as a pop. Following physics is never eased, whether launched off the deck
 * or through the air: that motion is continuous already, and easing it would
 * drag the body behind.
 */
export class KnockdownOrigin {
  private lastTarget: number | null = null;
  private lastOnFloor = false;
  private lastMs = 0;
  private offset = 0;

  /** The origin's height at `nowMs`, for a rig with `floorY` under it and standing feet at `feetY`. */
  place(floorY: number | null, feetY: number, nowMs: number): number {
    const onFloor = floorY !== null && floorY >= feetY;
    const target = onFloor ? floorY : feetY;
    if (this.lastTarget !== null) {
      const seconds = Math.max(0, (nowMs - this.lastMs) / 1000);
      this.offset *= Math.exp(-seconds / KNOCKDOWN_ORIGIN_EASE_SECONDS);
      const jump = target - this.lastTarget;
      // On a floor, any jump is a step. Leaving one, only a drop is: the deck
      // ran out. Rising off it is the body being launched, already continuous.
      const step = onFloor ? Math.abs(jump) > KNOCKDOWN_ORIGIN_STEP : this.lastOnFloor && jump < -KNOCKDOWN_ORIGIN_STEP;
      if (step) this.offset -= jump;
    }
    this.lastTarget = target;
    this.lastOnFloor = onFloor;
    this.lastMs = nowMs;
    return target + this.offset;
  }

  /** The Character is back on its feet: the next knockdown starts from wherever it is. */
  reset(): void {
    this.lastTarget = null;
    this.lastOnFloor = false;
    this.offset = 0;
  }
}
