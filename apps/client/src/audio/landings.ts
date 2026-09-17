import { LANDING_MIN_AIRBORNE_MS } from "../render/jumpSequence.js";
import type { SoundSlot } from "./slots.js";

/**
 * Fall speed (units/s) from which a landing is heavy. A plain jump lands at
 * about `JUMP_VELOCITY` (10); dropping a tier or coming off a Spring lands
 * well past this.
 */
export const LAND_HEAVY_FALL_SPEED = 14;

/** A landing: how fast the Character was falling when its feet came down. */
export interface Landing {
  fallSpeed: number;
}

interface Airborne {
  leftGroundAtMs: number;
  peakFallSpeed: number;
}

/**
 * Each Character's landings, keyed by id (M14 ticket 02, ADR 0087), under the
 * same rule that decides whether the landing animation plays: a stretch in
 * the air shorter than {@link LANDING_MIN_AIRBORNE_MS} is no landing, just
 * a step off a kerb.
 */
export class Landings {
  private readonly airborne = new Map<string, Airborne>();
  private readonly seen = new Set<string>();

  /** Advances `id` by one frame. Returns the landing that happened this frame, if one did. */
  update(id: string, grounded: boolean, verticalVelocity: number, nowMs: number): Landing | null {
    const known = this.seen.has(id);
    this.seen.add(id);
    const air = this.airborne.get(id);
    if (!grounded) {
      const fallSpeed = Math.max(0, -verticalVelocity);
      if (air) air.peakFallSpeed = Math.max(air.peakFallSpeed, fallSpeed);
      // A Character first seen in the air has no takeoff to measure from; its landing still counts.
      else this.airborne.set(id, { leftGroundAtMs: known ? nowMs : -Infinity, peakFallSpeed: fallSpeed });
      return null;
    }
    if (!air) return null;
    this.airborne.delete(id);
    return nowMs - air.leftGroundAtMs < LANDING_MIN_AIRBORNE_MS ? null : { fallSpeed: air.peakFallSpeed };
  }

  /** Drops `id`'s air time: a knockdown owns the body, and getting up is no landing. */
  forget(id: string): void {
    this.airborne.delete(id);
  }
}

/**
 * The sound a landing makes: heavy from {@link LAND_HEAVY_FALL_SPEED}, and
 * louder the faster the fall, from a soft touchdown at walking-off-a-step
 * speeds up to full volume.
 */
export const landingSound = ({ fallSpeed }: Landing): { slot: SoundSlot; gain: number } => ({
  slot: fallSpeed >= LAND_HEAVY_FALL_SPEED ? "character.land_heavy" : "character.land",
  gain: Math.min(1, Math.max(0.35, fallSpeed / LAND_HEAVY_FALL_SPEED)),
});
