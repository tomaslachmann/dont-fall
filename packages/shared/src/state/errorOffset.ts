/**
 * Shared render-time error-offset decay (ADR 0022 / ADR 0026). Both the pushed-
 * Prop offset (`apps/client/src/propPrediction.ts`) and the predicted
 * Character's own correction offset are the same idea: the sim always snaps
 * to the authoritative state; only the *rendered* position carries a residual
 * that eases toward zero (Glenn Fiedler, "State Synchronization"). Props blend
 * their half-life from the error's own magnitude; the Character uses one fixed
 * half-life — this helper takes `halfLifeMs` explicit so either caller can
 * supply it.
 */

import { lengthVec3, scaleVec3, type Vec3 } from "../math/vec3.js";

const ZERO: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * Decay a position error offset one render frame toward zero:
 * `retain = 0.5^(dtMs / halfLifeMs)`. Past `hardSnapM` the offset is dropped
 * outright — that far apart is a genuine desync, not something to rubber-band
 * across. Below `flatEpsilonM` (default 0, i.e. never) it is floored to zero
 * instead of fading forever at diminishing, invisible fractions.
 */
export const decayPositionOffset = (
  offset: Vec3,
  dtMs: number,
  halfLifeMs: number,
  hardSnapM: number,
  flatEpsilonM = 0,
): Vec3 => {
  const mag = lengthVec3(offset);
  if (mag > hardSnapM || mag < flatEpsilonM) return { ...ZERO };
  return scaleVec3(offset, Math.pow(0.5, dtMs / halfLifeMs));
};
