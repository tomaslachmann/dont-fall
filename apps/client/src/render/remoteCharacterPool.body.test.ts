// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { BODY_COLOR_HUES, DEFAULT_BODY_COLOR, type RenderCharacter } from "@dont-fall/shared";
import { createRemoteCharacterPool } from "./remoteCharacterPool.js";
import { createSkinCloset } from "./skins.js";

const fakeModel = () => {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0xffffff }),
  );
  const scene = new THREE.Group();
  scene.add(mesh);
  return { scene, animations: [] as THREE.AnimationClip[] };
};

const standing = (): RenderCharacter => ({
  position: { x: 0, y: 1, z: 0 },
  bones: [],
  motionState: "Controlled",
  facing: 0,
  velocity: { x: 0, y: 0, z: 0 },
  grounded: true,
  dashing: false,
  dashSpeed: 0,
  respawnCount: 0,
  eliminated: false,
  hitChargeMs: 0,
  ragdollEpoch: 0,
  ragdollCause: "Fall",
  hitEpoch: 0,
  hitReactEpoch: 0,
  grabEpoch: 0,
  launchPadEpoch: 0,
  grabbingId: null,
  heldByGrabberId: null,
  heldPhase: null,
  spinMs: 0,
});

/** First mesh hue per rig root, in scene order — order-free assertions below. */
const rigHues = (scene: THREE.Scene): number[] =>
  scene.children.map((root) => {
    let hue: number | null = null;
    root.traverse((object) => {
      if (object instanceof THREE.Mesh && hue === null) {
        const hsl = { h: 0, s: 0, l: 0 };
        (object.material as THREE.MeshStandardMaterial).color.getHSL(hsl);
        hue = hsl.h * 360;
      }
    });
    return hue!;
  });

/** First mesh's body map per rig root, in scene order. */
const rigMaps = (scene: THREE.Scene): (THREE.Texture | null)[] =>
  scene.children.map((root) => {
    let map: THREE.Texture | null = null;
    let found = false;
    root.traverse((object) => {
      if (object instanceof THREE.Mesh && !found) {
        found = true;
        map = (object.material as THREE.MeshStandardMaterial).map;
      }
    });
    return map;
  });

const origin = { x: 0, y: 0, z: 0 };

describe("RemoteCharacterPool colors (M9 ticket 15)", () => {
  it("tints a new rig to its equipped color — or the default when anonymous", () => {
    const scene = new THREE.Scene();
    const pool = createRemoteCharacterPool(scene, fakeModel());
    pool.setColors(new Map([["coloured", 2]]));

    pool.apply({ coloured: standing(), anon: standing() }, 0.016, "me", origin);

    const hues = rigHues(scene);
    expect(hues).toHaveLength(2);
    expect(hues.some((h) => Math.abs(h - BODY_COLOR_HUES[2]!) < 1)).toBe(true);
    expect(hues.some((h) => Math.abs(h - BODY_COLOR_HUES[DEFAULT_BODY_COLOR]!) < 1)).toBe(true);
    pool.dispose();
  });

  it("re-tints a standing rig when its color arrives late (auth resolves after join)", () => {
    const scene = new THREE.Scene();
    const pool = createRemoteCharacterPool(scene, fakeModel());
    pool.apply({ late: standing() }, 0.016, "me", origin);
    expect(rigHues(scene)).toHaveLength(1);
    expect(Math.abs(rigHues(scene)[0]! - BODY_COLOR_HUES[DEFAULT_BODY_COLOR]!)).toBeLessThan(1);

    pool.setColors(new Map([["late", 1]]));

    expect(Math.abs(rigHues(scene)[0]! - BODY_COLOR_HUES[1]!)).toBeLessThan(1);
    pool.dispose();
  });
});

/** Lets the closet's texture promise chain (load → prepare → paint) run out. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("RemoteCharacterPool skins (ADR 0091)", () => {
  /** A closet whose textures are handed over synchronously-ish, with no network and no image decode. */
  const stubCloset = () => {
    const loaded = new Map<string, THREE.Texture>();
    return {
      loaded,
      closet: createSkinCloset({
        load: (url) => {
          const texture = new THREE.Texture();
          loaded.set(url, texture);
          return Promise.resolve(texture);
        },
      }),
    };
  };

  it("paints a rig with its equipped skin, and fetches that skin's texture exactly once for everyone wearing it", async () => {
    const scene = new THREE.Scene();
    const { loaded, closet } = stubCloset();
    const pool = createRemoteCharacterPool(scene, fakeModel(), { closet });
    pool.setSkins(new Map([["a", "tiger"], ["b", "tiger"]]));

    pool.apply({ a: standing(), b: standing() }, 0.016, "me", origin);
    await settle();

    expect(loaded.size).toBe(1);
    const tiger = loaded.get("/models/skins/tiger.png")!;
    expect(rigMaps(scene)).toEqual([tiger, tiger]);
    pool.dispose();
    closet.dispose();
  });

  it("a rig with no skin wears its color instead — no texture at all", async () => {
    const scene = new THREE.Scene();
    const { loaded, closet } = stubCloset();
    const pool = createRemoteCharacterPool(scene, fakeModel(), { closet });
    pool.setColors(new Map([["bare", 2]]));

    pool.apply({ bare: standing() }, 0.016, "me", origin);
    await settle();

    expect(loaded.size).toBe(0);
    expect(rigMaps(scene)).toEqual([null]);
    expect(Math.abs(rigHues(scene)[0]! - BODY_COLOR_HUES[2]!)).toBeLessThan(1);
    pool.dispose();
    closet.dispose();
  });

  it("taking a skin off reveals the color that was under it all along", async () => {
    const scene = new THREE.Scene();
    const { closet } = stubCloset();
    const pool = createRemoteCharacterPool(scene, fakeModel(), { closet });
    pool.setColors(new Map([["p", 2]]));
    pool.setSkins(new Map([["p", "frog"]]));
    pool.apply({ p: standing() }, 0.016, "me", origin);
    await settle();
    expect(rigMaps(scene)[0]).not.toBeNull();

    pool.setSkins(new Map([["p", null]]));

    expect(rigMaps(scene)).toEqual([null]);
    expect(Math.abs(rigHues(scene)[0]! - BODY_COLOR_HUES[2]!)).toBeLessThan(1);
    pool.dispose();
    closet.dispose();
  });

  it("an unknown skin id is no skin — the bean shows its color, never nothing", async () => {
    const scene = new THREE.Scene();
    const { loaded, closet } = stubCloset();
    const pool = createRemoteCharacterPool(scene, fakeModel(), { closet });
    pool.setColors(new Map([["p", 2]]));
    pool.setSkins(new Map([["p", "an-unlock-this-client-predates"]]));

    pool.apply({ p: standing() }, 0.016, "me", origin);
    await settle();

    expect(loaded.size).toBe(0);
    expect(rigMaps(scene)).toEqual([null]);
    expect(Math.abs(rigHues(scene)[0]! - BODY_COLOR_HUES[2]!)).toBeLessThan(1);
    pool.dispose();
    closet.dispose();
  });
});
