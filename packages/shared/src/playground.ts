import type { Box } from "./math/box.js";
import type { Vec3 } from "./math/vec3.js";
import type { Checkpoint } from "./simulation/Checkpoint.js";
import type { PropConfig } from "./simulation/Prop.js";
import type { SpinnerConfig } from "./simulation/Spinner.js";
import { M1_MODULES, M1_TRACK } from "./track/modules.js";
import type { SurfaceId } from "./track/Surface.js";
import { resolveTrack } from "./track/Track.js";

/**
 * The M1 playground, resolved from the Module/Track system (`./track/`) —
 * ticket 01 of M3 (`docs/milestones/M3.md`) replaced the hand-authored
 * world-space arrays that used to live here with reusable Modules chained
 * into a Track.
 *
 * A test fixture, not production API (M4.5 ticket 05): every real Track,
 * including M1's own, now comes from `resolveTrack` directly — nothing in
 * `RapierSimulation`, the client scene, or the Match server imports this
 * file any more. Kept for tests that want a known, stable world without
 * publishing/track-service (a real Track's geometry) or hand-rolling a
 * minimal one — not re-exported from the package's main index, so a cross-
 * package test imports it by its own subpath (`@dont-fall/shared/playground.js`).
 */
const resolved = resolveTrack(M1_MODULES, M1_TRACK);

export const PLAYGROUND_STATICS: Box[] = resolved.statics;
/** Index-aligned with {@link PLAYGROUND_STATICS} (ADR 0036) — see `resolveTrack`'s `staticSurfaces`. */
export const PLAYGROUND_STATIC_SURFACES: SurfaceId[] = resolved.staticSurfaces;
export const PLAYGROUND_SPINNERS: SpinnerConfig[] = resolved.spinners;
export const PLAYGROUND_PROPS: PropConfig[] = resolved.props;
export const PLAYGROUND_CHECKPOINTS: Checkpoint[] = resolved.checkpoints;

export const PLAYGROUND_SPAWN: Vec3 = { x: 0, y: 1.2, z: 10.5 };

/**
 * Per-player spawn point on the start platform (M2 ticket 04): players are
 * solid to each other now, so two joining at the same spot would spawn
 * interpenetrating. Laid out as a grid across the platform (clear of the
 * x = -3.2 wall), wrapping after 12 — the ADR 0011 player ceiling.
 */
export const playgroundSpawn = (index: number): Vec3 => {
  const slot = ((index % 12) + 12) % 12;
  const col = slot % 4; // 4 across
  const row = Math.floor(slot / 4); // up to 3 back
  return { x: -1.8 + col * 1.2, y: PLAYGROUND_SPAWN.y, z: PLAYGROUND_SPAWN.z - row * 1.5 };
};
