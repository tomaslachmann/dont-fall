// PROTOTYPE — the new fan, prepared in the browser the way a converter would do it for real:
// Blender's leftover default cube dropped, seated on y = 0, and the rotor cut out of the one fused
// mesh (triangles whose centre lies inside radius 0.64 and above y 0.30 — the user's pick after
// comparing 0.62 / 0.64 / 0.66 / 0.70 offline) so it can spin on its own.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export const ROTOR_RADIUS = 0.64;
export const ROTOR_ABOVE_Y = 0.3;

export interface Fan {
  root: THREE.Group;
  rotor: THREE.Mesh;
  /** Height of the fan's top face once seated. */
  top: number;
  /** Height of the rotor's top once seated — where the air leaves the fan. */
  mouthY: number;
  /** How wide the mouth the air leaves through is (the rotor's own reach). */
  mouthRadius: number;
}

export const loadFan = async (): Promise<Fan> => {
  const url = new URL("../../../../assets/Meshy_fan/fan_lower_poly.glb", import.meta.url).href;
  const gltf = await new GLTFLoader().loadAsync(url);
  // Only `Mesh_0` is the fan; the file also carries Blender's default `Cube`, which is dropped here.
  const source = gltf.scene.getObjectByName("Mesh_0") as THREE.Mesh | undefined;
  if (!source) throw new Error("fan_lower_poly.glb: no Mesh_0");
  const geometry = source.geometry;
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex()!;

  const housing: number[] = [];
  const rotor: number[] = [];
  for (let t = 0; t < index.count; t += 3) {
    const a = index.getX(t), b = index.getX(t + 1), c = index.getX(t + 2);
    const cx = (position.getX(a) + position.getX(b) + position.getX(c)) / 3;
    const cy = (position.getY(a) + position.getY(b) + position.getY(c)) / 3;
    const cz = (position.getZ(a) + position.getZ(b) + position.getZ(c)) / 3;
    (Math.hypot(cx, cz) < ROTOR_RADIUS && cy > ROTOR_ABOVE_Y ? rotor : housing).push(a, b, c);
  }

  geometry.computeBoundingBox();
  const bottom = geometry.boundingBox!.min.y;
  const top = geometry.boundingBox!.max.y - bottom;

  const housingGeometry = geometry.clone();
  housingGeometry.setIndex(housing);
  const rotorGeometry = geometry.clone();
  rotorGeometry.setIndex(rotor);
  // Spin about the rotor's own centre, not the mesh origin. The bounding box of an indexed
  // clone still covers every vertex, so measure the rotor's own triangles instead.
  const rotorBox = new THREE.Box3();
  const corner = new THREE.Vector3();
  for (const i of rotor) rotorBox.expandByPoint(corner.fromBufferAttribute(position, i));
  const axis = rotorBox.getCenter(new THREE.Vector3());
  rotorGeometry.translate(-axis.x, 0, -axis.z);

  const material = source.material as THREE.Material;
  const root = new THREE.Group();
  const housingMesh = new THREE.Mesh(housingGeometry, material);
  const rotorMesh = new THREE.Mesh(rotorGeometry, material);
  rotorMesh.position.set(axis.x, 0, axis.z);
  root.add(housingMesh, rotorMesh);
  for (const mesh of [housingMesh, rotorMesh]) {
    mesh.position.y -= bottom;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  }
  return {
    root,
    rotor: rotorMesh,
    top,
    mouthY: rotorBox.max.y - bottom,
    mouthRadius: Math.max(rotorBox.max.x - axis.x, rotorBox.max.z - axis.z),
  };
};
