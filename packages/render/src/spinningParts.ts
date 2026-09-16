import * as THREE from "three";

/**
 * Parts of an Asset that turn on their own, like a fan's rotor (ADR 0075,
 * amended 2026-09-16). An Asset marks such a node with `extras.spin`, in
 * rad/s about the node's own +Y. `GLTFLoader` puts extras on `userData`, and
 * a `clone` copies them, so every placed instance carries the mark. The
 * shared reader never looks at it: a spinning part is always visual, never
 * collision.
 *
 * A spinning node is authored with no rotation of its own (the fan
 * converter guarantees this), so its rotation *is* its spin. Turning is
 * absolute on the wall clock: nothing drifts, and like the clouds it tells
 * the player nothing about sim time.
 */

/** Frozen for `prefers-reduced-motion`: the rotor still reads as a rotor. */
const REDUCED_MOTION =
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The rad/s `object` is marked to spin at, or `null` when it isn't marked. */
export const spinRate = (object: THREE.Object3D): number | null => {
  const spin: unknown = object.userData.spin;
  return typeof spin === "number" && Number.isFinite(spin) && spin !== 0 ? spin : null;
};

/** Every node under `root` (itself included) an Asset marked to spin. */
export const findSpinningParts = (root: THREE.Object3D): THREE.Object3D[] => {
  const parts: THREE.Object3D[] = [];
  root.traverse((object) => {
    if (spinRate(object) !== null) parts.push(object);
  });
  return parts;
};

/** Turns each of `parts` to where it is `nowMs` into the wall clock. */
export const spinParts = (parts: readonly THREE.Object3D[], nowMs: number): void => {
  const seconds = REDUCED_MOTION ? 0 : nowMs / 1000;
  for (const part of parts) {
    const rate = spinRate(part);
    if (rate === null) continue;
    // Wrapped, so the angle stays small however long the session runs.
    part.rotation.set(0, (rate * seconds) % (Math.PI * 2), 0);
  }
};
