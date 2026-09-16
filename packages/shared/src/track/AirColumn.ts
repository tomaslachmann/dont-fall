import { conjugateQuat, IDENTITY_QUAT } from "../math/quat.js";
import { lengthVec3, rotateVec3ByQuat, scaleVec3, subVec3, type Vec3 } from "../math/vec3.js";
import type { VolumeConfig } from "../simulation/Volume.js";

/**
 * How a Volume's flow draws (ADR 0075). This is shared pure maths, so the
 * game and any future preview cut the same cloth (ADR 0070's rule).
 *
 * The flow is cartoon air, in the game's own language. **Swooshes** are thin
 * tapered ribbons that spiral along the force, spread out to the Volume's own
 * width, and curl out at the far end. **Puffs** are small cloud puffs popping
 * out of the entry face. This was the user's pick from the fan prototype
 * (2026-09-16), over the translucent box and rings it replaces: the swooshes
 * spread to the Volume's width, so the air marks its own region.
 *
 * The flow follows the Volume's `force`, not the world's up. An updraft rises
 * and a sideways wind reads sideways, with no extra data. Everything below the
 * frame is in the **column's own frame**: the origin is the centre of the
 * entry face, and +Y runs along the force.
 *
 * Every number here is the prototype's pick, carried over unchanged. They are
 * render tuning, not decisions.
 */

/**
 * The air's width where it leaves the entry face, as a share of the
 * Volume's half-width. Measured off the fan: its rotor reaches 0.53 in a
 * 1.5-half-wide field.
 */
export const AIR_MOUTH_SHARE = 0.36;

/** Swooshes per column. */
export const AIR_SWOOSH_COUNT = 9;
/** Straight pieces per swoosh ribbon — enough that the spiral never shows a corner. */
export const AIR_SWOOSH_SEGMENTS = 28;
/** How fast a swoosh's head travels along the column (units/s), before its own pace. */
export const AIR_SWOOSH_SPEED = 5;
/** How many times a swoosh winds around the axis over the column's length. */
export const AIR_SWOOSH_TURNS = 0.55;
/** A swoosh's widest (units), just behind its head. */
export const AIR_SWOOSH_WIDTH = 0.09;
/** How much of the column one swoosh spans, before its own length share. */
export const AIR_SWOOSH_LENGTH = 0.32;
/** How far (units) a swoosh flares out, and droops back, over its last stretch — the cartoon curl. */
export const AIR_SWOOSH_CURL = 0.55;
/** Where along the column the curl starts. */
export const AIR_SWOOSH_CURL_FROM = 0.7;
/** A swoosh's opacity at full strength. */
export const AIR_SWOOSH_OPACITY = 0.85;
/** Where along the column a swoosh starts fading out, ending fully faded at the exit. */
export const AIR_SWOOSH_EXIT_FADE = 0.86;
/** Share of the column a swoosh takes to fade in past the entry. */
export const AIR_SWOOSH_ENTRY_FADE = 0.1;

/** Puffs per column. */
export const AIR_PUFF_COUNT = 16;
/** How fast a puff leaves the mouth (units/s), before its own pace; it slows as it rises. */
export const AIR_PUFF_SPEED = 1.6;
/** How much of the column a puff rises through before it is gone. */
export const AIR_PUFF_RISE = 0.42;
/** A puff's scale at full size, before its own size share and its growth. */
export const AIR_PUFF_SIZE = 0.34;
/** How many times a puff winds around the axis on its way up. */
export const AIR_PUFF_SWIRL = 0.35;
/** How far a puff's tint may go from the sky's lit cloud colour toward its shade. */
export const AIR_PUFF_TINT_SPREAD = 0.35;
/** Distinct puff shapes a column draws — one draw call each. */
export const AIR_PUFF_VARIANTS = 3;

/** One Volume's flow, drawn: where it enters, which way it runs, how far, how wide. */
export interface AirColumnFrame {
  /** Where the flow enters — the centre of the face the force points away from. */
  entry: Vec3;
  /** Unit vector along the Volume's `force`. */
  axis: Vec3;
  /** The bounds' support length along the axis. */
  length: number;
  /** Half the narrowest cross-section — how far from the axis the air spreads. */
  halfWidth: number;
}

/**
 * Frame a Volume's flow for drawing, or `null` when there is no flow to
 * draw — a zero-force Volume pushes nothing, so nothing should promise it.
 */
export const airColumnFrame = (volume: VolumeConfig): AirColumnFrame | null => {
  const speed = lengthVec3(volume.force);
  if (speed <= 0) return null;
  const axis = scaleVec3(volume.force, 1 / speed);
  // Into the bounds' own frame: a tilted Segment's box may carry a real
  // rotation (ADR 0034), and the support below only holds axis-aligned.
  const local = rotateVec3ByQuat(axis, conjugateQuat(volume.bounds.rotation ?? IDENTITY_QUAT));
  const { x: hx, y: hy, z: hz } = volume.bounds.halfExtents;
  const support = Math.abs(local.x) * hx + Math.abs(local.y) * hy + Math.abs(local.z) * hz;
  // The two axes the flow runs most across are the cross-section it fills;
  // the narrowest of the two binds how far the air spreads.
  const across = [
    { along: Math.abs(local.x), half: hx },
    { along: Math.abs(local.y), half: hy },
    { along: Math.abs(local.z), half: hz },
  ].sort((a, b) => a.along - b.along);
  return {
    entry: subVec3(volume.bounds.center, scaleVec3(axis, support)),
    axis,
    length: support * 2,
    halfWidth: Math.min(across[0]!.half, across[1]!.half),
  };
};

/** The two numbers of a frame the column-local maths reads. */
export type AirColumnSize = Pick<AirColumnFrame, "length" | "halfWidth">;

/**
 * A fixed pseudo-random share in [0, 1) for `(index, salt)` — the same
 * swoosh and puff every load, on every client.
 */
const hashShare = (index: number, salt: number): number => {
  const s = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
};

const fract = (x: number): number => x - Math.floor(x);

/** What sets one swoosh apart from its neighbours. */
export interface AirSwooshSeed {
  /** Where around the axis it starts (rad). */
  angle: number;
  /** How far out it rides, as a share of the column's width at each height. */
  radiusShare: number;
  /** Where in its loop it is at time zero. */
  phase: number;
  /** Its speed as a share of {@link AIR_SWOOSH_SPEED}. */
  pace: number;
  /** Its length as a share of {@link AIR_SWOOSH_LENGTH}. */
  lengthShare: number;
}

/** Swoosh `index`'s seed: spread evenly around the axis (golden-ratio steps), then jittered. */
export const airSwooshSeed = (index: number): AirSwooshSeed => ({
  angle: fract(index * 0.618034) * Math.PI * 2 + (hashShare(index, 1) - 0.5) * 0.4,
  radiusShare: 0.45 + 0.55 * hashShare(index, 2),
  phase: hashShare(index, 3),
  pace: 0.8 + 0.45 * hashShare(index, 4),
  lengthShare: 0.75 + 0.5 * hashShare(index, 5),
});

/** How much of the column `seed`'s swoosh spans, head to tail. */
export const airSwooshSpan = (seed: AirSwooshSeed): number => AIR_SWOOSH_LENGTH * seed.lengthShare;

/**
 * Where `seed`'s head is at `nowMs`, as a share of the column: it runs from
 * 0 (the entry) to `1 + span`, so the tail leaves the exit before the loop
 * starts over, with no jump anyone can see.
 */
export const airSwooshHead = (nowMs: number, seed: AirSwooshSeed, size: AirColumnSize): number => {
  const span = airSwooshSpan(seed);
  const cycleSeconds = ((1 + span) * size.length) / (AIR_SWOOSH_SPEED * seed.pace);
  return fract(nowMs / 1000 / cycleSeconds + seed.phase) * (1 + span);
};

/**
 * The point `t` of the way along the column (0 = entry, 1 = exit) on
 * `seed`'s spiral, in the column's frame. It widens from the mouth to the
 * full width, and past {@link AIR_SWOOSH_CURL_FROM} it flares out and droops
 * back: the curl. Writes into `out` when given one.
 */
export const airSwooshPoint = (
  t: number,
  seed: AirSwooshSeed,
  size: AirColumnSize,
  out: Vec3 = { x: 0, y: 0, z: 0 },
): Vec3 => {
  const along = Math.min(Math.max(t, 0), 1);
  const over = Math.max(0, t - AIR_SWOOSH_CURL_FROM) / (1 - AIR_SWOOSH_CURL_FROM);
  const mouth = AIR_MOUTH_SHARE * size.halfWidth;
  const radius =
    seed.radiusShare * (mouth + (size.halfWidth - mouth) * Math.pow(along, 0.7)) + AIR_SWOOSH_CURL * over * over;
  const angle = seed.angle + AIR_SWOOSH_TURNS * Math.PI * 2 * t;
  out.x = Math.cos(angle) * radius;
  out.y = t * size.length - AIR_SWOOSH_CURL * 0.6 * over * over * over;
  out.z = Math.sin(angle) * radius;
  return out;
};

/**
 * A swoosh's width `s` of the way from its head (0) to its tail (1): a
 * pointed head, widest just behind it, thinning to nothing at the tail.
 */
export const airSwooshWidth = (s: number): number =>
  AIR_SWOOSH_WIDTH * Math.pow(Math.max(0, 1 - s), 0.8) * smoothstep(0, 0.08, s);

/**
 * A swoosh's opacity at the point `t` of the way along the column. It is
 * nothing outside the column, fades in past the entry, and fades out before
 * the exit, so no swoosh ever pops in or out.
 */
export const airSwooshAlpha = (t: number): number =>
  AIR_SWOOSH_OPACITY * smoothstep(0, AIR_SWOOSH_ENTRY_FADE, t) * (1 - smoothstep(AIR_SWOOSH_EXIT_FADE, 1, t));

/** What sets one puff apart from its neighbours. */
export interface AirPuffSeed {
  /** Which of the {@link AIR_PUFF_VARIANTS} shapes it wears. */
  variant: number;
  /** Where around the axis it leaves (rad). */
  angle: number;
  /** How far out it rides, as a share of the width it has reached. */
  radiusShare: number;
  phase: number;
  /** Its speed as a share of {@link AIR_PUFF_SPEED}. */
  pace: number;
  /** Its size as a share of {@link AIR_PUFF_SIZE}. */
  size: number;
  /** How fast it turns about its own axis (rad/s). */
  spin: number;
  /** How far its colour goes toward the cloud shade, 0 to {@link AIR_PUFF_TINT_SPREAD}. */
  tint: number;
}

/** Puff `index`'s seed. Most puffs leave near the axis, and fewer ride near the walls. */
export const airPuffSeed = (index: number): AirPuffSeed => ({
  variant: index % AIR_PUFF_VARIANTS,
  angle: hashShare(100 + index, 1) * Math.PI * 2,
  radiusShare: 0.25 + 0.75 * Math.sqrt(hashShare(100 + index, 2)),
  phase: hashShare(100 + index, 3),
  pace: 0.75 + 0.5 * hashShare(100 + index, 4),
  size: 0.7 + 0.6 * hashShare(100 + index, 5),
  spin: (hashShare(100 + index, 6) - 0.5) * 2,
  tint: hashShare(100 + index, 7) * AIR_PUFF_TINT_SPREAD,
});

/** One puff, placed in the column's frame. */
export interface AirPuffPlacement {
  x: number;
  y: number;
  z: number;
  /** 0 hides it. */
  scale: number;
  /** Its turn about the column's axis (rad). */
  yaw: number;
}

/**
 * Where `seed`'s puff is at `nowMs`. It shoots out of the mouth and slows as
 * it rises, spiralling out toward the walls. Its scale pops in, grows, and
 * shrinks to nothing: a cartoon puff never fades, it goes by scale.
 */
export const airPuffPlacement = (nowMs: number, seed: AirPuffSeed, size: AirColumnSize): AirPuffPlacement => {
  const riseHeight = size.length * AIR_PUFF_RISE;
  const cycleSeconds = riseHeight / AIR_PUFF_SPEED;
  const u = fract((nowMs / 1000) * (seed.pace / cycleSeconds) + seed.phase);
  const rise = 1 - (1 - u) * (1 - u);
  const mouth = AIR_MOUTH_SHARE * size.halfWidth;
  const radius = seed.radiusShare * (mouth * (1 - u) + size.halfWidth * 0.8 * u);
  const angle = seed.angle + AIR_PUFF_SWIRL * rise * Math.PI * 2;
  return {
    x: Math.cos(angle) * radius,
    y: rise * riseHeight,
    z: Math.sin(angle) * radius,
    scale: AIR_PUFF_SIZE * seed.size * (0.55 + 0.9 * u) * smoothstep(0, 0.12, u) * (1 - smoothstep(0.55, 1, u)),
    yaw: seed.angle + (seed.spin * nowMs) / 1000,
  };
};
