import type { EnvironmentPreset } from "@dont-fall/shared";

/**
 * How far past the fog's opaque distance a fogged camera still draws (M13
 * ticket 04): enough that a piece straddling the fog line is not cut on it.
 */
export const FOG_FAR_PLANE_MARGIN = 20;

/**
 * The far plane for a camera drawing `preset` with its fog on. Past the fog's
 * far distance everything is solid fog colour, so drawing it costs frames and
 * shows nothing; the frustum test that already skips what is behind the camera
 * now skips that too.
 */
export const fogFarPlane = (preset: EnvironmentPreset): number => preset.fog.far + FOG_FAR_PLANE_MARGIN;
