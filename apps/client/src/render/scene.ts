import {
  byVolumePriority,
  holdsAloft,
  volumeAt,
  type BounceDeck,
  type Checkpoint,
  type ConveyorBelt,
  type EnvironmentPreset,
  type FinishZone,
  type IceDeck,
  type MovingSegmentConfig,
  type MudDeck,
  type OrientedBox,
  type PropConfig,
  type PropSnapshot,
  type RenderCharacter,
  type SpinnerConfig,
  type Vec3,
  type VolumeConfig,
} from "@dont-fall/shared";
import { createEnvironment, fogFarPlane } from "@dont-fall/render";
import * as THREE from "three";
import { createSoundEngine, type SoundEngine } from "../audio/engine.js";
import type { SoundBank } from "../audio/soundBank.js";
import {
  DEFAULT_GRAPHICS_QUALITY,
  GRAPHICS_QUALITY_SETTINGS,
  type GraphicsSettings,
} from "../lib/graphicsQuality.js";
import { listen } from "../lib/socket/listeners.js";
import type { AssetVisualPlacement } from "./assetVisuals.js";
import type { BounceLanding } from "./bounceSheets.js";
import type { CharacterModel } from "./characterModel.js";
import type { LocalHold } from "./grabAnimation.js";
import { disposeSceneGraph } from "./disposeSceneGraph.js";
import type { SteppingClip } from "./footsteps.js";
import { createWardrobe } from "./hats.js";
import { createRemoteCharacterPool } from "./remoteCharacterPool.js";
import { setShadowRole } from "./shadowRoles.js";
import { createSkinCloset } from "./skins.js";
import { createSpeedLines } from "./speedLines.js";
import type { SpringTrigger } from "./springSquash.js";
import { browserStorage } from "../lib/browserStorage.js";
import { readGameplaySettings, subscribeGameplaySettings } from "../lib/gameplaySettings.js";
import { CameraShake, SCREEN_SHAKE_SCALE, ShakeCues } from "./cameraShake.js";
import { createNameplates, type NameplateEntry } from "./nameplates.js";
import { createCameraRig } from "./stage/cameraRig.js";
import { createLocalCharacter } from "./stage/localCharacter.js";
import { createStageSounds } from "./stage/sounds.js";
import { buildTrackVisuals } from "./stage/trackVisuals.js";
import { warmUpStage } from "./warmUp.js";

export interface StageConfig {
  /**
   * How the frame is drawn (ADR 0079): pixel ratio cap, composer samples,
   * the sun's shadow map and the cloud puffs. Defaults to `high`, the look
   * M12 shipped. Render-only, like everything here.
   */
  graphics?: GraphicsSettings;
  /**
   * Element the renderer's canvas is appended to. The game owns the canvas
   * for exactly as long as it runs and removes it again on `dispose`
   * (M4 ticket 01) — the shell around it (`<GameCanvas>`, ADR 0008) owns the
   * element it goes into.
   */
  mount: HTMLElement;
  statics: OrientedBox[];
  checkpoints: Checkpoint[];
  /** Finish Zones to draw (M4 ticket 02) — the Race has to be visible to be run at. */
  finishZones: FinishZone[];
  killPlaneY: number;
  /**
   * The sky, fog and light this Round is drawn inside (ADR 0074). Render-only:
   * the simulation never sees it.
   */
  environment: EnvironmentPreset;
  spinners: SpinnerConfig[];
  props: PropConfig[];
  characterModel: CharacterModel;
  /**
   * Asset visual templates by Module id, plus one placement per asset Segment
   * (M8 ticket 03, ADR 0050) — the eye's half of asset Modules. The collision
   * half is baked into trimeshes by `resolveTrack` for the sim; the two share
   * the Segment's own origin/transform (see `assetPlacements`), never separate
   * positioning code. Empty on procedural-only Tracks.
   */
  assetTemplates?: Record<string, THREE.Group>;
  assetPlacements?: AssetVisualPlacement[];
  /**
   * Every Spring on the Track (ADR 0069), with the Segment each fires for —
   * `resolveTrack`'s `launchPads`/`launchPadOwners`, which the game pairs up.
   * Renderer-only: the squash is cosmetic and the collision never moves.
   */
  springs?: SpringTrigger[];
  /**
   * Segments with a Motion (ADR 0061) — drawn as one group each, in their
   * own local frame, and posed by {@link Stage.updateMotion} from the same
   * pure function the simulation poses their body with.
   */
  movingSegments?: MovingSegmentConfig[];
  /**
   * Attached belts to draw (ADR 0064) — one marching chevron strip per belt
   * (`conveyorBelts.ts`), parented under the Moving Segment's own group when
   * the belt rides one. Empty on Tracks without Conveyors.
   */
  conveyors?: ConveyorBelt[];
  /**
   * Ice-surfaced decks (ADR 0066, drawn per ADR 0107) — one opaque pastel
   * slab per deck (`iceOverlays.ts`), parented under the Moving Segment's own
   * group when the slab rides one, built from geometry and a generated
   * detail texture alone. Empty on Tracks without ice.
   */
  iceDecks?: IceDeck[];
  /**
   * Mud-surfaced decks (ADR 0067/0103) — one lumpy mass per deck
   * (`mudOverlays.ts`), same parenting as the ice sheets above, built from
   * geometry alone. Empty on Tracks without mud.
   */
  mudDecks?: MudDeck[];
  /** Bouncy decks (ADR 0070) — each wears an inflatable sheet that dents under whoever is on it. */
  bounceDecks?: BounceDeck[];
  /** The shared bounce texture, or null when it could not be loaded (see `bounceDecks`). */
  bounceTexture?: THREE.Texture | null;
  /**
   * Volumes to draw (ADR 0075). Each is cartoon air along its force,
   * swooshes plus puffs in the sky's cloud style (`airColumns.ts`), so an
   * updraft reads as moving air instead of empty space. Empty on Tracks
   * without Volumes.
   */
  volumes?: VolumeConfig[];
  /**
   * The decoded sounds this Stage plays (ADR 0087). Absent, the Stage is
   * silent and builds no audio graph at all (a browser without Web Audio, or a test).
   */
  sounds?: SoundBank | undefined;
}

/**
 * What `applyRenderState` needs for the one Character this Stage renders —
 * the caller picks it out of `RenderState.characters` (a collection since
 * ticket 01; the Stage itself stays single-Character until ticket 04 adds
 * rendering for other players).
 */
export interface StageRenderState {
  character: RenderCharacter;
  props: PropSnapshot[];
}

/** What the renderer drew in the last `render()` and holds on the GPU (M13 ticket 01). */
export interface StageRenderStats {
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
}

export interface Stage {
  domElement: HTMLCanvasElement;
  render: () => void;
  /**
   * Copy `renderer.info` for the last `render()` — every pass of it, shadow
   * map and composer included — into `into` (M13 ticket 01's overlay).
   */
  readRenderStats: (into: StageRenderStats) => void;
  /**
   * Compile every program and upload every geometry and texture now, so the
   * Round never pays for them the first time something comes into view (M13
   * ticket 06). Call it once before the first `render()`; see `warmUpStage`.
   */
  warmUp: () => void;
  /** Place the local player's Character mesh from an interpolated snapshot. Presentation only (ADR 0009). */
  applyRenderState: (state: StageRenderState) => void;
  /**
   * Place and animate every OTHER player's Character (M2 ticket 04, real
   * model since M6 ticket 02 / ADR 0046), keyed by session ID and
   * interpolated from server snapshots — never predicted (ADR 0003). Rigs
   * are pooled per ID (one real, tinted clone of the shared model each) and
   * torn down when an ID drops out of the set (a disconnect). `deltaSeconds`
   * advances each rig's own `AnimationMixer`, exactly like the local
   * Character's own `updateCharacterAnimation`.
   * `localId`/`localPosition` (M6.1) let a remote rig's own arm-reach pose
   * target the LOCAL player when it's the one being grabbed — see
   * `RemoteCharacterPool.apply`.
   */
  applyRemoteCharacters: (
    characters: Record<string, RenderCharacter>,
    deltaSeconds: number,
    localId: string,
    localPosition: Vec3,
  ) => void;
  /**
   * Refresh equipped body colors by session id (M9 ticket 15) — the game
   * calls this off every snapshot's lobby roster, before
   * `applyRemoteCharacters`, so a rig built this frame already wears its
   * color. See `RemoteCharacterPool.setColors` for the re-dress rules.
   */
  setPlayerColors: (colors: ReadonlyMap<string, number | null>) => void;
  /**
   * Refresh equipped skins by session id (ADR 0091), off the same roster and
   * at the same point as `setPlayerColors`. A skin paints over the color.
   */
  setPlayerSkins: (skins: ReadonlyMap<string, string | null>) => void;
  /**
   * Dress the local Character's own model (M9 ticket 15, ADR 0091) — its
   * equipped `skin`, or its `color` when it has none. `null` for either
   * (unknown — the own row's `auth` hasn't resolved yet, or the API was
   * unreachable at practice boot) means no skin and the default color.
   * Only a change reaches the rig, so calling this every snapshot stays
   * free.
   */
  setLocalLook: (color: number | null, skin: string | null) => void;
  /**
   * Refresh equipped hats by session id (ADR 0083), off the same roster and
   * at the same point as `setPlayerColors`. Only a change dresses a rig, so
   * calling this every snapshot stays free.
   */
  setPlayerHats: (hats: ReadonlyMap<string, string | null>) => void;
  /** Put a hat on the local Character, or take it off for `null`. Free to repeat. */
  setLocalHat: (hat: string | null) => void;
  /**
   * Squash whichever Spring just fired (ADR 0069), from the Characters'
   * `launchPadEpoch`. Cosmetic and render-rate driven like every other
   * one-shot overlay; the local Character's own squash runs at prediction
   * time, a round trip before the server confirms the launch.
   */
  applySpringSquash: (characters: Record<string, RenderCharacter>, nowMs: number) => void;
  /**
   * Reshape every bounce sheet (ADR 0070) from the Characters on it — the
   * dent under each one, and the ring left by a landing. Derived entirely
   * from replicated position/velocity/grounded, so it costs the protocol
   * nothing and a remote Character dents a sheet exactly like the local one.
   */
  applyBounceSheets: (characters: Record<string, RenderCharacter>, nowMs: number) => void;
  /**
   * The sounds every Character makes (ADR 0087): getting around (M14 ticket
   * 05) and fighting (ticket 06). Called once a frame after
   * {@link applyBounceSheets}, whose landings it reads, with the same
   * Characters. `localId` is your own: its sounds are unpanned, its fighting
   * outranks anyone else's, and only it whistles as it falls.
   */
  applyCharacterSounds: (characters: Record<string, RenderCharacter>, localId: string, nowMs: number) => void;
  /**
   * Screen shake on impact (ADR 0110): your own Character this frame, as it
   * is heard — its knockdowns, Hits taken, bumps and hard landings jolt the
   * camera at the Player's setting. The next {@link updateCamera} shows it.
   */
  applyShake: (own: RenderCharacter, localId: string, nowMs: number) => void;
  /**
   * Who each remote Character is, for the nameplates over their heads (ADR
   * 0110) — set every frame from the roster, like the colours. Drawn by
   * {@link updateCamera}, at the Player's setting.
   */
  setPlayerNames: (names: ReadonlyMap<string, string>) => void;
  /**
   * Advance every air column's swooshes and puffs to `nowMs` (ADR 0075),
   * render-rate driven like every other overlay. The swooshes face the
   * Stage's camera as it stood at its last update.
   */
  updateAirColumns: (nowMs: number) => void;
  /**
   * Position the camera on a collision-resolved spring arm around `target`.
   * The arm's length eases toward what the probe allows over `deltaSeconds`
   * rather than jumping to it (ADR 0086).
   */
  updateCamera: (target: Vec3, yaw: number, pitch: number, deltaSeconds: number) => void;
  /**
   * Pose every Spinner and Moving Segment (ADR 0061) at continuous simulation tick `t`
   * (fractional for smooth render-rate rotation). A Spinner's rotation is a
   * pure function of the tick, so it is never carried in `RenderState`.
   */
  updateMotion: (t: number) => void;
  /**
   * Advance the Character model's animation and turn it to face
   * `moveDirection` (world-space, zero when idle). Purely cosmetic and
   * render-rate driven (ADR 0004) — `moveDirection`/`grounded`/`dashing`/
   * `dashSpeed` are read straight from input/the latest snapshot, never fed
   * back into the sim. `dashSpeed` (0 when not dashing) drives the
   * speed-lines effect directly — a simulation-owned value, not derived from
   * position, so it is immune to reconciliation noise/pops. `hitEpoch`/
   * `hitReactEpoch` (M6 ticket 03) drive the Punch/HitReact one-shot
   * overlays, which take priority over ordinary locomotion while playing.
   * `grabEpoch` (ADR 0071) rises on every grab attempt, caught or not, and
   * draws the reach even when there was nobody to catch. `hold` (ADR 0104)
   * is this Character's end of a hold, if any: which end, which part of it,
   * and the facing the body is pinned to while the sim turns it (Held, or
   * Spinning) — see `localHoldOf`. A grabber turns at its reduced rate.
   */
  updateCharacterAnimation: (
    deltaSeconds: number,
    moveDirection: Vec3,
    grounded: boolean,
    dashing: boolean,
    dashSpeed: number,
    /** This Character's own vertical speed (units/s) — paces the jump sequence (ADR 0071). */
    verticalVelocity: number,
    hitEpoch: number,
    hitReactEpoch: number,
    grabEpoch: number,
    hold: LocalHold,
  ) => void;
  /**
   * The local Character's `facing` — where its body is turned right now, as
   * {@link updateCharacterAnimation} last left it (ADR 0085). What the client
   * sends as its input's `facing`.
   */
  characterFacing: () => number;
  /** This Stage's sound engine (ADR 0087), `null` when it was built without sounds. */
  sound: SoundEngine | null;
  /**
   * Give back everything this Stage took: the canvas, its WebGL context, every
   * geometry/material/texture it uploaded, and the window resize listener
   * (M4 ticket 01).
   *
   * Browsers cap how many live WebGL contexts a page may hold (~16) and drop
   * the oldest when that is exceeded, so a game mounted and unmounted across
   * routes must hand its context back rather than wait for the garbage
   * collector — which never runs `dispose` on GPU resources anyway.
   */
  dispose: () => void;
}

/**
 * Builds the Stage for one Track (ADR 0098's rule: this says the order, the
 * subsystems do the work). The order is the scene graph's: the renderer and
 * camera, then everything the Track draws, the Environment under and around
 * it, the local Character, and only then the remote rigs cloned from it.
 */
export const createStage = ({
  mount,
  statics,
  checkpoints,
  finishZones,
  killPlaneY,
  environment: environmentPreset,
  spinners,
  props,
  characterModel,
  assetTemplates = {},
  assetPlacements = [],
  springs = [],
  movingSegments = [],
  conveyors = [],
  iceDecks = [],
  mudDecks = [],
  bounceDecks = [],
  bounceTexture = null,
  volumes = [],
  graphics = GRAPHICS_QUALITY_SETTINGS[DEFAULT_GRAPHICS_QUALITY],
  sounds,
}: StageConfig): Stage => {
  // No antialiasing on the canvas itself (ADR 0079): the frame is drawn into
  // the composer's own multisampled targets, and the canvas only ever gets
  // their full-screen copy, so multisampling it bought nothing.
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, graphics.maxPixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
  // Khronos PBR Neutral (ADR 0074): authored base colours pass through, only
  // values above ~0.8 roll off instead of clipping. The frame renders through
  // the speed-lines composer, whose `OutputPass` applies this operator to the
  // whole composed frame. The Track builder sets the same one, so its preview
  // matches.
  renderer.toneMapping = THREE.NeutralToneMapping;
  // One frame renders several passes (shadow map, composer); counted from the
  // start of `render()` instead of per pass, so `readRenderStats` sees them all.
  renderer.info.autoReset = false;
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();

  // The far plane follows the fog (M13 ticket 04): past `fog.far` there is
  // nothing to see but fog colour, so the frustum test skips it all.
  const farPlane = fogFarPlane(environmentPreset);
  const camera = new THREE.PerspectiveCamera(
    55,
    window.innerWidth / window.innerHeight,
    0.1,
    farPlane,
  );

  // Sound (ADR 0087): the listener rides the camera, so three.js moves it
  // with every frame's camera matrix; the engine mixes into it.
  const audioListener = sounds ? new THREE.AudioListener() : null;
  const sound =
    audioListener && sounds
      ? createSoundEngine({
          context: audioListener.context,
          destination: audioListener.getInput(),
          bank: sounds,
          listenerPosition: () => camera.position,
          // The listener's own gain goes once the engine has faded out (a Track swap crossfades).
          onReleased: () => audioListener.gain.disconnect(),
        })
      : null;
  if (audioListener) camera.add(audioListener);

  const speedLines = createSpeedLines(renderer, scene, camera, graphics.composerSamples);

  const track = buildTrackVisuals(scene, {
    statics,
    checkpoints,
    finishZones,
    spinners,
    props,
    assetTemplates,
    assetPlacements,
    springs,
    movingSegments,
    conveyors,
    iceDecks,
    mudDecks,
    bounceDecks,
    bounceTexture,
    volumes,
    environment: environmentPreset,
    maxAnisotropy: renderer.capabilities.getMaxAnisotropy(),
  });

  // Sky, cloud floor, fog, light and the environment map baked from the sky
  // (ADR 0074), built after the Track so the cloud floor can stay under all of
  // it. None of the Environment joins `collidables`, so the spring-arm camera
  // never catches on the sky.
  const environment = createEnvironment(scene, renderer, environmentPreset, {
    killPlaneY,
    lowestSegmentY: track.lowestSegmentY,
    fog: true,
    detail: graphics.cloudPuffs ? "full" : "low",
    shadows:
      graphics.shadows === null
        ? false
        : {
            mapSize: graphics.shadows.mapSize,
            type: graphics.shadows.filter === "soft" ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap,
          },
    // The cloud floor must be all sky before this far plane clips it.
    farPlane,
  });

  // Floating (ADR 0077): the same Volume the sim would pick for a point,
  // asked of any Character the Stage draws.
  const orderedVolumes = byVolumePriority(volumes);
  const inUpdraft = (point: Vec3): boolean => {
    const volume = volumeAt(orderedVolumes, point);
    return volume !== undefined && holdsAloft(volume);
  };
  // Hats (ADR 0083): one wardrobe for every Character this Stage draws, so
  // a hat several Players wear loads once. A hat casts a shadow like the
  // rig it sits on.
  const wardrobe = createWardrobe({ prepare: (hat) => setShadowRole(hat, "caster") });
  // Skins (ADR 0091): one closet for every Character this Stage draws, for
  // the same reason — a skin several Players wear is fetched once and its
  // 2048² texture lives in GPU memory once.
  const closet = createSkinCloset();

  const local = createLocalCharacter(scene, characterModel, {
    floorBelow: track.floorBelow,
    inUpdraft,
    onIce: track.onIce,
    // `stageSounds` is built just below, after the rig joins the scene; a
    // foot only comes down once the first frame animates.
    onFootstep: (clip, centre) => stageSounds.footstep(clip, centre, false),
    speedLines,
    wardrobe,
    closet,
  });

  // Screen shake and nameplates (ADR 0110), at the Player's per-device settings, live.
  const gameplay = readGameplaySettings(browserStorage());
  const shake = new CameraShake(SCREEN_SHAKE_SCALE[gameplay.screenShake]);
  const shakeCues = new ShakeCues();
  let nameplatesOn = gameplay.nameplates;
  const nameplates = createNameplates(mount);
  let playerNames: ReadonlyMap<string, string> = new Map();
  let remoteNamed: NameplateEntry[] = [];
  const stopShakeSetting =
    typeof window === "undefined"
      ? () => {}
      : subscribeGameplaySettings((settings) => {
          shake.setScale(SCREEN_SHAKE_SCALE[settings.screenShake]);
          nameplatesOn = settings.nameplates;
        }, browserStorage());

  const stageSounds = createStageSounds(sound, {
    environment: environmentPreset,
    killPlaneY,
    lowestSegmentY: track.lowestSegmentY,
    movingSegments,
    movingGroups: track.movingGroups,
    spinners,
    springs,
    volumes,
    conveyors,
    mudDecks,
    bounceDecks,
    deckParent: track.deckParent,
    onIce: track.onIce,
  });

  // Other players (M6 ticket 02, ADR 0046): the same real, animated model the
  // local Character uses, one clone per session ID, tinted to tell them
  // apart. Built only after `createLocalCharacter` has scaled/repositioned
  // `characterModel.scene` in place, so every clone inherits that same
  // transform (see `remoteCharacterPool.ts`'s own `buildRig`).
  const remotePool = createRemoteCharacterPool(scene, characterModel, {
    floorBelow: track.floorBelow,
    inUpdraft,
    onIce: track.onIce,
    wardrobe,
    closet,
    ...(sound ? { onFootstep: (clip: SteppingClip, centre: Vec3) => stageSounds.footstep(clip, centre, true) } : {}),
  });

  const cameraRig = createCameraRig(camera, track.collidables);

  /** This frame's bounce landings, stashed by `applyBounceSheets` for `applyCharacterSounds`, which runs after it. */
  let bounceLandings: readonly BounceLanding[] = [];
  // Capsule centres the mud sheets ripple under (living mud, ADR 0067) —
  // stashed by the applies (each frame re-stashes, so a stale frame never
  // ripples) and read by `updateMotion`, which always runs after them in the
  // game loop. Solo practice never calls `applyRemoteCharacters`, so the
  // remotes simply stay empty there.
  let remoteCentres: Vec3[] = [];

  const stopResizing = listen(window, "resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    speedLines.resize(window.innerWidth, window.innerHeight);
  });

  const render = (): void => {
    renderer.info.reset();
    // The camera is already placed for this frame (`updateCamera` runs first).
    const now = performance.now();
    track.spin(now);
    environment.update(camera, now, cameraRig.focus());
    speedLines.render();
    stageSounds.ambience(camera.position.y);
    sound?.update();
  };

  return {
    domElement: renderer.domElement,
    render,
    warmUp: () => warmUpStage(renderer, scene, camera, render),
    readRenderStats: (into) => {
      const { info } = renderer;
      into.calls = info.render.calls;
      into.triangles = info.render.triangles;
      into.geometries = info.memory.geometries;
      into.textures = info.memory.textures;
      into.programs = info.programs?.length ?? 0;
    },
    applyRenderState: (state) => {
      local.place(state.character);
      track.placeProps(state.props);
    },
    applyRemoteCharacters: (characters, deltaSeconds, localId, localPosition) => {
      remoteCentres = Object.values(characters).map((rc) => rc.position);
      remoteNamed = Object.entries(characters)
        .filter(([id, rc]) => id !== localId && !rc.eliminated)
        .map(([id, rc]) => ({ id, name: playerNames.get(id) ?? "", position: rc.position }))
        .filter((entry) => entry.name !== "");
      remotePool.apply(characters, deltaSeconds, localId, localPosition);
    },
    setPlayerColors: (colors) => remotePool.setColors(colors),
    setPlayerNames: (names) => {
      playerNames = names;
    },
    setPlayerSkins: (skins) => remotePool.setSkins(skins),
    setLocalLook: (color, skin) => local.setLook(color, skin),
    setPlayerHats: (hats) => remotePool.setHats(hats),
    setLocalHat: (hat) => local.setHat(hat),
    applyBounceSheets: (characters, nowMs) => {
      bounceLandings = track.pressBounceSheets(characters, nowMs);
    },
    applyCharacterSounds: (characters, localId, nowMs) => {
      stageSounds.characters(characters, localId, nowMs, bounceLandings);
      bounceLandings = [];
    },
    updateAirColumns: (nowMs) => track.updateAirColumns(nowMs, camera.position),
    applySpringSquash: (characters, nowMs) => {
      for (const spring of track.squashSprings(characters, nowMs)) stageSounds.springSettled(spring);
    },
    applyShake: (own, localId, nowMs) => shake.kick(shakeCues.update(localId, own, nowMs)),
    updateCamera: (target, yaw, pitch, deltaSeconds) => {
      cameraRig.follow(target, yaw, pitch, deltaSeconds);
      const jolt = shake.step(deltaSeconds);
      if (jolt.x !== 0 || jolt.y !== 0 || jolt.z !== 0 || jolt.roll !== 0) {
        camera.position.x += jolt.x;
        camera.position.y += jolt.y;
        camera.position.z += jolt.z;
        camera.rotateZ(jolt.roll);
      }
      camera.updateMatrixWorld();
      nameplates.update(camera, window.innerWidth, window.innerHeight, remoteNamed, nameplatesOn);
    },
    updateMotion: (t) => {
      // The mud ripples under every Character the applies stashed this frame, local one included.
      const localCentre = local.centre();
      track.poseMotion(t, localCentre ? [localCentre, ...remoteCentres] : remoteCentres);
      // Heard where the listener stood last frame: the camera is placed after this.
      stageSounds.motion(t, camera.position);
    },
    updateCharacterAnimation: local.animate,
    characterFacing: local.facing,
    sound,
    dispose: () => {
      stopResizing();
      stopShakeSetting();
      nameplates.dispose();
      // The context is three.js's and shared with the next Stage: only this
      // Stage's own graph goes.
      stageSounds.dispose();
      sound?.dispose();
      if (audioListener) camera.remove(audioListener);
      local.dispose();
      speedLines.dispose();
      // Before the blanket scene-graph sweep below: each remote rig removes
      // itself from `scene` as it's disposed, so the sweep never double-frees
      // a clone's already-released geometry/material.
      remotePool.dispose();
      wardrobe.dispose();
      closet.dispose();
      // Before the sweep too: the Environment frees its own resources and takes
      // its root out of the scene, so nothing of it is freed twice. Its baked
      // environment map hangs off `scene.environment`, where the sweep never
      // looks, so only this frees it.
      environment.dispose();
      disposeSceneGraph(scene);
      scene.clear();
      track.dispose();
      renderer.domElement.remove();
      renderer.dispose();
      // `dispose` releases the renderer's own resources but leaves the WebGL
      // context itself live and counting against the browser's per-page limit.
      renderer.forceContextLoss();
    },
  };
};
