import { FightCues, type FightFrame } from "../audio/fightCues.js";
import { MovementCues, type MovementFrame } from "../audio/movementCues.js";
import type { ScreenShake } from "../lib/gameplaySettings.js";

/**
 * Screen shake on impact (ADR 0110): the camera jolts when your own Character
 * is knocked down, hit, bumped or lands hard. Presentation only, like the
 * sounds the same events play — it reads the same per-Character cue
 * detectors (`FightCues`, `MovementCues`) and never touches the simulation.
 *
 * The model is "trauma": each impact adds some, it drains linearly, and the
 * jolt is its square, so small knocks barely move the view while a knockdown
 * rattles it. The Player's setting scales the jolt, OFF being none at all.
 */

/** What each setting multiplies the jolt by. */
export const SCREEN_SHAKE_SCALE: Readonly<Record<ScreenShake, number>> = { OFF: 0, LOW: 0.4, FULL: 1 };

/** Trauma each impact adds, 0–1. */
export const SHAKE_KNOCKDOWN_HEAVY = 0.9;
export const SHAKE_KNOCKDOWN = 0.65;
export const SHAKE_HIT_TAKEN = 0.45;
export const SHAKE_BUMP = 0.25;
/** A landing only jolts from this fall speed (u/s) up, and by this much per u/s above it, to at most {@link SHAKE_LANDING_MAX}. */
export const SHAKE_LANDING_FROM = 10;
export const SHAKE_LANDING_PER_SPEED = 0.05;
export const SHAKE_LANDING_MAX = 0.5;

/** How fast trauma drains, per second — a full jolt settles in about two-thirds of a second. */
export const SHAKE_DECAY_PER_S = 1.5;
/** The furthest the camera moves (m) and turns (rad) at full trauma. */
export const SHAKE_MAX_OFFSET = 0.3;
export const SHAKE_MAX_ROLL = 0.04;

type ShakeFrame = Omit<FightFrame, "respawned" | "nowMs"> & Omit<MovementFrame, "nowMs">;

/** How much one frame of your own Character's cues adds to the trauma — pure over the cue detectors. */
export class ShakeCues {
  private readonly fights = new FightCues();
  // The fall line only drives a whistle, never a jolt: nothing is ever below it.
  private readonly moves = new MovementCues(-Infinity);

  update(id: string, character: ShakeFrame, nowMs: number): number {
    const movement = this.moves.update(id, { ...character, nowMs });
    const fight = this.fights.update(id, { ...character, respawned: movement.respawned, nowMs });
    let kick = 0;
    if (fight.knockdown) kick = Math.max(kick, fight.knockdown.weight === "heavy" ? SHAKE_KNOCKDOWN_HEAVY : SHAKE_KNOCKDOWN);
    if (fight.struck) kick = Math.max(kick, SHAKE_HIT_TAKEN);
    if (fight.bumped) kick = Math.max(kick, SHAKE_BUMP);
    if (movement.landing && movement.landing.fallSpeed > SHAKE_LANDING_FROM) {
      kick = Math.max(kick, Math.min(SHAKE_LANDING_MAX, (movement.landing.fallSpeed - SHAKE_LANDING_FROM) * SHAKE_LANDING_PER_SPEED));
    }
    return kick;
  }
}

/** The camera's jolt this frame: an offset and a roll, from the trauma left. */
export interface ShakeOffset {
  x: number;
  y: number;
  z: number;
  roll: number;
}

export class CameraShake {
  private trauma = 0;
  private time = 0;

  constructor(private scale: number) {}

  /** The Player changed the setting mid-Round. */
  setScale(scale: number): void {
    this.scale = scale;
    if (scale === 0) this.trauma = 0;
  }

  /** An impact: adds `amount` of trauma, capped at 1. Nothing with the setting OFF. */
  kick(amount: number): void {
    if (this.scale === 0 || amount <= 0) return;
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Advances by `deltaSeconds` and returns this frame's jolt — zero once the trauma has drained. */
  step(deltaSeconds: number): ShakeOffset {
    this.time += deltaSeconds;
    this.trauma = Math.max(0, this.trauma - SHAKE_DECAY_PER_S * deltaSeconds);
    const amount = this.trauma * this.trauma * this.scale;
    if (amount === 0) return { x: 0, y: 0, z: 0, roll: 0 };
    // Three incommensurate wobbles per axis: shaky, never a visible loop.
    const t = this.time;
    const wobble = (a: number, b: number, c: number) => (Math.sin(t * a) + Math.sin(t * b + 1.3) + Math.sin(t * c + 2.1)) / 3;
    return {
      x: SHAKE_MAX_OFFSET * amount * wobble(37, 53, 71),
      y: SHAKE_MAX_OFFSET * amount * wobble(41, 59, 67),
      z: SHAKE_MAX_OFFSET * amount * wobble(43, 61, 73),
      roll: SHAKE_MAX_ROLL * amount * wobble(29, 47, 83),
    };
  }
}
