import {
  CAPSULE_BOTTOM_OFFSET,
  RAGDOLL_BONES,
  spinnerAngleAt,
  yawQuat,
  type Box,
  type Checkpoint,
  type PropConfig,
  type RenderState,
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

const BACKGROUND_COLOR = 0x0b0e14;

/** Standing height (units) the loaded model is rescaled to, a touch taller than the capsule. */
const CHARACTER_VISUAL_HEIGHT = 2 * CAPSULE_BOTTOM_OFFSET + 0.35;

/** How fast (rad/s) the model turns to face its movement direction. */
const FACING_TURN_SPEED = 14;

/** Locomotion clip crossfade duration (s). */
const ANIMATION_CROSSFADE = 0.15;

/** Walk-clip playback-speed multiplier while a Dash burst is active. */
const DASH_WALK_ANIMATION_SPEED = 2.2;

export interface StageConfig {
  statics: Box[];
  checkpoints: Checkpoint[];
  killPlaneY: number;
  spinners: SpinnerConfig[];
  props: PropConfig[];
  characterModel: CharacterModel;
}

export interface Stage {
  domElement: HTMLCanvasElement;
  render: () => void;
  /** Place the Character mesh from an interpolated snapshot. Presentation only (ADR 0009). */
  applyRenderState: (state: RenderState) => void;
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
   * render-rate driven (ADR 0004) — `moveDirection`/`grounded`/`dashing` are
   * read straight from input/the latest snapshot, never fed back into the sim.
   */
  updateCharacterAnimation: (
    deltaSeconds: number,
    moveDirection: Vec3,
    grounded: boolean,
    dashing: boolean,
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

  const characterMaterial = new THREE.MeshStandardMaterial({ color: 0x4fd1c5, roughness: 0.4 });

  // `character` is the runtime placement handle: its position is the capsule's
  // ground-contact point (feet), its rotation.y is the cosmetic facing. The
  // loaded model's own pivot/scale quirks are corrected once, on the child.
  const character = new THREE.Group();
  const naturalBounds = new THREE.Box3().setFromObject(characterModel.scene);
  const naturalHeight = naturalBounds.getSize(new THREE.Vector3()).y;
  const naturalFeetY = naturalBounds.min.y;
  const modelScale = naturalHeight > 0 ? CHARACTER_VISUAL_HEIGHT / naturalHeight : 1;
  characterModel.scene.scale.setScalar(modelScale);
  characterModel.scene.position.y = -naturalFeetY * modelScale;
  character.add(characterModel.scene);
  character.position.y = CAPSULE_BOTTOM_OFFSET; // arbitrary until the first applyRenderState
  scene.add(character);

  const mixer = new THREE.AnimationMixer(characterModel.scene);
  const clipAction = (name: string): THREE.AnimationAction | null => {
    const clip = THREE.AnimationClip.findByName(characterModel.animations, name);
    return clip ? mixer.clipAction(clip) : null;
  };
  const idleAction = clipAction("Idle");
  const walkAction = clipAction("Walk");
  const jumpAction = clipAction("Jump_Idle");
  let activeAction: THREE.AnimationAction | null = idleAction;
  activeAction?.play();

  // One mesh per ragdoll bone, shown only while ragdolling / getting up.
  const boneMeshes = RAGDOLL_BONES.map((spec) => {
    const mesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(spec.radius, spec.halfHeight * 2, 4, 8),
      spec.name === "head"
        ? new THREE.MeshStandardMaterial({ color: 0xf0f4f8, roughness: 0.5 })
        : characterMaterial,
    );
    mesh.visible = false;
    scene.add(mesh);
    return mesh;
  });

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
  });

  return {
    domElement: renderer.domElement,
    render: () => renderer.render(scene, camera),
    applyRenderState: (state) => {
      const { position, bones } = state.character;
      const ragdolling = bones.length > 0;

      character.visible = !ragdolling;
      if (!ragdolling) {
        // `position` is the capsule centre; the model rig is placed at the feet.
        character.position.set(position.x, position.y - CAPSULE_BOTTOM_OFFSET, position.z);
      }

      for (let i = 0; i < boneMeshes.length; i += 1) {
        const mesh = boneMeshes[i]!;
        const bone = bones[i];
        mesh.visible = bone !== undefined;
        if (bone) {
          mesh.position.set(bone.position.x, bone.position.y, bone.position.z);
          mesh.quaternion.set(bone.rotation.x, bone.rotation.y, bone.rotation.z, bone.rotation.w);
        }
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
    updateCharacterAnimation: (deltaSeconds, moveDirection, grounded, dashing) => {
      const moving = moveDirection.x !== 0 || moveDirection.z !== 0;
      // A Dash with no direction held plays from lastMoveDir (see DashController),
      // so it must still select the Walk clip even though moveDirection is zero.
      const next = grounded ? (moving || dashing ? walkAction : idleAction) : jumpAction;
      if (next && next !== activeAction) {
        next.reset().fadeIn(ANIMATION_CROSSFADE).play();
        activeAction?.fadeOut(ANIMATION_CROSSFADE);
        activeAction = next;
      }
      if (walkAction) walkAction.timeScale = dashing ? DASH_WALK_ANIMATION_SPEED : 1;
      mixer.update(deltaSeconds);

      if (moving) {
        const targetYaw = Math.atan2(moveDirection.x, moveDirection.z);
        const delta = THREE.MathUtils.euclideanModulo(targetYaw - character.rotation.y + Math.PI, Math.PI * 2) - Math.PI;
        const maxStep = FACING_TURN_SPEED * deltaSeconds;
        character.rotation.y += THREE.MathUtils.clamp(delta, -maxStep, maxStep);
      }
    },
  };
};
