import { pointInOrientedBox, type LaunchPadConfig, type OrientedBox, type Vec3 } from "@dont-fall/shared";

/**
 * How a Spring reads when it fires (ADR 0069) — provisional tuning, a
 * measurement rather than a decision. Compress fast (two ticks), release
 * past its own height, settle back.
 */
export const SQUASH_COMPRESS_MS = 66;
export const SQUASH_RELEASE_MS = 180;
export const SQUASH_SETTLE_MS = 120;
export const SQUASH_TOTAL_MS = SQUASH_COMPRESS_MS + SQUASH_RELEASE_MS + SQUASH_SETTLE_MS;
/** How flat it gets at the bottom of the compress, and how tall at the top of the release. */
export const SQUASH_LOW = 0.55;
export const SQUASH_HIGH = 1.12;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Smooth at both ends — a linear scale ramp reads as a machine, not a spring. */
const ease = (t: number): number => t * t * (3 - 2 * t);

/**
 * The squash at `ms` after a Spring fired, as a vertical scale. Volume is
 * preserved (`xz = 1/√y`), which is what makes a squash read as a squash
 * rather than as the piece shrinking.
 *
 * Cosmetic from end to end: the collision never moves (ADR 0069), and the
 * launch already happened on the tick that started this — the anticipation is
 * drawn *after* the throw, never in front of it.
 */
export const squashScale = (ms: number): { y: number; xz: number } => {
  const y =
    ms <= 0 || ms >= SQUASH_TOTAL_MS
      ? 1
      : ms < SQUASH_COMPRESS_MS
        ? lerp(1, SQUASH_LOW, ease(ms / SQUASH_COMPRESS_MS))
        : ms < SQUASH_COMPRESS_MS + SQUASH_RELEASE_MS
          ? lerp(SQUASH_LOW, SQUASH_HIGH, ease((ms - SQUASH_COMPRESS_MS) / SQUASH_RELEASE_MS))
          : lerp(SQUASH_HIGH, 1, ease((ms - SQUASH_COMPRESS_MS - SQUASH_RELEASE_MS) / SQUASH_SETTLE_MS));
  return { y, xz: 1 / Math.sqrt(y) };
};

/** One resolved Spring, as the renderer needs it: where it fires, and which Segment to squash. */
export interface SpringTrigger {
  trigger: OrientedBox;
  segmentIndex: number;
}

/**
 * `resolveTrack`'s two index-aligned arrays, paired up — the renderer's whole
 * view of the Track's Springs. Every pad left is a Spring (the procedural
 * pad ADR 0073 deleted is gone), so every Segment here draws an Asset to
 * squash.
 */
export const springTriggers = (
  launchPads: readonly LaunchPadConfig[],
  launchPadOwners: readonly number[],
): SpringTrigger[] =>
  launchPads.flatMap((pad, i) => {
    const segmentIndex = launchPadOwners[i];
    return segmentIndex === undefined ? [] : [{ trigger: pad.trigger, segmentIndex }];
  });

/**
 * Which Spring a Character just fired, or `undefined` when none is close
 * enough to be the one.
 *
 * Containment first — the simulation fired on exactly that test. A render
 * position is interpolated and can sit a frame either side of the trigger it
 * crossed, so the nearest trigger within `NEAR` is the fallback; guessing a
 * neighbouring Spring is better than no squash at all, and a Track with two
 * Springs inside 4 units of each other has bigger problems.
 */
const NEAR = 4;
export const springFiredBy = (position: Vec3, springs: readonly SpringTrigger[]): SpringTrigger | undefined => {
  const contained = springs.find((spring) => pointInOrientedBox(position, spring.trigger));
  if (contained) return contained;
  let best: SpringTrigger | undefined;
  let bestDistance = NEAR;
  for (const spring of springs) {
    const c = spring.trigger.center;
    const distance = Math.hypot(position.x - c.x, position.y - c.y, position.z - c.z);
    if (distance < bestDistance) {
      best = spring;
      bestDistance = distance;
    }
  }
  return best;
};

/**
 * Tracks which Springs are mid-squash, from Characters' `launchPadEpoch`.
 *
 * Latched per **Segment**, not per Character: two Players launching off one
 * Spring in one tick is one squash, restarted rather than stacked. Latched on
 * the epoch's *value*, not on "it changed", so a replayed prediction tick that
 * re-produces an already-seen epoch is a no-op (ADR 0013's discipline).
 */
export class SpringSquashes {
  private readonly lastEpoch = new Map<string, number>();
  private readonly firedAt = new Map<number, number>();
  private settledNow: number[] = [];

  /** The Segments whose squash ended in the last {@link update}: a Spring back at rest (M14 ticket 08). */
  settled(): readonly number[] {
    return this.settledNow;
  }

  /** Feed this frame's Characters; returns the Segments to squash and by how much. */
  update(
    characters: Record<string, { position: Vec3; launchPadEpoch: number }>,
    springs: readonly SpringTrigger[],
    nowMs: number,
  ): Map<number, { y: number; xz: number }> {
    for (const [id, character] of Object.entries(characters)) {
      const seen = this.lastEpoch.get(id);
      this.lastEpoch.set(id, character.launchPadEpoch);
      // A Character that joins mid-Match arrives with whatever Epoch it has
      // already reached; that is history, not a Spring firing now.
      if (seen === undefined || character.launchPadEpoch === seen) continue;
      const spring = springFiredBy(character.position, springs);
      if (spring) this.firedAt.set(spring.segmentIndex, nowMs);
    }

    const active = new Map<number, { y: number; xz: number }>();
    this.settledNow = [];
    for (const [segmentIndex, firedAt] of this.firedAt) {
      const ms = nowMs - firedAt;
      if (ms >= SQUASH_TOTAL_MS) {
        this.firedAt.delete(segmentIndex);
        this.settledNow.push(segmentIndex);
        // One last exact 1 so a Spring never settles a hair off its own size.
        active.set(segmentIndex, { y: 1, xz: 1 });
        continue;
      }
      active.set(segmentIndex, squashScale(ms));
    }
    return active;
  }

  /** Forget every Character and every squash — a Track reload, where Segment indices stop meaning what they meant. */
  reset(): void {
    this.lastEpoch.clear();
    this.firedAt.clear();
    this.settledNow = [];
  }
}
