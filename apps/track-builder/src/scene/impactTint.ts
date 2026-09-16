import {
  motionTwist,
  MOVING_SEGMENT_RAGDOLL_SPEED,
  MOVING_SEGMENT_STAGGER_SPEED,
  movingSegmentPose,
  segmentOrientation,
  segmentScale,
  SURFACE_GROUND_NORMAL_MIN_Y,
  type Segment,
} from "@dont-fall/shared";
import * as THREE from "three";

const vertexShader = /* glsl */ `
  uniform vec3 uLinear;
  uniform vec3 uAngular;
  uniform vec3 uOrigin;
  varying float vClosing;
  varying float vUp;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec3 n = normalize(mat3(modelMatrix) * normal);
    vec3 v = uLinear + cross(uAngular, world.xyz - uOrigin);
    vClosing = dot(v, n);
    vUp = n.y;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uStagger;
  uniform float uRagdoll;
  uniform float uFloor;
  uniform float uSpiked;
  varying float vClosing;
  varying float vUp;
  void main() {
    vec3 color = vec3(0.13, 0.77, 0.37);
    bool floorFace = vUp > uFloor;
    if (uSpiked > 0.5 || (!floorFace && vClosing >= uRagdoll)) color = vec3(0.94, 0.27, 0.27);
    else if (!floorFace && vClosing >= uStagger) color = vec3(0.98, 0.8, 0.08);
    gl_FragColor = vec4(color, 0.5);
  }
`;

/**
 * One Segment's Impact tint (M11 ticket 07, ADR 0061): an overlay on each of
 * its solid meshes coloured by what a Character standing in the way would
 * take there right now — green pushes or carries, yellow staggers, red knocks
 * down — using the simulation's own rule: the surface's velocity along its
 * outward normal is the closing speed, a face pointing up is a floor (ridden,
 * never a hit), and the speed bands are `MOVING_SEGMENT_*_SPEED`, derived from
 * the same thresholds the simulation's Impact goes through. Spiked is always red.
 */
export interface ImpactTint {
  readonly material: THREE.ShaderMaterial;
  /** Refresh the velocity uniforms for `segment` at simulation tick `tick`. */
  update: (segment: Segment, tick: number) => void;
  dispose: () => void;
}

const isSolidMesh = (object: THREE.Object3D): object is THREE.Mesh => {
  const mesh = object as THREE.Mesh;
  if (!mesh.isMesh) return false;
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return materials.every((m) => !(m as THREE.MeshBasicMaterial).wireframe);
};

/** Overlay every solid mesh under `root` (collected first, so overlays never overlay themselves). */
export const addImpactTint = (root: THREE.Object3D, spiked: boolean): ImpactTint => {
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    uniforms: {
      uLinear: { value: new THREE.Vector3() },
      uAngular: { value: new THREE.Vector3() },
      uOrigin: { value: new THREE.Vector3() },
      uStagger: { value: MOVING_SEGMENT_STAGGER_SPEED },
      uRagdoll: { value: MOVING_SEGMENT_RAGDOLL_SPEED },
      uFloor: { value: SURFACE_GROUND_NORMAL_MIN_Y },
      uSpiked: { value: spiked ? 1 : 0 },
    },
  });
  const solids: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (isSolidMesh(object)) solids.push(object);
  });
  for (const mesh of solids) {
    const overlay = new THREE.Mesh(mesh.geometry, material);
    overlay.userData.impactTint = true;
    // Presentation only: never what a click on the viewport picks.
    overlay.raycast = () => {};
    mesh.add(overlay);
  }
  return {
    material,
    update(segment, tick) {
      const motion = segment.motion;
      if (!motion) return;
      const config = { position: segment.position, orientation: segmentOrientation(segment), scale: segmentScale(segment), motion };
      const twist = motionTwist((t) => movingSegmentPose(config, t), tick);
      (material.uniforms.uLinear!.value as THREE.Vector3).set(twist.linear.x, twist.linear.y, twist.linear.z);
      (material.uniforms.uAngular!.value as THREE.Vector3).set(twist.angular.x, twist.angular.y, twist.angular.z);
      (material.uniforms.uOrigin!.value as THREE.Vector3).set(twist.origin.x, twist.origin.y, twist.origin.z);
    },
    dispose() {
      material.dispose();
    },
  };
};
