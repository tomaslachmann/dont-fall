import {
  byVolumePriority,
  CAPSULE_BOTTOM_OFFSET,
  DASH_SPEED,
  holdsAloft,
  IDENTITY_QUAT,
  isDownMotionState,
  movingSegmentPose,
  spinnerAngleAt,
  TICK_DT,
  yawQuat,
  type CharacterMotionState,
  type Checkpoint,
  type ConveyorBelt,
  type FinishZone,
  type IceDeck,
  type MudDeck,
  type BounceDeck,
  type EnvironmentPreset,
  type MovingSegmentConfig,
  type OrientedBox,
  type PropConfig,
  type PropSnapshot,
  type RenderCharacter,
  type SpinnerConfig,
  type Vec3,
  type VolumeConfig,
  volumeAt,
} from "@dont-fall/shared";
import {
  createEnvironment,
  findSpinningParts,
  localBounds,
  lowestDrawnY,
  lowestMovingY,
  spinParts,
} from "@dont-fall/render";
import * as THREE from "three";
import { blendFloatStruggle, FloatLimbs } from "./floatPose.js";
import { GrabAnimations, grabRoleOf } from "./grabAnimation.js";
import { JUMP_CROSSFADE_SECONDS, JumpSequences, jumpPoseAt, jumpTimeline } from "./jumpSequence.js";
import { nextModelYaw } from "./modelFacing.js";
import {
  actionFor,
  CHARACTER_VISUAL_HEIGHT,
  crossfadeLocomotion,
  loadCharacterActions,
  LOCOMOTION_CROSSFADE_SECONDS,
  MODEL_YAW_OFFSET,
  pinClipPose,
  type CharacterModel,
} from "./characterModel.js";
import {
  CAMERA_DISTANCE,
  CAMERA_MIN_DISTANCE,
  CAMERA_SKIN,
  resolveArm,
  springArmPosition,
} from "../input/camera/springArm.js";
import { listen } from "../lib/socket/listeners.js";
import { buildAssetVisuals, type AssetVisualPlacement } from "./assetVisuals.js";
import { SpringSquashes, type SpringTrigger } from "./springSquash.js";
import { BouncePresses, buildBounceSheets } from "./bounceSheets.js";
import { buildAirColumns } from "./airColumns.js";
import { buildConveyorStrips } from "./conveyorBelts.js";
import { disposeSceneGraph } from "./disposeSceneGraph.js";
import { buildIceOverlays } from "./iceOverlays.js";
import { buildMudOverlays } from "./mudOverlays.js";
import { HitReactionPlayer } from "./hitReactionPlayer.js";
import { selectLocomotion } from "./locomotionAnimation.js";
import {
  KNOCKDOWN_CROSSFADE_SECONDS,
  KNOCKDOWN_FLOOR_PROBE,
  KNOCKDOWN_FLOOR_REACH,
  KnockdownOrigin,
  Knockdowns,
  knockdownFeetY,
  type FloorQuery,
} from "./knockdownAnimation.js";
import { createRemoteCharacterPool } from "./remoteCharacterPool.js";
import { tintHueForSkin, tintModel } from "./playerTint.js";
import { setShadowRole } from "./shadowRoles.js";
import { createSpeedLines } from "./speedLines.js";
import { initialWobbleState, stepWobble } from "./wobble.js";

/**
 * Procedural Wobble lean (ticket 07), temporarily OFF. It derives acceleration
 * from render-frame `character.position` deltas, which a predicted + reconciled
 * Character (M2) delivers unevenly — fixed 30 Hz prediction ticks sampled at a
 * variable render rate, plus reconciliation snaps — so it reads as a micro-stutter
 * / "lag" while just walking. Re-enable once it's driven from a simulation-owned
 * velocity instead of position deltas (the same fix speed-lines already got).
 */
const WOBBLE_ENABLED = false;

export interface StageConfig {
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
   * Ice-surfaced decks to sheet (ADR 0066) — one translucent textured sheet
   * per deck (`iceOverlays.ts`), parented under the Moving Segment's own
   * group when the sheet rides one. Drawn only when `iceTexture` is set: a
   * missing texture (an older API, a failed fetch) sheets nothing rather
   * than bricking boot over a cosmetic. Empty on Tracks without ice.
   */
  iceDecks?: IceDeck[];
  /** The shared ice texture, or null when it could not be loaded (see `iceDecks`). */
  iceTexture?: THREE.Texture | null;
  /**
   * Mud-surfaced decks to sheet (ADR 0067) — one raised opaque textured
   * sheet per deck (`mudOverlays.ts`), same parenting and same missing-
   * texture contract as the ice sheets above. Empty on Tracks without mud.
   */
  mudDecks?: MudDeck[];
  /** The shared mud texture, or null when it could not be loaded (see `mudDecks`). */
  mudTexture?: THREE.Texture | null;
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

export interface Stage {
  domElement: HTMLCanvasElement;
  render: () => void;
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
   * Refresh equipped skins by session id (M9 ticket 15) — the game calls this
   * off every snapshot's lobby roster, before `applyRemoteCharacters`, so a
   * rig built this frame already wears its skin. See
   * `RemoteCharacterPool.setSkins` for the re-tint rules.
   */
  setPlayerSkins: (skins: ReadonlyMap<string, number | null>) => void;
  /**
   * Tint the local Character's own model to an equipped skin (M9 ticket 15).
   * `null` (skin unknown — the own row's `auth` hasn't resolved yet, or the
   * API was unreachable at practice boot) leaves the model natural, exactly
   * as before skins existed. Re-tints only on change — a re-tint clones
   * every material, so calling this every snapshot stays free.
   */
  setLocalSkin: (skin: number | null) => void;
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
   * Advance every air column's swooshes and puffs to `nowMs` (ADR 0075),
   * render-rate driven like every other overlay. The swooshes face the
   * Stage's camera as it stood at its last update.
   */
  updateAirColumns: (nowMs: number) => void;
  /** Position the camera on a collision-resolved spring arm around `target`. */
  updateCamera: (target: Vec3, yaw: number, pitch: number) => void;
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
   * draws the reach even when there was nobody to catch.
   * `grabTargetPosition` (M6.1), given whenever this Character is currently
   * grabbing someone, is that Character's own world position. Since ADR 0071
   * the rig has its own Grab clips and nothing aims at that position any
   * more — it is read only as "this Character is the one doing the holding",
   * which together with `facingLocked` (true in *either* role) tells the two
   * ends of a hold apart. `facingLocked` (M6.1) also freezes the
   * model's cosmetic yaw outright for as long as this Character is in a Grab
   * hold, in either role — see `nextModelYaw`'s own doc comment for why a
   * held Character must strafe rather than turn.
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
    grabTargetPosition: Vec3 | undefined,
    facingLocked: boolean,
  ) => void;
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

const boxMesh = (box: OrientedBox, material: THREE.Material): THREE.Mesh => {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(box.halfExtents.x * 2, box.halfExtents.y * 2, box.halfExtents.z * 2),
    material,
  );
  mesh.position.set(box.center.x, box.center.y, box.center.z);
  // ADR 0034: a static's OrientedBox may carry a real rotation now — Props/
  // Checkpoint triggers/Spinner arms passed in here are still plain (rotation-
  // less) Boxes, which default to identity, unchanged from before.
  const q = box.rotation ?? IDENTITY_QUAT;
  mesh.quaternion.set(q.x, q.y, q.z, q.w);
  return mesh;
};

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
  iceTexture = null,
  mudDecks = [],
  mudTexture = null,
  bounceDecks = [],
  bounceTexture = null,
  volumes = [],
}: StageConfig): Stage => {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  // Khronos PBR Neutral (ADR 0074): authored base colours pass through, only
  // values above ~0.8 roll off instead of clipping. The frame renders through
  // the speed-lines composer, whose `OutputPass` applies this operator to the
  // whole composed frame. The Track builder sets the same one, so its preview
  // matches.
  renderer.toneMapping = THREE.NeutralToneMapping;
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(
    55,
    window.innerWidth / window.innerHeight,
    0.1,
    300,
  );

  const speedLines = createSpeedLines(renderer, scene, camera);

  const platformMaterial = new THREE.MeshStandardMaterial({ color: 0x1c2740, roughness: 0.95 });
  const collidables: THREE.Object3D[] = [];
  // The floor under a knocked-down Character (ADR 0076): a short ray down
  // against the same meshes the camera arm avoids, started just above the
  // Character so a pelvis sunk into the deck still finds it.
  const floorRay = new THREE.Raycaster();
  const floorOrigin = new THREE.Vector3();
  const floorDown = new THREE.Vector3(0, -1, 0);
  const floorBelow: FloorQuery = (x, y, z) => {
    floorRay.set(floorOrigin.set(x, y + KNOCKDOWN_FLOOR_PROBE, z), floorDown);
    floorRay.far = KNOCKDOWN_FLOOR_PROBE + KNOCKDOWN_FLOOR_REACH;
    const hit = floorRay.intersectObjects(collidables, false)[0];
    return hit ? hit.point.y : null;
  };
  // Everything still the Track draws, for where the cloud floor has to stay under.
  const stillTrack: THREE.Object3D[] = [];
  // Shadows (ADR 0074): every Track piece casts onto the pieces below it and
  // receives; a Character only casts; deck sheets and strips only receive, so
  // a shadow shows on a mud or ice deck rather than under its sheet; markers
  // and the Environment's own meshes do neither.
  for (const box of statics) {
    const mesh = setShadowRole(boxMesh(box, platformMaterial), "both");
    scene.add(mesh);
    collidables.push(mesh);
    stillTrack.push(mesh);
  }

  // Asset visuals (M8 ticket 03): one clone per placed asset Segment, standing
  // at the Segment's own origin/transform — the same placement `resolveTrack`
  // baked the collision trimeshes at. Their meshes join `collidables` so the
  // spring-arm camera treats authored shapes the way it treated the boxes
  // they replace (only leaf meshes are pushed, so the non-recursive raycast
  // below needs no change for the nested clones). Freed with the scene-graph
  // sweep in `dispose`, like everything else added to the scene here.
  // Which drawn instance belongs to which Segment — `buildAssetVisuals` clones
  // one child per placement, in order, so the two line up by index. Only
  // Springs need looking up, so only Springs are kept.
  const springVisuals = new Map<number, THREE.Object3D>();
  if (assetPlacements.length > 0) {
    const assetVisuals = setShadowRole(buildAssetVisuals(assetTemplates, assetPlacements), "both");
    scene.add(assetVisuals);
    stillTrack.push(assetVisuals);
    assetVisuals.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) collidables.push(object);
    });
    const squashable = new Set(springs.map((spring) => spring.segmentIndex));
    assetPlacements.forEach((placement, i) => {
      const instance = assetVisuals.children[i];
      if (instance && squashable.has(placement.segmentIndex)) springVisuals.set(placement.segmentIndex, instance);
    });
  }
  const springSquashes = new SpringSquashes();
  // Each Spring's own authored size (ADR 0062), captured before any squash
  // multiplies it — so repeated fires can never compound into drift.
  const springBaseScale = new Map<THREE.Object3D, number>();
  const base = (instance: THREE.Object3D): number => {
    const remembered = springBaseScale.get(instance);
    if (remembered !== undefined) return remembered;
    springBaseScale.set(instance, instance.scale.x);
    return instance.scale.x;
  };

  // Moving Segments (ADR 0061): the Segment's whole visual in its local frame
  // under one group — an asset's template clone, or its Module boxes — so
  // posing the group poses everything it draws, exactly as the body does.
  const movingGroups = movingSegments.map((config) => {
    const group = new THREE.Group();
    const template = assetTemplates[config.moduleId];
    if (template) {
      // Collision boxes/trimeshes arrive already scaled (ADR 0062); the visual is scaled here.
      const visual = template.clone(true);
      visual.scale.setScalar(config.scale);
      group.add(visual);
    } else if (config.trimeshes.length > 0) {
      throw new Error(`asset "${config.moduleId}": no loaded visual template (fetch it before placing)`);
    }
    for (const { box } of config.boxes) group.add(boxMesh(box, platformMaterial));
    setShadowRole(group, "both");
    scene.add(group);
    group.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) collidables.push(object);
    });
    return group;
  });
  const poseMovingSegments = (t: number): void => {
    for (let i = 0; i < movingGroups.length; i += 1) {
      const pose = movingSegmentPose(movingSegments[i]!, t);
      const group = movingGroups[i]!;
      group.position.set(pose.position.x, pose.position.y, pose.position.z);
      group.quaternion.set(pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.w);
      group.updateMatrixWorld(true);
    }
  };
  poseMovingSegments(0);

  // Conveyor chevron strips (ADR 0064) — still belts parent to the scene, a
  // belt riding a Moving Segment parents under its group (already in that
  // frame) so it follows the carrier. Never `collidables`: flat decals on
  // the deck neither block the camera nor catch its raycast.
  const conveyorStrips = buildConveyorStrips(conveyors, movingSegments);
  for (const strip of conveyorStrips) {
    const parent = strip.movingIndex === null ? scene : movingGroups[strip.movingIndex]!;
    parent.add(setShadowRole(strip.object, "receiver"));
  }

  // Ice sheets (ADR 0066) — same parenting as the strips above, never
  // `collidables` for the same reason. Anisotropic-filtered at the
  // renderer's own cap: decks are viewed at grazing angles, where a
  // nearest-mipped sheet would shimmer.
  const iceSheets = iceTexture ? buildIceOverlays(iceDecks, movingSegments, iceTexture, renderer.capabilities.getMaxAnisotropy()) : [];
  for (const sheet of iceSheets) {
    const parent = sheet.movingIndex === null ? scene : movingGroups[sheet.movingIndex]!;
    parent.add(setShadowRole(sheet.object, "receiver"));
  }

  // Mud sheets (ADR 0067) — the same treatment: never `collidables`,
  // anisotropic-filtered, riding carriers by re-parenting.
  const mudSheets = mudTexture ? buildMudOverlays(mudDecks, movingSegments, mudTexture, renderer.capabilities.getMaxAnisotropy()) : [];
  for (const sheet of mudSheets) {
    const parent = sheet.movingIndex === null ? scene : movingGroups[sheet.movingIndex]!;
    parent.add(setShadowRole(sheet.object, "receiver"));
  }

  // Bounce sheets (ADR 0070) — skin, never `collidables`: the deck's own flat
  // collider is what a Character stands on, and the sheet only draws what that
  // deck does to them.
  const bounceSheets = buildBounceSheets(bounceDecks, bounceTexture, movingSegments);
  for (const sheet of bounceSheets) {
    const parent = sheet.movingIndex === null ? scene : movingGroups[sheet.movingIndex]!;
    parent.add(setShadowRole(sheet.object, "receiver"));
  }
  const bouncePresses = new BouncePresses();

  // Air columns (ADR 0075) are drawn, never `collidables`: like a
  // Checkpoint's marker, the region is walked into, not collided with.
  // `buildAirColumns` allocates nothing without a column to draw, and a
  // zero-force Volume draws nothing. The disposal sweep frees what the
  // columns share, since every shared piece hangs off one of them.
  const airColumns = buildAirColumns(volumes, environmentPreset);
  for (const column of airColumns.columns) scene.add(column);

  // Every Asset part that turns on its own, a fan's rotor (ADR 0075), still
  // or riding a Moving Segment. Found once: the Track's pieces never change
  // under a Stage.
  const spinningParts = findSpinningParts(scene);

  const checkpointMaterial = new THREE.MeshBasicMaterial({
    color: 0x4fd1c5,
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
  });
  // Only a retired block's region gets a marker — a Gate is its own art (ADR 0068).
  for (const cp of checkpoints) {
    if (cp.trigger) scene.add(boxMesh(cp.trigger, checkpointMaterial));
  }

  // Brighter and far more opaque than a Checkpoint's marker: a Checkpoint is
  // ambient reassurance you can miss, a Finish Zone is the thing you are
  // running at, and you have to be able to pick it out down the length of a
  // Track. Both use the same box treatment so they read as the same family
  // of "walk into this" region.
  // Built only when there is something to draw with it: `disposeSceneGraph`
  // reaches materials through the meshes that use them, so a material
  // allocated for an empty list would never be released.
  if (finishZones.some((zone) => zone.trigger)) {
    const finishZoneMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd166,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    });
    for (const zone of finishZones) {
      if (zone.trigger) scene.add(boxMesh(zone.trigger, finishZoneMaterial));
    }
  }

  const spinnerMaterial = new THREE.MeshStandardMaterial({ color: 0xf25c54, roughness: 0.5 });
  const spinnerMeshes = spinners.map((config) => {
    const mesh = setShadowRole(
      boxMesh(
        { center: config.center, halfExtents: { x: config.armLength, y: config.halfHeight, z: config.armRadius } },
        spinnerMaterial,
      ),
      "both",
    );
    scene.add(mesh);
    collidables.push(mesh);
    // A Spinner turns about the vertical, which never takes it lower.
    stillTrack.push(mesh);
    return mesh;
  });

  const propMaterial = new THREE.MeshStandardMaterial({ color: 0xf2c14e, roughness: 0.6 });
  const propMeshes = props.map((config) => {
    if (config.shape.kind === "box") {
      const mesh = setShadowRole(boxMesh({ center: config.center, halfExtents: config.shape.halfExtents }, propMaterial), "both");
      scene.add(mesh);
      collidables.push(mesh);
      return mesh;
    }
    const mesh = setShadowRole(new THREE.Mesh(new THREE.SphereGeometry(config.shape.radius, 16, 12), propMaterial), "both");
    mesh.position.set(config.center.x, config.center.y, config.center.z);
    scene.add(mesh);
    collidables.push(mesh);
    return mesh;
  });

  // Sky, cloud floor, fog, light and the environment map baked from the sky
  // (ADR 0074), built after the Track so the cloud floor can stay under all of
  // it: every still piece, and every Moving Segment wherever its Motion can
  // carry it. Props are left out, since they fall. None of the Environment
  // joins `collidables`, so the spring-arm camera never catches on the sky.
  const environment = createEnvironment(scene, renderer, environmentPreset, {
    killPlaneY,
    lowestSegmentY: Math.min(
      lowestDrawnY(stillTrack),
      ...movingGroups.map((group, i) => lowestMovingY(localBounds(group), movingSegments[i]!)),
    ),
    fog: true,
    detail: "full",
    shadows: true,
  });

  // `character` is the runtime placement handle: its position is the capsule's
  // ground-contact point (feet), its rotation.y is the cosmetic facing.
  // `wobblePivot` sits between it and the model for the procedural Wobble lean
  // (ticket 07) — rotating in `character`'s local frame so "lean forward"
  // always means forward relative to the current facing, at whatever yaw.
  // The loaded model's own pivot/scale quirks are corrected once, on the child.
  const character = new THREE.Group();
  const wobblePivot = new THREE.Group();
  const naturalBounds = new THREE.Box3().setFromObject(characterModel.scene);
  const naturalHeight = naturalBounds.getSize(new THREE.Vector3()).y;
  const naturalFeetY = naturalBounds.min.y;
  const modelScale = naturalHeight > 0 ? CHARACTER_VISUAL_HEIGHT / naturalHeight : 1;
  characterModel.scene.scale.setScalar(modelScale);
  characterModel.scene.position.y = -naturalFeetY * modelScale;
  // …and which way it faces (ADR 0071). BLIP is authored looking down +Z while
  // a Track runs toward −Z. Corrected here with the scale and the feet, on the
  // child, so every remote clone inherits it and nothing downstream — the
  // cosmetic facing on `character`, the ragdoll's bone mapping — has to know.
  characterModel.scene.rotation.y = MODEL_YAW_OFFSET;
  // Marked before any remote rig is cloned from it, so every clone casts too.
  setShadowRole(characterModel.scene, "caster");
  wobblePivot.add(characterModel.scene);
  character.add(wobblePivot);
  character.position.y = CAPSULE_BOTTOM_OFFSET; // arbitrary until the first applyRenderState
  scene.add(character);

  // Other players (M6 ticket 02, ADR 0046): the same real, animated model the
  // local Character uses, one clone per session ID, tinted to tell them
  // apart — retires the flat placeholder capsule M2 ticket 04 stood in with.
  // Built only after the local model setup above has already scaled/
  // repositioned `characterModel.scene` in place, so every clone inherits
  // that same transform (see `remoteCharacterPool.ts`'s own `buildRig`).
  // Floating (ADR 0077): the same Volume the sim would pick for a point,
  // asked of any Character the Stage draws.
  const orderedVolumes = byVolumePriority(volumes);
  const inUpdraft = (point: Vec3): boolean => {
    const volume = volumeAt(orderedVolumes, point);
    return volume !== undefined && holdsAloft(volume);
  };
  const remotePool = createRemoteCharacterPool(scene, characterModel, { floorBelow, inUpdraft });

  const mixer = new THREE.AnimationMixer(characterModel.scene);
  // A knockdown plays the rig's own KO and GetUp clips (ADR 0076); the
  // physics ragdoll underneath still decides where the body is.
  const actions = loadCharacterActions(mixer, characterModel.animations);
  const { idle: idleAction } = actions;
  let activeAction: THREE.AnimationAction | null = idleAction;
  activeAction?.play();

  /** The last `motionState` seen, to detect the Ragdoll/GettingUp/Controlled edges. */
  let visualState: CharacterMotionState = "Controlled";
  /** Drives the Punch/HitReact one-shot overlays (M6 ticket 03). */
  const hitReactionPlayer = new HitReactionPlayer();
  /** The hold, the struggle, and a reach at nobody (ADR 0071). */
  const grabAnimations = new GrabAnimations();
  const jumpSequences = new JumpSequences();
  const localJumpTimeline = jumpTimeline(actions);
  /** The fall, the get-up, and the get-up's tail (ADR 0076). */
  const knockdowns = new Knockdowns();
  /** A Floating Character's arms, legs and crest (ADR 0077). */
  const localFloatLimbs = new FloatLimbs(characterModel.scene);
  /** Where the knocked-down rig stands, vertically (ADR 0076). */
  const localOrigin = new KnockdownOrigin();
  /** The replicated velocity, stashed by `applyRenderState`: the push a fall reads its direction from. */
  let localVelocity: Vec3 = { x: 0, y: 0, z: 0 };
  const modelQuaternion = new THREE.Quaternion();

  let wobbleState = initialWobbleState;
  // Seeded lazily on the first updateCharacterAnimation call (null here would
  // otherwise predate applyRenderState placing the Character at its real spawn
  // position, producing a one-frame phantom velocity spike at game start).
  let previousWobblePosition: Vec3 | null = null;

  // Capsule centres the mud sheets ripple under (living mud, ADR 0067) —
  // stashed by the two applies below (each frame re-stashes, so a stale
  // frame never ripples) and read by `updateMotion`, which always runs
  // after both in the game loop. Solo practice never calls
  // `applyRemoteCharacters`, so the remotes simply stay empty there.
  let localCentre: Vec3 | null = null;
  let remoteCentres: Vec3[] = [];

  // The local model's own tint (M9 ticket 15) — `setLocalSkin` re-tints only
  // on change, since a re-tint clones every material.
  let localSkin: number | null = null;

  /** Where the shadow box centres (ADR 0074): the point the camera follows, set by `updateCamera`. */
  let shadowFocus: Vec3 | undefined;

  const raycaster = new THREE.Raycaster();
  const castArm = (from: Vec3, to: Vec3): number | null => {
    const origin = new THREE.Vector3(from.x, from.y, from.z);
    const dir = new THREE.Vector3(to.x - from.x, to.y - from.y, to.z - from.z);
    const distance = dir.length();
    if (distance === 0) return null;
    raycaster.set(origin, dir.normalize());
    raycaster.far = distance;
    const hit = raycaster.intersectObjects(collidables, false)[0];
    return hit ? hit.distance : null;
  };

  const stopResizing = listen(window, "resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    speedLines.resize(window.innerWidth, window.innerHeight);
  });

  return {
    domElement: renderer.domElement,
    render: () => {
      // The camera is already placed for this frame (`updateCamera` runs first).
      const now = performance.now();
      spinParts(spinningParts, now);
      environment.update(camera, now, shadowFocus);
      speedLines.render();
    },
    applyRenderState: (state) => {
      const { position, motionState, velocity } = state.character;
      localCentre = position;
      localVelocity = velocity;
      const fallingRagdoll = motionState === "Ragdoll";
      const gettingUp = motionState === "GettingUp";
      const enteringRagdoll = fallingRagdoll && visualState !== "Ragdoll";
      const enteringGettingUp = gettingUp && visualState !== "GettingUp";
      // Covers both the normal GettingUp → Controlled completion AND a
      // reconciliation snapping straight from Ragdoll to Controlled (the
      // server rejected a knockdown the client mispredicted, skipping the
      // GettingUp frame entirely): either way the next knockdown must stand
      // up from wherever it happens, not from this one's floor.
      const wasDown = isDownMotionState(visualState);
      const leavingDown = !fallingRagdoll && !gettingUp && wasDown;
      visualState = motionState;

      if (fallingRagdoll || gettingUp) {
        // The rig stands where the Character is (ADR 0076): `position` is the
        // physics pelvis while down, so the origin is the floor under it, or
        // where standing feet would be when the body is in the air. The pose
        // is the knockdown's own clips, set in `updateCharacterAnimation`.
        if (enteringRagdoll || enteringGettingUp) hitReactionPlayer.stop(actions);
        const floorY = floorBelow(position.x, position.y, position.z);
        const originY = localOrigin.place(floorY, knockdownFeetY(motionState, position.y), performance.now());
        character.position.set(position.x, originY, position.z);
      } else if (leavingDown) {
        // Back on its feet, at the real capsule position. The get-up's own
        // clip is still the active action, so locomotion fades in from it.
        localOrigin.reset();
        character.position.set(position.x, position.y - CAPSULE_BOTTOM_OFFSET, position.z);
      } else {
        // `position` is the capsule centre; the model rig is placed at the feet.
        character.position.set(position.x, position.y - CAPSULE_BOTTOM_OFFSET, position.z);
      }

      // Recomputed immediately (not left for the next render()) since `updateCamera`
      // raycasts against these meshes — via `collidables` — before this frame renders.
      for (let i = 0; i < propMeshes.length; i += 1) {
        const mesh = propMeshes[i]!;
        const prop = state.props[i];
        if (!prop) continue;
        mesh.position.set(prop.position.x, prop.position.y, prop.position.z);
        mesh.quaternion.set(prop.rotation.x, prop.rotation.y, prop.rotation.z, prop.rotation.w);
        mesh.updateMatrixWorld();
      }
    },
    applyRemoteCharacters: (characters, deltaSeconds, localId, localPosition) => {
      remoteCentres = Object.values(characters).map((rc) => rc.position);
      remotePool.apply(characters, deltaSeconds, localId, localPosition);
    },
    setPlayerSkins: (skins) => {
      remotePool.setSkins(skins);
    },
    setLocalSkin: (skin) => {
      if (skin === localSkin) return;
      localSkin = skin;
      // Unknown (or a newer server's unlock this client has no hue for):
      // the default skin, like every other Character without one. Base is
      // `null`, not unknown — the restore below recolors nothing.
      tintModel(character, tintHueForSkin(skin));
    },
    applyBounceSheets: (characters, nowMs) => {
      if (bounceSheets.length === 0) return;
      const presses = bouncePresses.update(characters, nowMs);
      for (const sheet of bounceSheets) sheet.update(presses);
    },
    updateAirColumns: (nowMs) => {
      if (airColumns.columns.length === 0) return;
      airColumns.update(nowMs, camera.position);
    },
    applySpringSquash: (characters, nowMs) => {
      if (springs.length === 0) return;
      for (const [segmentIndex, scale] of springSquashes.update(characters, springs, nowMs)) {
        const instance = springVisuals.get(segmentIndex);
        // Multiplied into the Segment's own scale (ADR 0062), never replacing
        // it: a 2x Spring squashes as a 2x Spring.
        if (instance) instance.scale.set(base(instance) * scale.xz, base(instance) * scale.y, base(instance) * scale.xz);
      }
    },
    updateCamera: (target, yaw, pitch) => {
      const desired = springArmPosition(target, yaw, pitch, CAMERA_DISTANCE);
      const resolved = resolveArm(target, desired, castArm, CAMERA_MIN_DISTANCE, CAMERA_SKIN);
      camera.position.set(resolved.x, resolved.y, resolved.z);
      camera.lookAt(target.x, target.y, target.z);
      shadowFocus = target;
    },
    updateMotion: (t) => {
      poseMovingSegments(t);
      // Marched in sim time (not wall clock), so belts pause with the sim —
      // at true belt speed, so what you see is what carries you.
      for (const strip of conveyorStrips) strip.update(t * TICK_DT);
      // The mud breathes and ripples on the same clock — under every
      // Character the applies stashed this frame, local one included.
      const centres = localCentre ? [localCentre, ...remoteCentres] : remoteCentres;
      for (const sheet of mudSheets) sheet.update(t * TICK_DT, centres);
      // Recomputed immediately, same reason as the Prop meshes above.
      for (let i = 0; i < spinnerMeshes.length; i += 1) {
        const config = spinners[i]!;
        const q = yawQuat(spinnerAngleAt(config, t));
        const mesh = spinnerMeshes[i]!;
        mesh.quaternion.set(q.x, q.y, q.z, q.w);
        mesh.updateMatrixWorld();
      }
    },
    updateCharacterAnimation: (
      deltaSeconds,
      moveDirection,
      grounded,
      dashing,
      dashSpeed,
      verticalVelocity,
      hitEpoch,
      hitReactEpoch,
      grabEpoch,
      grabTargetPosition,
      facingLocked,
    ) => {
      const currentPosition: Vec3 = { x: character.position.x, y: character.position.y, z: character.position.z };
      // Lazily seeded so the very first call (before any real movement) reads
      // as zero velocity rather than a jump from an arbitrary creation-time value.
      previousWobblePosition ??= currentPosition;

      // Wobble only applies while Controlled (ADR 0006). Every other state —
      // Stagger, Ragdoll, GettingUp — holds it neutral *and* keeps the position
      // tracker current every frame (not just on the Controlled branch below),
      // so the instant Controlled resumes there is no stale previousWobblePosition
      // to compute a fake velocity/acceleration spike from (e.g. the Ragdoll/
      // GettingUp anchor, or a Fall's Respawn teleport, sitting units away from
      // where control resumes).
      if (visualState !== "Controlled") {
        wobbleState = initialWobbleState;
        previousWobblePosition = currentPosition;
        wobblePivot.rotation.x = 0;
        wobblePivot.rotation.z = 0;
        speedLines.setIntensity(0);
      }

      const moving = moveDirection.x !== 0 || moveDirection.z !== 0;
      // The knockdown (ADR 0076), advanced every frame: this call is also what
      // ends it. The get-up's last frames play on in Controlled only while
      // the Player does nothing. A held Grab counts as doing something, in
      // either role.
      characterModel.scene.getWorldQuaternion(modelQuaternion);
      const knockdownPose = knockdowns.advance(
        "local",
        {
          motionState: visualState,
          velocity: localVelocity,
          modelQuaternion,
          busy: moving || dashing || !grounded || facingLocked,
          deltaSeconds,
        },
        actions,
      );

      // While down, the knockdown owns the whole body, and the model keeps
      // the yaw it went down with.
      if (isDownMotionState(visualState)) {
        // Code review, M6.1: keeps the reaction baseline current even though
        // no reaction may play while down — see `observeBaseline`'s own doc.
        hitReactionPlayer.observeBaseline(hitEpoch, hitReactEpoch);
        // Getting up is not the end of whatever jump it went down in.
        jumpSequences.forget("local");
        blendFloatStruggle(actions, 0, activeAction);
        if (knockdownPose) {
          activeAction = crossfadeLocomotion(knockdownPose.action, activeAction, KNOCKDOWN_CROSSFADE_SECONDS);
          pinClipPose(knockdownPose);
          mixer.update(deltaSeconds);
        }
        return;
      }

      const nowMs = performance.now();
      // The jump, all five pieces end to end, paced to the real arc so every
      // frame of it is seen (ADR 0071). Advanced before the reaction below may
      // take the frame, so a Punch thrown in the air doesn't freeze the jump's
      // clock underneath it.
      const jumpPlayhead = localJumpTimeline
        ? jumpSequences.advance(
            "local",
            {
              grounded,
              verticalVelocity,
              height: character.position.y,
              moving,
              deltaSeconds,
              nowMs,
              inUpdraft: localCentre !== null && inUpdraft(localCentre),
            },
            localJumpTimeline,
          )
        : null;
      // A Grab owns the whole body while it plays (ADR 0071): the authored
      // hold in either role, and the reach of an attempt that caught nobody.
      // The two roles come off the arguments this method already takes.
      // `grabTargetPosition` is given exactly when this Character is holding
      // someone (it no longer aims anything: the pair's facing is frozen for
      // the hold), and `facingLocked` is true in either role, so locked
      // without a target is the other end of the hold. Also asked before the
      // reaction below, so an attempt made during one isn't lost.
      const grabRole = grabRoleOf(
        grabTargetPosition ? "them" : null,
        facingLocked && !grabTargetPosition ? "them" : null,
      );
      const grabPose = grabAnimations.pose("local", grabRole, grabEpoch, grounded, nowMs, actions);

      // M6 ticket 03: Punch/HitReact take priority over ordinary locomotion
      // while playing — the caller (this method) never picks a locomotion
      // clip on a frame where a reaction is still in progress.
      const reacting = hitReactionPlayer.update(hitEpoch, hitReactEpoch, actions, LOCOMOTION_CROSSFADE_SECONDS, activeAction);
      if (reacting) {
        knockdowns.forget("local");
        activeAction = reacting;
        mixer.update(deltaSeconds);
        return;
      }

      // A grounded playhead is the landing, drawn over locomotion. It is
      // suppressed while Stagger owns the body: a Respawn drops the Character
      // at its Checkpoint, and the wobble is the whole point of that landing
      // (ADR 0072).
      const jumpPose =
        jumpPlayhead === null || (grounded && visualState !== "Controlled") ? null : jumpPoseAt(jumpPlayhead, actions);
      // The get-up's tail only survives a frame with nothing else to draw.
      const posed = grabPose ?? jumpPose ?? knockdownPose;
      // A Dash with no direction held plays from lastMoveDir (see DashController),
      // so it must still select a locomotion clip even though moveDirection is zero.
      // `visualState` is the replicated motion state this rig is drawing —
      // `Stagger` is the Wobble (ADR 0072), whether it came from a light hit
      // or from coming back off a Respawn.
      const next =
        posed?.action ?? actionFor(selectLocomotion(moving, grounded, dashing, visualState === "Stagger"), actions);
      // Gaits blend into each other over a long fade. The jump's pieces get a
      // short one: at gait length, a quarter-second piece never reaches full
      // weight.
      activeAction = crossfadeLocomotion(
        next,
        activeAction,
        posed === null
          ? LOCOMOTION_CROSSFADE_SECONDS
          : posed === jumpPose
            ? JUMP_CROSSFADE_SECONDS
            : posed === knockdownPose
              ? KNOCKDOWN_CROSSFADE_SECONDS
              : LOCOMOTION_CROSSFADE_SECONDS,
      );
      if (posed) pinClipPose(posed);
      // A Float's overlay (ADR 0077), only ever under the jump's own pose.
      const floatWeight = posed !== null && posed === jumpPose ? jumpSequences.floatWeight("local") : 0;
      blendFloatStruggle(actions, floatWeight, activeAction);
      mixer.update(deltaSeconds);
      localFloatLimbs.apply(floatWeight, verticalVelocity, nowMs);

      character.rotation.y = nextModelYaw({
        currentYaw: character.rotation.y,
        moveDirection,
        deltaSeconds,
        facingLocked,
      });


      if (visualState === "Controlled") {
        if (WOBBLE_ENABLED) {
          // `stepWobble` itself skips a frame where `character.position` jumped
          // metres (a reconciliation snap / Respawn) — see WOBBLE_TELEPORT_DISTANCE.
          const yaw = character.rotation.y;
          const forward: Vec3 = { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) };
          const right: Vec3 = { x: -Math.cos(yaw), y: 0, z: Math.sin(yaw) };
          wobbleState = stepWobble(wobbleState, currentPosition, previousWobblePosition, forward, right, deltaSeconds);
          wobblePivot.rotation.x = -wobbleState.pitch;
          wobblePivot.rotation.z = wobbleState.roll;
        }
        previousWobblePosition = currentPosition;

        // Speed lines: driven directly by the Dash's own envelope value
        // (0 when not dashing, ramping via the same `dashEnvelope` curve
        // driving the physics) rather than a velocity derived from position
        // deltas — a simulation-owned value needs no noise margin and can't
        // be perturbed by a reconciliation correction.
        speedLines.setIntensity(dashSpeed / DASH_SPEED);
      }
    },
    dispose: () => {
      stopResizing();
      // Stop the mixer before the rig it animates is disposed, and drop the
      // clips it cached against that rig — the mixer keeps them keyed by root
      // object, so a second game booting with a freshly loaded model would
      // otherwise leave the first run's action cache alive.
      mixer.stopAllAction();
      mixer.uncacheRoot(characterModel.scene);
      speedLines.dispose();
      // Before the blanket scene-graph sweep below: each remote rig removes
      // itself from `scene` as it's disposed, so the sweep never double-frees
      // a clone's already-released geometry/material.
      remotePool.dispose();
      // Before the sweep too: the Environment frees its own resources and takes
      // its root out of the scene, so nothing of it is freed twice. Its baked
      // environment map hangs off `scene.environment`, where the sweep never
      // looks, so only this frees it.
      environment.dispose();
      disposeSceneGraph(scene);
      scene.clear();
      collidables.length = 0;
      renderer.domElement.remove();
      renderer.dispose();
      // `dispose` releases the renderer's own resources but leaves the WebGL
      // context itself live and counting against the browser's per-page limit.
      renderer.forceContextLoss();
    },
  };
};
