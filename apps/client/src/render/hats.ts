import { hatById, type HatDef } from "@dont-fall/shared";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { hatModelUrl } from "../lib/hatAssets.js";

/**
 * The bone a hat sits on (ADR 0083). Each hat is authored in this bone's own
 * frame, so it goes on with no offset, turn or scale of its own and follows
 * the head through every clip, the knockdown included.
 */
export const HAT_BONE = "head";

/** The body's morph target that pulls BLIP's crest down into the head, for a hat that covers it. */
export const HAT_TUCK_MORPH = "Hat_Tuck";

/** `userData` key on a worn hat's root, holding its id — what a tint and a rig teardown leave alone. */
const WORN_HAT_KEY = "wornHat";

/** Whether `object` is the root of a worn hat. */
export const isWornHat = (object: THREE.Object3D): boolean => object.userData[WORN_HAT_KEY] !== undefined;

/** Loads one hat's model. Injected in tests, which read the files from disk. */
export type LoadHatModel = (url: string) => Promise<THREE.Object3D>;

const loadWithGltf: LoadHatModel = async (url) => (await new GLTFLoader().loadAsync(url)).scene;

const findHead = (rig: THREE.Object3D): THREE.Bone | undefined => {
  let head: THREE.Bone | undefined;
  rig.traverse((object) => {
    if (!head && (object as THREE.Bone).isBone && object.name === HAT_BONE) head = object as THREE.Bone;
  });
  return head;
};

const setCrestTuck = (rig: THREE.Object3D, weight: number): void => {
  rig.traverse((object) => {
    const mesh = object as THREE.Mesh;
    const index = mesh.morphTargetDictionary?.[HAT_TUCK_MORPH];
    if (index !== undefined && mesh.morphTargetInfluences) mesh.morphTargetInfluences[index] = weight;
  });
};

/** The id of the hat `rig` has on right now, or `null`. A hat still loading isn't on yet. */
export const wornHatId = (rig: THREE.Object3D): string | null => {
  const worn = findHead(rig)?.children.find(isWornHat);
  return worn ? (worn.userData[WORN_HAT_KEY] as string) : null;
};

const takeOff = (rig: THREE.Object3D): void => {
  const head = findHead(rig);
  for (const worn of head?.children.filter(isWornHat) ?? []) worn.removeFromParent();
  setCrestTuck(rig, 0);
};

/** Frees a loaded hat model. Only the wardrobe that loaded it may: every worn copy shares its geometry and materials. */
const disposeModel = (model: THREE.Object3D): void => {
  model.traverse((object) => {
    const mesh = object as Partial<THREE.Mesh>;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials) material.dispose();
  });
};

/**
 * Puts hats on rigs (ADR 0083). One per renderer: the match's Stage has one,
 * each Character preview has its own.
 *
 * - **Loaded once, worn many times.** Each hat's model is fetched the first
 *   time anyone wears it. Every rig wearing it gets a copy that shares its
 *   geometry and materials, so tinting a rig and tearing one down must leave
 *   a worn hat alone (`isWornHat`).
 * - **The latest choice wins.** A hat still loading goes on only if it is
 *   still what that rig should wear when it arrives.
 * - **Anything that isn't a hat is no hat**, and so is a hat whose model
 *   failed to load. The Character is drawn bareheaded, never not at all.
 * - **A rig copied from a hatted rig** (`SkeletonUtils.clone`) copies its
 *   hat too. Its first `wear` takes that copy off at once, so it never shows
 *   someone else's hat while its own loads. After that, a hat being swapped
 *   stays on until the next one arrives.
 */
export interface Wardrobe {
  /** Dresses `rig` in `hat` (an id from shared's `HATS`), or takes its hat off for `null`. Cheap to repeat. */
  wear: (rig: THREE.Object3D, hat: string | null) => void;
  /** Frees every loaded model. Hats still loading never go on after this. */
  dispose: () => void;
}

export interface WardrobeOptions {
  load?: LoadHatModel;
  /** Called on each hat as it goes on. The Stage makes it a shadow caster like the rig under it. */
  prepare?: (hat: THREE.Object3D) => void;
}

export const createWardrobe = ({ load = loadWithGltf, prepare }: WardrobeOptions = {}): Wardrobe => {
  const models = new Map<string, Promise<THREE.Object3D | null>>();
  const wanted = new WeakMap<THREE.Object3D, string | null>();
  let disposed = false;

  const modelFor = (hat: HatDef): Promise<THREE.Object3D | null> => {
    let model = models.get(hat.id);
    if (!model) {
      model = load(hatModelUrl(hat.id)).catch((err: unknown) => {
        console.warn(`Hat "${hat.id}" could not be loaded; worn as no hat`, err);
        return null;
      });
      models.set(hat.id, model);
    }
    return model;
  };

  const putOn = (rig: THREE.Object3D, hat: HatDef, model: THREE.Object3D): void => {
    const head = findHead(rig);
    if (!head) return;
    takeOff(rig);
    const worn = model.clone(true);
    worn.userData[WORN_HAT_KEY] = hat.id;
    prepare?.(worn);
    head.add(worn);
    setCrestTuck(rig, hat.coversCrest ? 1 : 0);
  };

  return {
    wear: (rig, id) => {
      if (disposed) return;
      const hat = hatById(id);
      const next = hat?.id ?? null;
      const first = !wanted.has(rig);
      if (!first && wanted.get(rig) === next) return;
      wanted.set(rig, next);
      if (!hat || first) takeOff(rig);
      if (!hat) return;
      void modelFor(hat).then((model) => {
        if (disposed || wanted.get(rig) !== hat.id) return;
        if (model) putOn(rig, hat, model);
        else takeOff(rig);
      });
    },
    dispose: () => {
      disposed = true;
      for (const model of models.values()) {
        void model.then((loaded) => {
          if (loaded) disposeModel(loaded);
        });
      }
      models.clear();
    },
  };
};
