/**
 * Where a voice is heard from in a Round (ADR 0111): at its speaker's
 * Character, and **never silenced**.
 *
 * That last part is the whole design. A voice is not an ambience to be culled
 * when it gets far away — somebody is saying something to you — so the
 * distance falloff stops at a floor rather than reaching zero. A bean across
 * the Track is quiet and perfectly audible; one beside you is at full volume.
 *
 * Pure, and free of both Web Audio and three.js: the Stage hands down where
 * the camera is and which way it looks, and this turns that into the two
 * numbers a speaker's chain applies.
 */
import { VOICE_FAR_DISTANCE, VOICE_FAR_GAIN, VOICE_REF_DISTANCE, type Vec3 } from "@dont-fall/shared";
import { FLAT, type VoicePlacement } from "./playback.js";

/**
 * How loud a voice `distance` metres away is, as a share of its close volume.
 * Full inside {@link VOICE_REF_DISTANCE} — about the range a Bump happens in,
 * so the Player shoving you is never quieter than the one across the arena —
 * then straight down to {@link VOICE_FAR_GAIN} and flat from there.
 */
export const voiceDistanceGain = (distance: number): number => {
  if (distance <= VOICE_REF_DISTANCE) return 1;
  if (distance >= VOICE_FAR_DISTANCE) return VOICE_FAR_GAIN;
  const across = (distance - VOICE_REF_DISTANCE) / (VOICE_FAR_DISTANCE - VOICE_REF_DISTANCE);
  return 1 - across * (1 - VOICE_FAR_GAIN);
};

/**
 * Where the Player is hearing from: the camera's position and the direction
 * it looks. The sound engine's own listener rides the camera too (ADR 0087),
 * so voice and the world agree about which way is left.
 */
export interface VoiceListener {
  position: Vec3;
  /** World-space, and not required to be unit length or level — it is normalised here. */
  forward: Vec3;
}

/**
 * Where one speaker sits for the listener. Left–right only: a voice above or
 * below you is not somewhere a pair of speakers can put it, and pretending
 * otherwise with height would only smear the direction that does work.
 */
export const voicePlacementFor = (listener: VoiceListener, speaker: Vec3): VoicePlacement => {
  const toX = speaker.x - listener.position.x;
  const toY = speaker.y - listener.position.y;
  const toZ = speaker.z - listener.position.z;
  const distance = Math.hypot(toX, toY, toZ);
  const gain = voiceDistanceGain(distance);
  // Standing on top of someone has no direction to give, and normalising it
  // would divide by nothing.
  if (distance < 1e-4) return { gain, pan: 0 };

  // The listener's right, on the level: `forward × up` with up = +Y, which on
  // three.js's right-handed Y-up axes comes out as (−forward.z, 0, forward.x)
  // — so a camera looking down −Z has +X on its right hand. Deliberately
  // level: looking down at your feet must not swap your ears.
  const rightX = -listener.forward.z;
  const rightZ = listener.forward.x;
  const rightLength = Math.hypot(rightX, rightZ);
  // Looking straight up or down leaves no level direction at all; the last
  // frame's pan would be as good a guess as any, and centre is the honest one.
  if (rightLength < 1e-4) return { gain, pan: 0 };

  // Against the *level* distance, not the full one: how far away someone is
  // decides how loud they are and nothing else. Dividing by the full distance
  // would pull a bean on the gantry above you toward the middle no matter how
  // far to one side they actually stood.
  const levelDistance = Math.hypot(toX, toZ);
  if (levelDistance < 1e-4) return { gain, pan: 0 };

  const pan = (toX * rightX + toZ * rightZ) / (rightLength * levelDistance);
  return { gain, pan: Math.max(-1, Math.min(1, pan)) };
};

/**
 * Everyone the Round can place, by the Account behind their Character — what
 * the game raises once a frame through its `GameConfig` sink.
 *
 * A speaker who is not in `speakers` is heard flat: a spectator, an
 * eliminated Player, or anyone on a Screen, none of whom have a Character to
 * be placed at.
 */
export interface VoiceScene {
  listener: VoiceListener;
  speakers: ReadonlyMap<string, Vec3>;
}

/** Where this Account is heard from in this scene — flat when the scene has no Character for them. */
export const placementInScene = (scene: VoiceScene, accountId: string): VoicePlacement => {
  const at = scene.speakers.get(accountId);
  return at === undefined ? FLAT : voicePlacementFor(scene.listener, at);
};
