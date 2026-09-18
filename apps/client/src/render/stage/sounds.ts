import {
  cloudFloorY,
  type BounceDeck,
  type ConveyorBelt,
  type EnvironmentPreset,
  type MovingSegmentConfig,
  type MudDeck,
  type RenderCharacter,
  type SpinnerConfig,
  type Vec3,
  type VolumeConfig,
} from "@dont-fall/shared";
import { localBounds } from "@dont-fall/render";
import type * as THREE from "three";
import { Ambience, environmentIdOf } from "../../audio/ambience.js";
import { CharacterSounds } from "../../audio/characterSounds.js";
import type { SoundEngine } from "../../audio/engine.js";
import { MachineSounds, SPRING_SETTLE_RATE } from "../../audio/machineSounds.js";
import { fallWhistleY } from "../../audio/movementCues.js";
import { SegmentSounds } from "../../audio/segmentSounds.js";
import type { BounceLanding } from "../bounceSheets.js";
import { footstepSound, type FootSurface, type SteppingClip } from "../footsteps.js";
import { createDeckFooting, type IceFootingQuery } from "../iceFooting.js";
import { springFiredBy, type SpringTrigger } from "../springSquash.js";

/** What the Stage's sounds are placed by. */
export interface StageSoundsWorld {
  environment: EnvironmentPreset;
  killPlaneY: number;
  lowestSegmentY: number;
  movingSegments: MovingSegmentConfig[];
  /** The drawn group of each Moving Segment, in `movingSegments` order — its shape at rest is where it is heard from. */
  movingGroups: readonly THREE.Object3D[];
  spinners: SpinnerConfig[];
  springs: SpringTrigger[];
  volumes: VolumeConfig[];
  conveyors: ConveyorBelt[];
  mudDecks: MudDeck[];
  bounceDecks: BounceDeck[];
  /** Where a deck's footing frame hangs — the Track's own `deckParent`. */
  deckParent: (movingIndex: number | null) => THREE.Object3D;
  onIce: IceFootingQuery;
}

/** Every sound the Stage makes of what it draws (ADR 0087). Silent throughout without an engine. */
export interface StageSounds {
  /** One foot down: your own unpanned, anyone else's where they stand (M14 ticket 04). */
  footstep: (clip: SteppingClip, centre: Vec3, remote: boolean) => void;
  /** Getting around and fighting (M14 tickets 05, 06), with this frame's bounce landings. */
  characters: (
    characters: Record<string, RenderCharacter>,
    localId: string,
    nowMs: number,
    landings: readonly BounceLanding[],
  ) => void;
  /** Moving pieces, fans, air columns and belts at tick `t`, heard from `listener` (M14 tickets 07, 08). */
  motion: (t: number, listener: THREE.Vector3) => void;
  /** The Environment's ambience, its wind swelling over the cloud floor (M14 ticket 09). */
  ambience: (listenerY: number) => void;
  /** A Spring back at rest settles audibly (M14 ticket 08); its launch was the boing. */
  springSettled: (spring: SpringTrigger) => void;
  /** Stop everything this Stage started. The engine itself is the Stage's to dispose. */
  dispose: () => void;
}

/**
 * Builds the Stage's sounds, after the local Character joins the scene and
 * before any remote rig can step. The mud and bounce footing are built even
 * without an engine: they are frames in the scene, and a Stage's scene does
 * not depend on whether it can make a sound.
 */
export const createStageSounds = (sound: SoundEngine | null, world: StageSoundsWorld): StageSounds => {
  // Footsteps (M14 ticket 04): what a foot lands on, from the same sheeted
  // decks the Stage draws, parented the same way.
  const onMud = createDeckFooting(world.mudDecks, world.movingSegments, world.deckParent);
  const onBounce = createDeckFooting(world.bounceDecks, world.movingSegments, world.deckParent);
  const footSurface = (centre: Vec3): FootSurface =>
    onBounce(centre) ? "bounce" : onMud(centre) ? "mud" : world.onIce(centre) ? "ice" : "deck";

  // What Characters make heard (M14 tickets 05, 06): the same decks answer
  // what a jump left from, and the Springs where a launch is heard.
  const characterSounds = sound
    ? new CharacterSounds(sound, {
        onBounce,
        springAt: (centre) => springFiredBy(centre, world.springs)?.trigger.center,
        fallY: fallWhistleY(world.lowestSegmentY, world.killPlaneY),
      })
    : null;
  // Moving pieces (M14 ticket 07), heard from their drawn shape at rest.
  const segmentSounds = sound
    ? new SegmentSounds(
        sound,
        world.movingSegments.map((config, i) => {
          const bounds = localBounds(world.movingGroups[i]!);
          const corners = bounds.isEmpty()
            ? []
            : [0, 1, 2, 3, 4, 5, 6, 7].map((c) => ({
                x: c & 1 ? bounds.max.x : bounds.min.x,
                y: c & 2 ? bounds.max.y : bounds.min.y,
                z: c & 4 ? bounds.max.z : bounds.min.z,
              }));
          return { config, corners };
        }),
        world.spinners,
      )
    : null;
  // The Environment's ambience (M14 ticket 09), its wind swelling over the cloud floor.
  const ambience = sound
    ? new Ambience(sound, environmentIdOf(world.environment), cloudFloorY(world.environment, world.killPlaneY, world.lowestSegmentY))
    : null;
  // Fans, air columns and belts (M14 ticket 08).
  const machineSounds = sound
    ? new MachineSounds(sound, { volumes: world.volumes, conveyors: world.conveyors, movingSegments: world.movingSegments })
    : null;

  return {
    footstep: (clip, centre, remote) => {
      const { slot, gain, rate } = footstepSound(clip, footSurface(centre), remote);
      sound?.play(slot, remote ? { at: centre, gain, rate } : { gain, rate });
    },
    characters: (characters, localId, nowMs, landings) => characterSounds?.update(characters, localId, nowMs, landings),
    motion: (t, listener) => {
      segmentSounds?.update(t, listener);
      machineSounds?.update(t, listener);
    },
    ambience: (listenerY) => ambience?.update(listenerY),
    springSettled: (spring) => sound?.play("segment.spring_settle", { at: spring.trigger.center, rate: SPRING_SETTLE_RATE }),
    dispose: () => {
      characterSounds?.dispose();
      segmentSounds?.dispose();
      machineSounds?.dispose();
    },
  };
};
