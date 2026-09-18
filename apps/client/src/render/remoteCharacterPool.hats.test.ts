// @vitest-environment jsdom
import type { RenderCharacter } from "@dont-fall/shared";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { Wardrobe } from "./hats.js";
import { createRemoteCharacterPool } from "./remoteCharacterPool.js";

const fakeModel = () => {
  const scene = new THREE.Group();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
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

/** A wardrobe that only remembers what each rig was last dressed in, and whether it was still drawn then. */
const recordingWardrobe = (scene: THREE.Scene) => {
  const worn = new Map<THREE.Object3D, string | null>();
  const calls: { hat: string | null; inScene: boolean }[] = [];
  const wardrobe: Wardrobe = {
    wear: (rig, hat) => {
      worn.set(rig, hat);
      calls.push({ hat, inScene: rig.parent === scene });
    },
    dispose: () => {},
  };
  return { wardrobe, worn, calls };
};

const origin = { x: 0, y: 0, z: 0 };

describe("RemoteCharacterPool hats (ADR 0083)", () => {
  it("dresses every new rig — in its hat, or bareheaded to shed the one it was cloned with", () => {
    const scene = new THREE.Scene();
    const { wardrobe, worn } = recordingWardrobe(scene);
    const pool = createRemoteCharacterPool(scene, fakeModel(), { wardrobe });
    pool.setHats(new Map([["hatted", "crown"]]));

    pool.apply({ hatted: standing(), bare: standing() }, 0.016, "me", origin);

    expect([...worn.values()].sort()).toEqual(["crown", null]);
    pool.dispose();
  });

  it("re-dresses a standing rig when its hat changes", () => {
    const scene = new THREE.Scene();
    const { wardrobe, worn } = recordingWardrobe(scene);
    const pool = createRemoteCharacterPool(scene, fakeModel(), { wardrobe });
    pool.apply({ late: standing() }, 0.016, "me", origin);
    const [root] = scene.children;

    pool.setHats(new Map([["late", "ufo"]]));
    expect(worn.get(root!)).toBe("ufo");

    pool.setHats(new Map());
    expect(worn.get(root!)).toBeNull();
    pool.dispose();
  });

  it("takes a leaving Player's hat off while their rig is still standing, then frees the rig", () => {
    const scene = new THREE.Scene();
    const { wardrobe, calls } = recordingWardrobe(scene);
    const pool = createRemoteCharacterPool(scene, fakeModel(), { wardrobe });
    pool.setHats(new Map([["leaving", "pot"]]));
    pool.apply({ leaving: standing() }, 0.016, "me", origin);

    pool.apply({}, 0.016, "me", origin);

    expect(calls.at(-1)).toEqual({ hat: null, inScene: true });
    expect(scene.children).toHaveLength(0);
    pool.dispose();
  });

  it("takes every hat off on teardown", () => {
    const scene = new THREE.Scene();
    const { wardrobe, worn } = recordingWardrobe(scene);
    const pool = createRemoteCharacterPool(scene, fakeModel(), { wardrobe });
    pool.setHats(new Map([["a", "cone"], ["b", "crown"]]));
    pool.apply({ a: standing(), b: standing() }, 0.016, "me", origin);

    pool.dispose();

    expect([...worn.values()]).toEqual([null, null]);
  });
});
