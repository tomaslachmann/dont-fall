const TAU = Math.PI * 2;

/**
 * Interpolates between two angles (radians) by the shortest arc — crossing
 * the +/-PI seam directly rather than spinning the long way around it, unlike
 * a plain `lerp` on the raw numbers. Used for a Character's replicated
 * `facing` (M6, ADR 0045), which wraps every full turn.
 */
export const lerpAngle = (a: number, b: number, t: number): number => {
  let diff = (b - a) % TAU;
  if (diff > Math.PI) diff -= TAU;
  if (diff < -Math.PI) diff += TAU;
  return a + diff * t;
};

/** Wraps an angle (radians) into (−π, π], so a turn toward it always takes the shortest arc. */
export const wrapAngle = (angle: number): number => {
  const wrapped = ((((angle + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
  return wrapped === -Math.PI ? Math.PI : wrapped;
};
