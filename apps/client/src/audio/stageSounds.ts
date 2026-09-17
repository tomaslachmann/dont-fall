import type { EnvironmentId, MovingSegmentConfig, VolumeConfig } from "@dont-fall/shared";
import { ambienceSlots } from "./ambience.js";
import { machineSoundSlots } from "./machineSounds.js";
import { segmentSoundSlots } from "./segmentSounds.js";
import { STAGE_SOUND_SLOTS, type SoundSlot } from "./slots.js";

/** The parts of a resolved Track its sounds depend on. */
export interface SoundedTrack {
  movingSegments: readonly Pick<MovingSegmentConfig, "moduleId" | "motion">[];
  spinners: readonly unknown[];
  volumes: readonly VolumeConfig[];
  conveyors: readonly unknown[];
  launchPads: readonly unknown[];
  /** The Revision's Environment, whose ambience plays under the Round. */
  environment?: EnvironmentId;
}

/**
 * Every slot a Stage decodes for `track` (ADR 0087): what every Character
 * makes, plus only the sounds of what this Track places, the same rule as
 * its Assets (ADR 0080).
 */
export const stageSoundSlots = (track: SoundedTrack): SoundSlot[] => [
  ...new Set([
    ...STAGE_SOUND_SLOTS,
    ...segmentSoundSlots(track.movingSegments, track.spinners),
    ...machineSoundSlots(track),
    ...ambienceSlots(track.environment),
  ]),
];
