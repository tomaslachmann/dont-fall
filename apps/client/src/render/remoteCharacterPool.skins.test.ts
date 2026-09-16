// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { BODY_SKIN_HUES, DEFAULT_BODY_SKIN, type RenderCharacter } from "@dont-fall/shared";
import { createRemoteCharacterPool } from "./remoteCharacterPool.js";

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
  hitEpoch: 0,
  hitReactEpoch: 0,
  grabEpoch: 0,
  launchPadEpoch: 0,
  grabbingId: null,
  heldByGrabberId: null,
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

describe("RemoteCharacterPool skins (M9 ticket 15)", () => {
  it("tints a new rig to its equipped skin — or the default when anonymous", () => {
    const scene = new THREE.Scene();
    const pool = createRemoteCharacterPool(scene, fakeModel());
    pool.setSkins(new Map([["skinned", 2]]));

    pool.apply({ skinned: standing(), anon: standing() }, 0.016, "me", { x: 0, y: 0, z: 0 });

    const hues = rigHues(scene);
    expect(hues).toHaveLength(2);
    expect(hues.some((h) => Math.abs(h - BODY_SKIN_HUES[2]!) < 1)).toBe(true);
    expect(hues.some((h) => Math.abs(h - BODY_SKIN_HUES[DEFAULT_BODY_SKIN]!) < 1)).toBe(true);
    pool.dispose();
  });

  it("re-tints a standing rig when its skin arrives late (auth resolves after join)", () => {
    const scene = new THREE.Scene();
    const pool = createRemoteCharacterPool(scene, fakeModel());
    pool.apply({ late: standing() }, 0.016, "me", { x: 0, y: 0, z: 0 });
    expect(rigHues(scene)).toHaveLength(1);
    expect(Math.abs(rigHues(scene)[0]! - BODY_SKIN_HUES[DEFAULT_BODY_SKIN]!)).toBeLessThan(1);

    pool.setSkins(new Map([["late", 1]]));

    expect(Math.abs(rigHues(scene)[0]! - BODY_SKIN_HUES[1]!)).toBeLessThan(1);
    pool.dispose();
  });
});
