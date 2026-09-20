import {
  DEFAULT_KILL_PLANE_Y,
  ENVIRONMENT_PRESETS,
  RapierSimulation,
  resolveTrack,
  trackSpawnYaw,
  type Vec3,
} from "@dont-fall/shared";
import { loadSoundBank } from "../audio/soundBank.js";
import { stageSoundSlots } from "../audio/stageSounds.js";
import { applyAudioVolumes, type AudioVolumes } from "../lib/audioSettings.js";
import type { GraphicsSettings } from "../lib/graphicsQuality.js";
import { FreeLookCamera } from "../input/input.js";
import { assetPlacements } from "../render/assetVisuals.js";
import type { CharacterModel } from "../render/characterModel.js";
import { createStage, type Stage } from "../render/scene.js";
import { springTriggers } from "../render/springSquash.js";
import type { TrackLoading } from "./trackLoading.js";

/**
 * Building the world for one Track — the Stage that draws it, the simulation
 * that predicts against it, and the camera bound to the Stage's own canvas.
 *
 * One function for both the boot build and a live Track swap (M4 ticket 07,
 * the client's mirror of the server's `buildSimulationFor`). They were two
 * near-identical forty-line blocks before, which is how a Track property added
 * to one could be missed in the other.
 */

/** Everything that does not change when the Track does. */
export interface WorldDeps {
  mount: HTMLElement;
  graphics: GraphicsSettings;
  characterModel: CharacterModel;
  loading: TrackLoading;
  audioContext: AudioContext | null;
  /** This device's current volumes (ADR 0087), read at build time so a swap keeps them. */
  volumes: () => AudioVolumes;
  /** The local Character's id — the one Character this simulation actually holds. */
  myId: string;
}

/** Which Revision to build. Named, because getting the pair out of step draws a world the server is not simulating. */
export interface TrackRef {
  trackId: string;
  trackRevision: number;
}

export interface BuiltWorld {
  stage: Stage;
  localSim: RapierSimulation;
  look: FreeLookCamera;
  /** How many Checkpoints this Track has — the Race HUD's pips (ADR 0088). */
  checkpointCount: number;
}

export const buildWorld = async (deps: WorldDeps, ref: TrackRef, spawn: Vec3): Promise<BuiltWorld> => {
  const { track, environment } = await deps.loading.fetchTrack(ref.trackId, ref.trackRevision);
  const library = await deps.loading.loadLibrary(track);
  const resolved = resolveTrack(library, track);
  // Decoded files are shared with any bank already loaded: only this Track's
  // new sounds are fetched (ADR 0087).
  const sounds = deps.audioContext
    ? await loadSoundBank(deps.audioContext, stageSoundSlots({ ...resolved, environment }))
    : undefined;

  const stage = createStage({
    mount: deps.mount,
    graphics: deps.graphics,
    statics: resolved.statics,
    checkpoints: resolved.checkpoints,
    finishZones: resolved.finishZones,
    killPlaneY: DEFAULT_KILL_PLANE_Y,
    // The Revision's own Environment (ADR 0074) — render-only, never sent to the server.
    environment: ENVIRONMENT_PRESETS[environment],
    spinners: resolved.spinners,
    props: resolved.props,
    characterModel: deps.characterModel,
    // Templates are session-cached per id, so only Assets this Track adds are
    // fetched (memory-footprint ticket 01); a disposed Stage freed its own
    // clones with its scene-graph sweep, and the new one clones afresh.
    assetTemplates: await deps.loading.loadVisualTemplates(track),
    assetPlacements: assetPlacements(track, library),
    segmentColors: track.map((segment) => segment.color),
    springs: springTriggers(resolved.launchPads, resolved.launchPadOwners),
    movingSegments: resolved.movingSegments,
    conveyors: resolved.conveyors,
    iceDecks: resolved.iceDecks,
    mudDecks: resolved.mudDecks,
    bounceDecks: resolved.bounceDecks,
    bounceTexture: await deps.loading.loadBounceTexture(),
    volumes: resolved.volumes,
    sounds,
  });
  applyAudioVolumes(stage.sound, deps.volumes());

  const look = new FreeLookCamera(stage.domElement);
  // Start looking along the Start's forward (ADR 0068).
  look.yaw = trackSpawnYaw(track) ?? look.yaw;

  // The local Character is predicted by re-running the exact same shared
  // simulation step the server uses (ticket 03), seeded from the same resolved
  // Track the Stage above was built from.
  const localSim = new RapierSimulation({
    statics: resolved.statics,
    staticSurfaces: resolved.staticSurfaces,
    staticConveyors: resolved.staticConveyors,
    staticTrimeshes: resolved.staticTrimeshes,
    checkpoints: resolved.checkpoints,
    // Qualification is predicted locally (ADR 0039: a pure function of
    // position), so the input lock lands on the same Tick here as on the
    // server instead of half an RTT past the finish. A wrong prediction is
    // corrected — `reconcileCharacter` takes the server's `finishTick`.
    finishZones: resolved.finishZones,
    spinners: resolved.spinners,
    movingSegments: resolved.movingSegments,
    props: resolved.props,
    launchPads: resolved.launchPads,
    volumes: resolved.volumes,
    withDefaultCharacter: false,
    // Never trust this Character's own settle-check to end a knockdown — only
    // a server snapshot can (ADR 0015), which makes `reconcile`'s down-state
    // sync safe to apply unconditionally.
    authoritative: false,
  });
  // Seeded at the exact spawn the server used (the per-player spawn grid,
  // ticket 04) — reconcile deliberately never corrects position, so prediction
  // must start already aligned.
  localSim.addCharacter(deps.myId, spawn);

  // First-sight compiles and uploads happen now, behind the load, rather than
  // in the Round's first metres (M13 ticket 06).
  stage.warmUp();
  return { stage, localSim, look, checkpointCount: resolved.checkpoints.length };
};
