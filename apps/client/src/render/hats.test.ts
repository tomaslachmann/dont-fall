import * as fs from "node:fs";
import * as path from "node:path";
import { HATS } from "@dont-fall/shared";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneRig } from "three/addons/utils/SkeletonUtils.js";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createWardrobe,
  HAT_BONE,
  HAT_TUCK_MORPH,
  isWornHat,
  wornHatId,
  type LoadHatModel,
} from "./hats.js";
import { hatIconUrl, hatModelUrl } from "../lib/hatAssets.js";
import { tintModel } from "./playerTint.js";

const PUBLIC = path.resolve(import.meta.dirname, "../../public");

/** Parses a served GLB straight off disk — an exact copy, never `Buffer.buffer` (see `modelBones.test.ts`). */
const parseGlb = async (url: string) => {
  const raw = fs.readFileSync(path.join(PUBLIC, url));
  const exact = new Uint8Array(raw.byteLength);
  exact.set(raw);
  return new GLTFLoader().parseAsync(exact.buffer, "");
};

/** The wardrobe's loader, reading the real files — counted, so a test can see what was fetched. */
const diskLoader = () => vi.fn<LoadHatModel>(async (url) => (await parseGlb(url)).scene);

/** Lets every pending load settle and its hat go on. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

let blip: THREE.Object3D;
beforeAll(async () => {
  blip = (await parseGlb("/models/BLIP.glb")).scene;
});

/** A fresh BLIP, the way the pool makes remote rigs. */
const rig = () => cloneRig(blip);

const crestTuck = (root: THREE.Object3D): number[] => {
  const weights: number[] = [];
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    const index = mesh.morphTargetDictionary?.[HAT_TUCK_MORPH];
    if (index !== undefined) weights.push(mesh.morphTargetInfluences![index]!);
  });
  return weights;
};

const head = (root: THREE.Object3D) => root.getObjectByName(HAT_BONE)!;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the hat files (ADR 0083)", () => {
  it("serves a model and an icon for every hat in the catalog", () => {
    for (const hat of HATS) {
      expect(fs.existsSync(path.join(PUBLIC, hatModelUrl(hat.id))), hat.id).toBe(true);
      expect(fs.existsSync(path.join(PUBLIC, hatIconUrl(hat.id))), hat.id).toBe(true);
    }
  });

  it.each(HATS.map((hat) => hat.id))("%s is one rigid piece with no textures to fetch", async (id) => {
    const { scene } = await parseGlb(hatModelUrl(id));
    let meshes = 0;
    scene.traverse((object) => {
      expect((object as THREE.SkinnedMesh).isSkinnedMesh ?? false).toBe(false);
      expect((object as THREE.Bone).isBone ?? false).toBe(false);
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      meshes += 1;
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        expect((material as THREE.MeshStandardMaterial).map ?? null).toBeNull();
      }
    });
    expect(meshes).toBeGreaterThan(0);
    // Authored in the head bone's frame: nothing to add on the way on.
    expect(scene.position.length()).toBe(0);
  });

  it("gives BLIP a head bone and a crest tuck, at rest", () => {
    expect((head(blip) as THREE.Bone).isBone).toBe(true);
    expect(crestTuck(blip)).toEqual([0]);
  });
});

describe("createWardrobe (ADR 0083)", () => {
  it("puts a hat on the head bone and tucks the crest under it", async () => {
    const wardrobe = createWardrobe({ load: diskLoader() });
    const bean = rig();

    wardrobe.wear(bean, "cone");
    await settle();

    expect(wornHatId(bean)).toBe("cone");
    expect(head(bean).children.filter(isWornHat)).toHaveLength(1);
    expect(crestTuck(bean)).toEqual([1]);
  });

  it("leaves the crest showing under the crown", async () => {
    const wardrobe = createWardrobe({ load: diskLoader() });
    const bean = rig();

    wardrobe.wear(bean, "crown");
    await settle();

    expect(wornHatId(bean)).toBe("crown");
    expect(crestTuck(bean)).toEqual([0]);
  });

  it("swaps one hat for another — never two at once — and takes it off for none", async () => {
    const wardrobe = createWardrobe({ load: diskLoader() });
    const bean = rig();

    wardrobe.wear(bean, "cone");
    await settle();
    wardrobe.wear(bean, "crown");
    await settle();
    expect(head(bean).children.filter(isWornHat).map((hat) => hat.userData.wornHat)).toEqual(["crown"]);

    wardrobe.wear(bean, null);
    expect(wornHatId(bean)).toBeNull();
    expect(crestTuck(bean)).toEqual([0]);
  });

  it("fetches a hat once, however many rigs wear it, and shares its geometry between them", async () => {
    const load = diskLoader();
    const wardrobe = createWardrobe({ load });
    const [a, b] = [rig(), rig()];

    wardrobe.wear(a, "pot");
    wardrobe.wear(b, "pot");
    wardrobe.wear(a, "pot");
    await settle();

    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith("/models/hats/pot.glb");
    const meshOf = (root: THREE.Object3D) => head(root).children.find(isWornHat)!.getObjectByProperty("isMesh", true) as THREE.Mesh;
    expect(meshOf(a).geometry).toBe(meshOf(b).geometry);
    expect(meshOf(a)).not.toBe(meshOf(b));
  });

  it("puts on only the latest choice when an earlier hat arrives late", async () => {
    let releaseCone!: () => void;
    const load = vi.fn<LoadHatModel>(async (url) => {
      if (url.endsWith("cone.glb")) await new Promise<void>((resolve) => (releaseCone = resolve));
      return (await parseGlb(url)).scene;
    });
    const wardrobe = createWardrobe({ load });
    const bean = rig();

    wardrobe.wear(bean, "cone");
    wardrobe.wear(bean, "bucket");
    await settle();
    releaseCone();
    await settle();

    expect(wornHatId(bean)).toBe("bucket");
    expect(head(bean).children.filter(isWornHat)).toHaveLength(1);
  });

  it("wears no hat for an id it doesn't know, or for a hat that failed to load", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const wardrobe = createWardrobe({ load: vi.fn<LoadHatModel>(async () => Promise.reject(new Error("404"))) });
    const bean = rig();

    wardrobe.wear(bean, "top-hat");
    expect(wornHatId(bean)).toBeNull();

    wardrobe.wear(bean, "ufo");
    await settle();
    expect(wornHatId(bean)).toBeNull();
    expect(crestTuck(bean)).toEqual([0]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("takes a copied hat off a rig cloned from a hatted one, and leaves the original's alone", async () => {
    const wardrobe = createWardrobe({ load: diskLoader() });
    const local = rig();
    wardrobe.wear(local, "ufo");
    await settle();

    const remote = cloneRig(local);
    expect(wornHatId(remote)).toBe("ufo");
    wardrobe.wear(remote, null);

    expect(wornHatId(remote)).toBeNull();
    expect(crestTuck(remote)).toEqual([0]);
    expect(wornHatId(local)).toBe("ufo");
    expect(crestTuck(local)).toEqual([1]);
  });

  it("never shows a clone the hat it was copied with while its own hat loads", async () => {
    let release!: () => void;
    const load = vi.fn<LoadHatModel>(async (url) => {
      if (url.endsWith("crown.glb")) await new Promise<void>((resolve) => (release = resolve));
      return (await parseGlb(url)).scene;
    });
    const wardrobe = createWardrobe({ load });
    const local = rig();
    wardrobe.wear(local, "ufo");
    await settle();

    const remote = cloneRig(local);
    wardrobe.wear(remote, "crown");
    expect(wornHatId(remote)).toBeNull();
    expect(crestTuck(remote)).toEqual([0]);

    release();
    await settle();
    expect(wornHatId(remote)).toBe("crown");
  });

  it("keeps the old hat on while a swapped-in one loads", async () => {
    let release!: () => void;
    const load = vi.fn<LoadHatModel>(async (url) => {
      if (url.endsWith("bucket.glb")) await new Promise<void>((resolve) => (release = resolve));
      return (await parseGlb(url)).scene;
    });
    const wardrobe = createWardrobe({ load });
    const bean = rig();
    wardrobe.wear(bean, "pot");
    await settle();

    wardrobe.wear(bean, "bucket");
    expect(wornHatId(bean)).toBe("pot");

    release();
    await settle();
    expect(wornHatId(bean)).toBe("bucket");
  });

  it("marks each hat as it goes on", async () => {
    const prepare = vi.fn((hat: THREE.Object3D) => hat.traverse((object) => (object.castShadow = true)));
    const wardrobe = createWardrobe({ load: diskLoader(), prepare });
    const bean = rig();

    wardrobe.wear(bean, "cone");
    await settle();

    expect(prepare).toHaveBeenCalledTimes(1);
    expect(head(bean).children.find(isWornHat)!.getObjectByProperty("isMesh", true)!.castShadow).toBe(true);
  });

  it("puts nothing on after it is disposed, and frees what it loaded", async () => {
    const wardrobe = createWardrobe({ load: diskLoader() });
    const worn = rig();
    wardrobe.wear(worn, "crown");
    await settle();
    const geometry = (head(worn).children.find(isWornHat)!.getObjectByProperty("isMesh", true) as THREE.Mesh).geometry;
    const freed = vi.fn();
    geometry.addEventListener("dispose", freed);

    const late = rig();
    wardrobe.wear(late, "cone");
    wardrobe.dispose();
    await settle();

    expect(wornHatId(late)).toBeNull();
    expect(freed).toHaveBeenCalled();
  });
});

describe("tinting a hatted rig (ADR 0083)", () => {
  it("recolors the body and leaves the hat's own colors and materials alone", async () => {
    const wardrobe = createWardrobe({ load: diskLoader() });
    const bean = rig();
    wardrobe.wear(bean, "cone");
    await settle();
    const hatMesh = head(bean).children.find(isWornHat)!.getObjectByProperty("isMesh", true) as THREE.Mesh;
    const before = hatMesh.material;

    tintModel(bean, 200);

    expect(hatMesh.material).toBe(before);
  });
});
