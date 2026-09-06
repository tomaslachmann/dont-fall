import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/**
 * MushroomKing from Quaternius' "Ultimate Platformer Pack" (CC0) —
 * apps/client/public/models/MushroomKing.gltf. A single self-contained glTF
 * (embedded buffer + texture), rigged with a skeleton and named animation
 * clips (Idle, Walk, Jump_Idle, …).
 */
const MODEL_URL = "/models/MushroomKing.gltf";

export interface CharacterModel {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}

export const loadCharacterModel = async (): Promise<CharacterModel> => {
  const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
  return { scene: gltf.scene, animations: gltf.animations };
};
