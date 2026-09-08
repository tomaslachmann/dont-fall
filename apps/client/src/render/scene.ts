import {
  CAPSULE_BOTTOM_OFFSET,
  DASH_SPEED,
  IDENTITY_QUAT,
  isDownMotionState,
  spinnerAngleAt,
  yawQuat,
  type CharacterMotionState,
  type Checkpoint,
  type FinishZone,
  type OrientedBox,
  type PropConfig,
  type PropSnapshot,
  type RenderCharacter,
  type SpinnerConfig,
  type Vec3,
} from "@dont-fall/shared";
import * as THREE from "three";
import {
  actionFor,
  crossfadeLocomotion,
  loadCharacterActions,
  LOCOMOTION_CROSSFADE_SECONDS,
  RAGDOLL_PELVIS_TO_FEET,
  type CharacterModel,
} from "./characterModel.js";
import {
  CAMERA_DISTANCE,
  CAMERA_MIN_DISTANCE,
  CAMERA_SKIN,
  resolveArm,
  springArmPosition,
} from "../input/camera/springArm.js";
import { listen } from "../lib/listeners.js";
import { disposeSceneGraph } from "./disposeSceneGraph.js";
import { HitReactionPlayer } from "./hitReactionPlayer.js";
import { selectLocomotion } from "./locomotionAnimation.js";
import { createRagdollPose } from "./ragdollPose.js";
import { createRemoteCharacterPool } from "./remoteCharacterPool.js";
import { createSpeedLines } from "./speedLines.js";
import { initialWobbleState, stepWobble } from "./wobble.js";

const BACKGROUND_COLOR = 0x0b0e14;

/** Standing height (units) the loaded model is rescaled to, a touch taller than the capsule. */
const CHARACTER_VISUAL_HEIGHT = 2 * CAPSULE_BOTTOM_OFFSET + 0.35;

/** How fast (rad/s) the model turns to face its movement direction. */
const FACING_TURN_SPEED = 14;

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
  spinners: SpinnerConfig[];
  props: PropConfig[];
  characterModel: CharacterModel;
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
   */
  applyRemoteCharacters: (characters: Record<string, RenderCharacter>, deltaSeconds: number) => void;
  /** Position the camera on a collision-resolved spring arm around `target`. */
  updateCamera: (target: Vec3, yaw: number, pitch: number) => void;
  /**
   * Rotate every Spinner to its pose at continuous simulation tick `t`
   * (fractional for smooth render-rate rotation). A Spinner's rotation is a
   * pure function of the tick, so it is never carried in `RenderState`.
   */
  updateSpinners: (t: number) => void;
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
   */
  updateCharacterAnimation: (
    deltaSeconds: number,
    moveDirection: Vec3,
    grounded: boolean,
    dashing: boolean,
    dashSpeed: number,
    hitEpoch: number,
    hitReactEpoch: number,
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
  spinners,
  props,
  characterModel,
}: StageConfig): Stage => {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND_COLOR);
  scene.fog = new THREE.Fog(BACKGROUND_COLOR, 30, 110);

  const camera = new THREE.PerspectiveCamera(
    55,
    window.innerWidth / window.innerHeight,
    0.1,
    300,
  );

  const speedLines = createSpeedLines(renderer, scene, camera);

  scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x1b2430, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.7);
  sun.position.set(10, 18, 6);
  scene.add(sun);

  const platformMaterial = new THREE.MeshStandardMaterial({ color: 0x1c2740, roughness: 0.95 });
  const collidables: THREE.Object3D[] = [];
  for (const box of statics) {
    const mesh = boxMesh(box, platformMaterial);
    scene.add(mesh);
    collidables.push(mesh);
  }

  const checkpointMaterial = new THREE.MeshBasicMaterial({
    color: 0x4fd1c5,
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
  });
  for (const cp of checkpoints) {
    scene.add(boxMesh(cp.trigger, checkpointMaterial));
  }

  // Brighter and far more opaque than a Checkpoint's marker: a Checkpoint is
  // ambient reassurance you can miss, a Finish Zone is the thing you are
  // running at, and you have to be able to pick it out down the length of a
  // Track. Both use the same box treatment so they read as the same family
  // of "walk into this" region.
  // Built only when there is something to draw with it: `disposeSceneGraph`
  // reaches materials through the meshes that use them, so a material
  // allocated for an empty list would never be released.
  if (finishZones.length > 0) {
    const finishZoneMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd166,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    });
    for (const zone of finishZones) {
      scene.add(boxMesh(zone.trigger, finishZoneMaterial));
    }
  }

  const spinnerMaterial = new THREE.MeshStandardMaterial({ color: 0xf25c54, roughness: 0.5 });
  const spinnerMeshes = spinners.map((config) => {
    const mesh = boxMesh(
      { center: config.center, halfExtents: { x: config.armLength, y: config.halfHeight, z: config.armRadius } },
      spinnerMaterial,
    );
    scene.add(mesh);
    collidables.push(mesh);
    return mesh;
  });

  const propMaterial = new THREE.MeshStandardMaterial({ color: 0xf2c14e, roughness: 0.6 });
  const propMeshes = props.map((config) => {
    if (config.shape.kind === "box") {
      const mesh = boxMesh({ center: config.center, halfExtents: config.shape.halfExtents }, propMaterial);
      scene.add(mesh);
      collidables.push(mesh);
      return mesh;
    }
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(config.shape.radius, 16, 12), propMaterial);
    mesh.position.set(config.center.x, config.center.y, config.center.z);
    scene.add(mesh);
    collidables.push(mesh);
    return mesh;
  });

  // A faint plane at the kill height so the void reads as a floor, not infinity.
  const killPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshBasicMaterial({ color: 0x05070b, transparent: true, opacity: 0.6 }),
  );
  killPlane.rotation.x = -Math.PI / 2;
  killPlane.position.y = killPlaneY;
  scene.add(killPlane);

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
  const remotePool = createRemoteCharacterPool(scene, characterModel);
  const ragdollPose = createRagdollPose(character);

  const mixer = new THREE.AnimationMixer(characterModel.scene);
  // A knockdown is drawn from the physics ragdoll's own bones (M6.1 ticket
  // 02, ADR 0048), retiring the "Death" clip's double duty — it used to play
  // forward for Ragdoll and in reverse for GettingUp, purely because this rig
  // has no get-up clip. The ragdoll was always simulating underneath for real;
  // now it is what you see, so a Character falls the way it was actually hit.
  const actions = loadCharacterActions(mixer, characterModel.animations);
  const { idle: idleAction, walk: walkAction } = actions;
  let activeAction: THREE.AnimationAction | null = idleAction;
  activeAction?.play();

  /** The last `motionState` seen, to detect the Ragdoll/GettingUp/Controlled edges. */
  let visualState: CharacterMotionState = "Controlled";
  /** Drives the Punch/HitReact one-shot overlays (M6 ticket 03). */
  const hitReactionPlayer = new HitReactionPlayer();

  let wobbleState = initialWobbleState;
  // Seeded lazily on the first updateCharacterAnimation call (null here would
  // otherwise predate applyRenderState placing the Character at its real spawn
  // position, producing a one-frame phantom velocity spike at game start).
  let previousWobblePosition: Vec3 | null = null;

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
    render: () => speedLines.render(),
    applyRenderState: (state) => {
      const { position, motionState } = state.character;
      const fallingRagdoll = motionState === "Ragdoll";
      const gettingUp = motionState === "GettingUp";
      const enteringRagdoll = fallingRagdoll && visualState !== "Ragdoll";
      const enteringGettingUp = gettingUp && visualState !== "GettingUp";
      // Covers both the normal GettingUp → Controlled completion AND a
      // reconciliation snapping straight from Ragdoll to Controlled (the
      // server rejected a knockdown the client mispredicted, skipping the
      // GettingUp frame entirely) — either way the model needs the same
      // hand-back to locomotion, or the Death clip is left stuck mid-pose
      // with no `activeAction` to fade it out from (ticket 08 follow-up).
      const wasDown = isDownMotionState(visualState);
      const leavingDown = !fallingRagdoll && !gettingUp && wasDown;
      visualState = motionState;

      if (fallingRagdoll || gettingUp) {
        // The knockdown is the ragdoll's own, drawn from its eleven bones
        // (M6.1 ticket 02, ADR 0048) — the same bones the simulation already
        // replicates and interpolates, and the same ones GettingUp's own
        // blend fills, so both phases are one path with no clip to wind
        // forward or unwind. `position` is the ragdoll's pelvis while down;
        // seating the rig near it first keeps `apply`'s own correction small.
        if (enteringRagdoll || enteringGettingUp) {
          activeAction?.stop();
          activeAction = null;
          hitReactionPlayer.stop(actions);
        }
        character.position.set(position.x, position.y - RAGDOLL_PELVIS_TO_FEET, position.z);
        ragdollPose.apply(state.character.bones);
      } else if (leavingDown) {
        // Back on its feet: drop the anchor so the next knockdown takes a
        // fresh one, put the rig at the real capsule position, and start idle
        // so the next `updateCharacterAnimation` has a live `activeAction` to
        // cross-fade from instead of the null left behind on the way down.
        ragdollPose.release();
        character.position.set(position.x, position.y - CAPSULE_BOTTOM_OFFSET, position.z);
        const resume = idleAction ?? walkAction;
        if (resume) {
          resume.reset().fadeIn(LOCOMOTION_CROSSFADE_SECONDS).play();
          activeAction = resume;
        }
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
    applyRemoteCharacters: (characters, deltaSeconds) => remotePool.apply(characters, deltaSeconds),
    updateCamera: (target, yaw, pitch) => {
      const desired = springArmPosition(target, yaw, pitch, CAMERA_DISTANCE);
      const resolved = resolveArm(target, desired, castArm, CAMERA_MIN_DISTANCE, CAMERA_SKIN);
      camera.position.set(resolved.x, resolved.y, resolved.z);
      camera.lookAt(target.x, target.y, target.z);
    },
    updateSpinners: (t) => {
      // Recomputed immediately, same reason as the Prop meshes above.
      for (let i = 0; i < spinnerMeshes.length; i += 1) {
        const config = spinners[i]!;
        const q = yawQuat(spinnerAngleAt(config, t));
        const mesh = spinnerMeshes[i]!;
        mesh.quaternion.set(q.x, q.y, q.z, q.w);
        mesh.updateMatrixWorld();
      }
    },
    updateCharacterAnimation: (deltaSeconds, moveDirection, grounded, dashing, dashSpeed, hitEpoch, hitReactEpoch) => {
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

      // While down the bones own the pose outright (M6.1 ticket 02) — and the
      // mixer must not run afterward. `applyRenderState` poses the rig earlier
      // in the same frame than this method is called, so a mixer update here
      // would write over it: three.js restores a bound property to its bind
      // value the moment nothing weighted is driving it, which is exactly the
      // state every action is in once the knockdown faded them out.
      if (isDownMotionState(visualState)) return;

      // M6 ticket 03: Punch/HitReact take priority over ordinary locomotion
      // while playing — the caller (this method) never picks a locomotion
      // clip on a frame where a reaction is still in progress.
      const reacting = hitReactionPlayer.update(hitEpoch, hitReactEpoch, actions, LOCOMOTION_CROSSFADE_SECONDS);
      if (reacting) {
        activeAction = reacting;
        mixer.update(deltaSeconds);
        return;
      }

      const moving = moveDirection.x !== 0 || moveDirection.z !== 0;
      // A Dash with no direction held plays from lastMoveDir (see DashController),
      // so it must still select a locomotion clip even though moveDirection is zero.
      const next = actionFor(selectLocomotion(moving, grounded, dashing), actions);
      activeAction = crossfadeLocomotion(next, activeAction, LOCOMOTION_CROSSFADE_SECONDS);
      mixer.update(deltaSeconds);

      if (moving) {
        const targetYaw = Math.atan2(moveDirection.x, moveDirection.z);
        const delta = THREE.MathUtils.euclideanModulo(targetYaw - character.rotation.y + Math.PI, Math.PI * 2) - Math.PI;
        const maxStep = FACING_TURN_SPEED * deltaSeconds;
        character.rotation.y += THREE.MathUtils.clamp(delta, -maxStep, maxStep);
      }

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
