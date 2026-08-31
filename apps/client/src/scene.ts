import {
  CAPSULE_HALF_HEIGHT,
  CAPSULE_RADIUS,
  type RenderState,
  type StaticBox,
  type Vec3,
} from "@dont-fall/shared";
import * as THREE from "three";
import {
  CAMERA_DISTANCE,
  CAMERA_MIN_DISTANCE,
  CAMERA_SKIN,
  resolveArm,
  springArmPosition,
} from "./camera/springArm.js";

const BACKGROUND_COLOR = 0x0b0e14;

export interface Stage {
  domElement: HTMLCanvasElement;
  render: () => void;
  /** Place the Character mesh from an interpolated snapshot. Presentation only (ADR 0009). */
  applyRenderState: (state: RenderState) => void;
  /** Position the camera on a collision-resolved spring arm around `target`. */
  updateCamera: (target: Vec3, yaw: number, pitch: number) => void;
}

const boxMesh = (box: StaticBox): THREE.Mesh => {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(box.halfExtents.x * 2, box.halfExtents.y * 2, box.halfExtents.z * 2),
    new THREE.MeshStandardMaterial({ color: 0x1c2740, roughness: 0.95 }),
  );
  mesh.position.set(box.center.x, box.center.y, box.center.z);
  return mesh;
};

/** Builds the Three.js stage from the simulation's static geometry plus a Character capsule. */
export const createStage = (statics: StaticBox[]): Stage => {
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

  const collidables: THREE.Object3D[] = [];
  for (const box of statics) {
    const mesh = boxMesh(box);
    scene.add(mesh);
    collidables.push(mesh);
  }
  scene.add(new THREE.GridHelper(50, 50, 0x2a3547, 0x18202e));

  const character = new THREE.Mesh(
    new THREE.CapsuleGeometry(CAPSULE_RADIUS, CAPSULE_HALF_HEIGHT * 2, 6, 14),
    new THREE.MeshStandardMaterial({ color: 0x4fd1c5, roughness: 0.4 }),
  );
  scene.add(character);

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
      character.position.set(
        state.character.position.x,
        state.character.position.y,
        state.character.position.z,
      );
    },
    updateCamera: (target, yaw, pitch) => {
      const desired = springArmPosition(target, yaw, pitch, CAMERA_DISTANCE);
      const resolved = resolveArm(target, desired, castArm, CAMERA_MIN_DISTANCE, CAMERA_SKIN);
      camera.position.set(resolved.x, resolved.y, resolved.z);
      camera.lookAt(target.x, target.y, target.z);
    },
  };
};
