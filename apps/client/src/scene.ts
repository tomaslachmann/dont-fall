import {
  CAPSULE_BOTTOM_OFFSET,
  CAPSULE_HALF_HEIGHT,
  CAPSULE_RADIUS,
  DASH_SPEED,
  GETUP_MS,
  RAGDOLL_BONES,
  spinnerAngleAt,
  yawQuat,
  type Box,
  type CharacterMotionState,
  type Checkpoint,
  type PropConfig,
  type PropSnapshot,
  type RenderCharacter,
  type SpinnerConfig,
  type Vec3,
} from "@dont-fall/shared";
import * as THREE from "three";
import type { CharacterModel } from "./characterModel.js";
import {
  CAMERA_DISTANCE,
  CAMERA_MIN_DISTANCE,
  CAMERA_SKIN,
  resolveArm,
  springArmPosition,
} from "./camera/springArm.js";
import { createSpeedLines } from "./speedLines.js";
import { initialWobbleState, stepWobble } from "./wobble.js";

const BACKGROUND_COLOR = 0x0b0e14;

/** Standing height (units) the loaded model is rescaled to, a touch taller than the capsule. */
const CHARACTER_VISUAL_HEIGHT = 2 * CAPSULE_BOTTOM_OFFSET + 0.35;

/** How fast (rad/s) the model turns to face its movement direction. */
const FACING_TURN_SPEED = 14;

/** Locomotion clip crossfade duration (s). */
const ANIMATION_CROSSFADE = 0.15;

/**
 * Procedural Wobble lean (ticket 07), temporarily OFF. It derives acceleration
 * from render-frame `character.position` deltas, which a predicted + reconciled
 * Character (M2) delivers unevenly — fixed 30 Hz prediction ticks sampled at a
 * variable render rate, plus reconciliation snaps — so it reads as a micro-stutter
 * / "lag" while just walking. Re-enable once it's driven from a simulation-owned
 * velocity instead of position deltas (the same fix speed-lines already got).
 */
const WOBBLE_ENABLED = false;

/**
 * Vertical distance from the ragdoll's pelvis (its `RenderState.character.position`
 * while Ragdoll/GettingUp) down to the feet — the pelvis rest offset from the
 * capsule centre plus the capsule's own centre-to-feet distance. Lets the
 * Ragdoll collapse anchor be derived from the pelvis alone, correct whether it
 * came from a live Impact or a Fall's Respawn teleport (both activate the
 * ragdoll the same way, at the capsule-centre convention).
 */
const RAGDOLL_PELVIS_TO_FEET = CAPSULE_BOTTOM_OFFSET + RAGDOLL_BONES.find((b) => b.name === "pelvis")!.restCenter.y;

export interface StageConfig {
  statics: Box[];
  checkpoints: Checkpoint[];
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
   * Place every OTHER player's Character (ticket 04), keyed by session ID and
   * interpolated from server snapshots — never predicted (ADR 0003). Meshes
   * are pooled per ID and removed when an ID drops out of the set (a
   * disconnect). Drawn as a plain tinted capsule, tipped over while the player
   * is Ragdoll/GettingUp so a Bump reads at a glance.
   */
  applyRemoteCharacters: (characters: Record<string, RenderCharacter>) => void;
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
   * position, so it is immune to reconciliation noise/pops.
   */
  updateCharacterAnimation: (
    deltaSeconds: number,
    moveDirection: Vec3,
    grounded: boolean,
    dashing: boolean,
    dashSpeed: number,
  ) => void;
}

const boxMesh = (box: Box, material: THREE.Material): THREE.Mesh => {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(box.halfExtents.x * 2, box.halfExtents.y * 2, box.halfExtents.z * 2),
    material,
  );
  mesh.position.set(box.center.x, box.center.y, box.center.z);
  return mesh;
};

export const createStage = ({
  statics,
  checkpoints,
  killPlaneY,
  spinners,
  props,
  characterModel,
}: StageConfig): Stage => {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

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
    scene.add(boxMesh(cp.volume, checkpointMaterial));
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

  // Other players (ticket 04): one pooled capsule per session ID. Kept
  // deliberately plain — a different silhouette from the local MushroomKing so
  // "that's someone else" reads instantly, and cheap enough to scale toward
  // ADR 0011's 12-player ceiling without cloning a skinned rig per player.
  const remoteGeometry = new THREE.CapsuleGeometry(CAPSULE_RADIUS, CAPSULE_HALF_HEIGHT * 2, 6, 12);
  const remoteMaterial = new THREE.MeshStandardMaterial({ color: 0x6ab0ff, roughness: 0.7 });
  const remoteMeshes = new Map<string, THREE.Mesh>();

  const mixer = new THREE.AnimationMixer(characterModel.scene);
  const clipAction = (name: string): THREE.AnimationAction | null => {
    const clip = THREE.AnimationClip.findByName(characterModel.animations, name);
    return clip ? mixer.clipAction(clip) : null;
  };
  const idleAction = clipAction("Idle");
  const walkAction = clipAction("Walk");
  const runAction = clipAction("Run");
  const jumpAction = clipAction("Jump_Idle");
  // MushroomKing's own "Death" clip doubles for both Ragdoll and GettingUp:
  // played forward (then held on the last frame) the moment the Character goes
  // down, and in reverse to stand back up — no compatible dedicated "get up"
  // clip exists for this rig (see the Universal Animation Library skeleton
  // mismatch noted ahead of ticket 07). The physics ragdoll still simulates
  // underneath for real (Impact response, settle position); only its capsule-
  // bone visualisation is replaced by this animated model.
  const deathAction = clipAction("Death");
  if (deathAction) {
    deathAction.setLoop(THREE.LoopOnce, 1);
    deathAction.clampWhenFinished = true;
  }
  let activeAction: THREE.AnimationAction | null = idleAction;
  activeAction?.play();

  /** The last `motionState` seen, to detect the Ragdoll/GettingUp/Controlled edges. */
  let visualState: CharacterMotionState = "Controlled";

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

  window.addEventListener("resize", () => {
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
      const wasDown = visualState === "Ragdoll" || visualState === "GettingUp";
      const leavingDown = !fallingRagdoll && !gettingUp && wasDown;
      visualState = motionState;

      if (enteringRagdoll && deathAction) {
        // Freeze the model at the impact point, converting the ragdoll's pelvis
        // (what `position` is while Ragdoll/GettingUp) down to the feet — this
        // holds whether the ragdoll was just activated by a live Impact or by a
        // Fall's Respawn teleport, since both activate it the same way. The
        // physics ragdoll still simulates for real underneath (Impact response,
        // settle position); only its visual is this canned collapse instead of
        // the bone puppet.
        character.position.set(position.x, position.y - RAGDOLL_PELVIS_TO_FEET, position.z);
        activeAction?.fadeOut(0);
        activeAction = null;
        deathAction.reset();
        deathAction.timeScale = 1;
        deathAction.play();
      } else if (enteringGettingUp && deathAction) {
        // Reverse from wherever the forward collapse actually got to — Ragdoll
        // can end (settled, or RAGDOLL_MAX_MS) before the Death clip finishes
        // playing forward, and snapping to the final frame here would pop the
        // pose. Scaled to land back on Controlled within GETUP_MS regardless.
        const fallen = deathAction.time;
        deathAction.timeScale = fallen > 0 ? -fallen / (GETUP_MS / 1000) : -1;
        deathAction.paused = false;
      } else if (leavingDown) {
        // Fully hand the model back to locomotion — stop the Death clip, place
        // the rig at the real capsule position, and start idle so the next
        // `updateCharacterAnimation` has a live `activeAction` to cross-fade
        // from instead of a null it left behind on the way into Ragdoll (ticket 08).
        deathAction?.stop();
        character.position.set(position.x, position.y - CAPSULE_BOTTOM_OFFSET, position.z);
        const resume = idleAction ?? walkAction;
        if (resume) {
          resume.reset().fadeIn(ANIMATION_CROSSFADE).play();
          activeAction = resume;
        }
      } else if (!fallingRagdoll && !gettingUp) {
        // `position` is the capsule centre; the model rig is placed at the feet.
        character.position.set(position.x, position.y - CAPSULE_BOTTOM_OFFSET, position.z);
      }
      // While Ragdoll/GettingUp continue, `character` stays put at the frozen anchor.

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
    applyRemoteCharacters: (characters) => {
      for (const [id, rc] of Object.entries(characters)) {
        let mesh = remoteMeshes.get(id);
        if (!mesh) {
          mesh = new THREE.Mesh(remoteGeometry, remoteMaterial);
          scene.add(mesh);
          remoteMeshes.set(id, mesh);
        }
        const down = rc.motionState === "Ragdoll" || rc.motionState === "GettingUp";
        // `position` is the capsule centre while upright and the ragdoll pelvis
        // (near the ground) while down — so tipping the capsule flat and
        // dropping it to that lower point reads correctly as a floored body.
        mesh.position.set(rc.position.x, rc.position.y, rc.position.z);
        mesh.rotation.z = down ? Math.PI / 2 : 0;
        mesh.updateMatrixWorld();
      }
      for (const [id, mesh] of remoteMeshes) {
        if (!(id in characters)) {
          scene.remove(mesh);
          remoteMeshes.delete(id);
        }
      }
    },
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
    updateCharacterAnimation: (deltaSeconds, moveDirection, grounded, dashing, dashSpeed) => {
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

      // Ragdoll (forward Death) and GettingUp (reverse Death) are both driven
      // from applyRenderState and fully own the model's pose while they hold.
      if (visualState === "Ragdoll" || visualState === "GettingUp") {
        mixer.update(deltaSeconds);
        return;
      }

      const moving = moveDirection.x !== 0 || moveDirection.z !== 0;
      // A Dash with no direction held plays from lastMoveDir (see DashController),
      // so it must still select a locomotion clip even though moveDirection is zero.
      const locomotion = dashing ? (runAction ?? walkAction) : walkAction;
      const next = grounded ? (moving || dashing ? locomotion : idleAction) : jumpAction;
      if (next && next !== activeAction) {
        next.reset().fadeIn(ANIMATION_CROSSFADE).play();
        activeAction?.fadeOut(ANIMATION_CROSSFADE);
        activeAction = next;
      }
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
  };
};
