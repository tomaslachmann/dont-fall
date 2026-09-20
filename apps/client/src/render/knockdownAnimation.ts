import {
  CAPSULE_BOTTOM_OFFSET,
  GETUP_DRIVE_MS,
  matchGetUp,
  type BoneSnapshot,
  type CharacterMotionState,
  type GetUpMatch,
  type Vec3,
} from "@dont-fall/shared";
import * as THREE from "three";
import { RAGDOLL_PELVIS_TO_FEET, type CharacterActions, type ClipPose, type KnockdownDirection } from "./characterModel.js";

/**
 * The knockdown, physics first (`.scratch/physical-ragdoll` ticket 02/03,
 * superseding ADR 0076's authored fall):
 *
 * - **`Ragdoll`** draws no clip at all. The rig is posed bone for bone from
 *   the replicated ragdoll (`RagdollRig`), so every fall is the one that
 *   actually happened — reacting to the floor, a Prop, the Character that hit
 *   you.
 * - **`GettingUp`** opens with the simulation's own kinematic sweep carrying
 *   the heap onto `GetUp_X`'s first frame ({@link GETUP_DRIVE_MS}); the rig
 *   keeps drawing from bones through it. Then the clip plays, from frame 0 at
 *   full weight: the two poses are the same pose, so there is nothing to
 *   crossfade and nothing to hide.
 *
 * `KO_*` and `Death_*` stay bound, driven by nothing.
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
  /** The replicated ragdoll bones — what the fall is drawn from, and what the get-up is read off. */
  bones: readonly BoneSnapshot[];
  /**
   * Doing anything but standing still: moving, off the ground, dashing,
   * holding or being held. Only read once the Character is back in
   * `Controlled`, where it cuts the get-up's remaining frames short.
   */
  busy: boolean;
  deltaSeconds: number;
}

/**
 * What to draw this frame: the bones themselves (the fall, and the sweep that
 * opens the get-up), or the get-up clip placed where the sweep left the body.
 */
export type KnockdownDraw =
  | { kind: "bones" }
  | { kind: "clip"; pose: ClipPose; landing: GetUpMatch };

interface Knockdown {
  direction: KnockdownDirection;
  phase: "fall" | "sweep" | "getUp";
  /** Seconds into the current phase. */
  seconds: number;
  /** Where the sweep put the body — read off the bones once the sweep has ended. */
  landing: GetUpMatch | null;
  /** Past `GettingUp` already, playing the get-up's last frames in `Controlled`. */
  inTail: boolean;
}

/** The sweep's length, in seconds — the simulation's own {@link GETUP_DRIVE_MS}. */
const SWEEP_SECONDS = GETUP_DRIVE_MS / 1000;

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
  advance(id: string, frame: KnockdownFrame, actions: CharacterActions): KnockdownDraw | null {
    const entry = this.entries.get(id);
    const { motionState, deltaSeconds } = frame;

    if (motionState === "Ragdoll") {
      // A fresh fall, or a new one landing during the last one's get-up tail.
      if (!entry || entry.phase !== "fall") return this.start(id, "fall", frame, actions);
      entry.seconds += deltaSeconds;
      return { kind: "bones" };
    }

    if (motionState === "GettingUp") {
      // A get-up whose fall was never drawn (a rig that started watching
      // mid-knockdown): it still has bones to sweep and read.
      if (!entry || entry.inTail) return this.start(id, "sweep", frame, actions);
      if (entry.phase === "fall") {
        entry.phase = "sweep";
        entry.seconds = 0;
      } else {
        entry.seconds += deltaSeconds;
      }
      if (entry.phase === "sweep") {
        if (entry.seconds < SWEEP_SECONDS) return { kind: "bones" };
        // The sweep has ended on the clip's own first frame: the bones say
        // exactly where and which way it is played, so the handover needs no
        // crossfade — and must not have one. The heap and the clip encode
        // "lying" in different frames (bone transforms vs a pitched root),
        // and blending between two encodings of one world pose sweeps the
        // body through nonsense (measured on the rubber bench).
        this.land(entry, frame);
      }
      return drawOf(entry, actions) ?? { kind: "bones" };
    }

    if (!entry) return null;
    // Only the get-up's tail survives into `Controlled`, and only standing
    // still: a fall that never got up was undone by a correction, and a
    // Wobble or anything the Player does owns the body from here.
    if (entry.phase !== "getUp" || motionState !== "Controlled" || frame.busy) {
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
    return drawOf(entry, actions);
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

  private start(id: string, phase: Knockdown["phase"], frame: KnockdownFrame, actions: CharacterActions): KnockdownDraw | null {
    const entry: Knockdown = { direction: KNOCKDOWN_FALLBACK, phase, seconds: 0, landing: null, inTail: false };
    this.entries.set(id, entry);
    // A rig that starts watching part-way through a get-up has missed the
    // sweep; the bones it can see are already on (or near) the clip's first
    // frame, so it reads the landing and joins the clip rather than waiting
    // out a sweep that has been and gone.
    if (phase === "sweep" && frame.bones.length > 0) {
      this.land(entry, frame);
      return drawOf(entry, actions) ?? { kind: "bones" };
    }
    return { kind: "bones" };
  }

  /**
   * Reads where the sweep left the body off the bones themselves and starts
   * the clip there. The same pure rule the simulation swept by
   * (`matchGetUp`), applied to the pose it swept onto, which is why this
   * needs no field of its own on the wire.
   */
  private land(entry: Knockdown, frame: KnockdownFrame): void {
    const landing = matchGetUp(frame.bones);
    entry.phase = "getUp";
    entry.seconds = 0;
    if (landing) {
      entry.landing = landing;
      entry.direction = landing.side;
    }
  }
}

/** The clip frame `entry` is on, resting on its last once it has played. `null` if the rig lacks the clip or the landing. */
const drawOf = (entry: Knockdown, actions: CharacterActions): KnockdownDraw | null => {
  const action = actions.getUp[entry.direction];
  if (!action || !entry.landing) return null;
  return {
    kind: "clip",
    pose: { action, time: Math.min(entry.seconds, action.getClip().duration) },
    landing: entry.landing,
  };
};

/**
 * Where standing feet would be for a Character reported at `positionY` while
 * down. While `Ragdoll`, that position is the physics pelvis. While
 * `GettingUp`, it rises from there to the capsule standing at the get-up
 * clip's own origin, so by the time the clip plays this is that origin's
 * floor exactly.
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
