import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createArmReachPlayer, findArmReachNodes } from "./armReach.js";

const FULLY_BLENDED_SECONDS = 2; // several times REACH_BLEND_RATE's own half-life — close enough to weight=1/0 for exact-direction assertions

const buildArm = (shoulderPosition: THREE.Vector3, bindEuler?: THREE.Euler) => {
  const root = new THREE.Object3D();
  const shoulder = new THREE.Object3D();
  shoulder.name = "ShoulderL";
  shoulder.position.copy(shoulderPosition);
  if (bindEuler) shoulder.quaternion.setFromEuler(bindEuler);
  root.add(shoulder);
  const upperArm = new THREE.Object3D();
  upperArm.name = "UpperArmL";
  shoulder.add(upperArm);
  root.updateMatrixWorld(true);
  return { root, shoulder, upperArm };
};

const worldArmDir = (upperArm: THREE.Object3D): THREE.Vector3 =>
  new THREE.Vector3(0, 1, 0).applyQuaternion(upperArm.getWorldQuaternion(new THREE.Quaternion()));

describe("createArmReachPlayer", () => {
  it("points the upper arm's own bone axis (local +Y) at the target, in world space, even with a non-trivial shoulder bind rotation", () => {
    const { root, shoulder, upperArm } = buildArm(new THREE.Vector3(1, 1, 0), new THREE.Euler(0.3, 0.5, -0.2));
    const player = createArmReachPlayer(root);

    const target = new THREE.Vector3(5, 2, 3);
    player.update(target, FULLY_BLENDED_SECONDS);
    root.updateMatrixWorld(true);

    const shoulderWorldPos = new THREE.Vector3();
    shoulder.getWorldPosition(shoulderWorldPos);
    const expectedDir = target.clone().sub(shoulderWorldPos).normalize();
    expect(worldArmDir(upperArm).normalize().angleTo(expectedDir)).toBeLessThan(1e-3);
  });

  it("reaches independently per arm, from each shoulder's own world position", () => {
    const root = new THREE.Object3D();
    const shoulderL = new THREE.Object3D();
    shoulderL.name = "ShoulderL";
    shoulderL.position.set(-1, 0, 0);
    root.add(shoulderL);
    const upperArmL = new THREE.Object3D();
    upperArmL.name = "UpperArmL";
    shoulderL.add(upperArmL);

    const shoulderR = new THREE.Object3D();
    shoulderR.name = "ShoulderR";
    shoulderR.position.set(1, 0, 0);
    root.add(shoulderR);
    const upperArmR = new THREE.Object3D();
    upperArmR.name = "UpperArmR";
    shoulderR.add(upperArmR);
    root.updateMatrixWorld(true);

    const player = createArmReachPlayer(root);
    const target = new THREE.Vector3(0, 0, 5);
    player.update(target, FULLY_BLENDED_SECONDS);
    root.updateMatrixWorld(true);

    const dirGap = (shoulder: THREE.Object3D, upperArm: THREE.Object3D): number => {
      const pos = new THREE.Vector3();
      shoulder.getWorldPosition(pos);
      return target.clone().sub(pos).normalize().sub(worldArmDir(upperArm).normalize()).length();
    };
    expect(dirGap(shoulderL, upperArmL)).toBeLessThan(1e-3);
    expect(dirGap(shoulderR, upperArmR)).toBeLessThan(1e-3);
  });

  it("blends in gradually rather than snapping straight to the target — no transition read as broken, live feedback", () => {
    const { root, upperArm } = buildArm(new THREE.Vector3(0, 0, 0));
    const player = createArmReachPlayer(root);
    const startDir = worldArmDir(upperArm).clone();

    player.update(new THREE.Vector3(5, 0, 0), 1 / 60); // one ordinary render frame

    const afterOneFrame = worldArmDir(upperArm);
    // Moved toward the target, but nowhere near it yet after a single frame.
    expect(afterOneFrame.angleTo(startDir)).toBeGreaterThan(0);
    expect(afterOneFrame.angleTo(new THREE.Vector3(1, 0, 0))).toBeGreaterThan(0.1);
  });

  it("reaches (close to) the exact target direction once given enough time to blend in fully", () => {
    const { root, upperArm } = buildArm(new THREE.Vector3(0, 0, 0));
    const player = createArmReachPlayer(root);

    for (let i = 0; i < 60; i += 1) player.update(new THREE.Vector3(5, 0, 0), 1 / 60);

    expect(worldArmDir(upperArm).normalize().angleTo(new THREE.Vector3(1, 0, 0))).toBeLessThan(1e-2);
  });

  it("eases back out to the mixer's own natural pose once the target goes away, rather than snapping back instantly", () => {
    const { root, upperArm } = buildArm(new THREE.Vector3(0, 0, 0));
    const player = createArmReachPlayer(root);
    for (let i = 0; i < 60; i += 1) player.update(new THREE.Vector3(5, 0, 0), 1 / 60); // fully reaching

    // The "mixer" hands the arm back this same natural pose every frame from
    // here on, exactly as a real locomotion crossfade would.
    const natural = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI)); // points -Y
    upperArm.quaternion.copy(natural);
    player.update(undefined, 1 / 60); // one frame of release
    const afterOneFrame = upperArm.quaternion.clone();

    for (let i = 0; i < 59; i += 1) {
      upperArm.quaternion.copy(natural); // mixer drives it fresh every frame
      player.update(undefined, 1 / 60);
    }
    const afterOneSecond = upperArm.quaternion.clone();

    // Immediately after release it's still much closer to the reach pose
    // than to natural; a full second later it's converged on natural.
    expect(afterOneFrame.angleTo(natural)).toBeGreaterThan(0.5);
    expect(afterOneSecond.angleTo(natural)).toBeLessThan(0.05);
  });

  it(
    "blends the lower arm toward its own bind-pose rotation too, rather than leaving it to the mixer's walk/idle " +
      "clip — otherwise the forearm keeps swinging independently of the reaching upper arm above it",
    () => {
      const root = new THREE.Object3D();
      const shoulder = new THREE.Object3D();
      shoulder.name = "ShoulderL";
      root.add(shoulder);
      const upperArm = new THREE.Object3D();
      upperArm.name = "UpperArmL";
      shoulder.add(upperArm);
      const lowerArm = new THREE.Object3D();
      lowerArm.name = "LowerArmL";
      const bindRotation = new THREE.Euler(0.4, -0.2, 0.1);
      lowerArm.quaternion.setFromEuler(bindRotation);
      upperArm.add(lowerArm);
      root.updateMatrixWorld(true);
      const bindQuaternion = lowerArm.quaternion.clone(); // captured "at lookup time", before any clip runs

      const player = createArmReachPlayer(root);
      // The mixer moves it away from bind before every frame.
      for (let i = 0; i < 60; i += 1) {
        lowerArm.quaternion.setFromEuler(new THREE.Euler(1.2, 0.9, -0.7));
        player.update(new THREE.Vector3(3, 0, 0), 1 / 60);
      }

      expect(lowerArm.quaternion.angleTo(bindQuaternion)).toBeLessThan(1e-2);
    },
  );

  it("leaves a side with no lower-arm node alone — a missing forearm doesn't stop the upper arm from reaching", () => {
    const { root, upperArm } = buildArm(new THREE.Vector3(0, 0, 0));
    const player = createArmReachPlayer(root);

    expect(() => player.update(new THREE.Vector3(3, 0, 0), FULLY_BLENDED_SECONDS)).not.toThrow();
    expect(worldArmDir(upperArm).x).toBeGreaterThan(0); // still reached toward +X
  });

  it("is a harmless no-op when the rig has no arm nodes at all", () => {
    const root = new THREE.Object3D();
    const player = createArmReachPlayer(root);
    expect(() => player.update(new THREE.Vector3(1, 2, 3), 1 / 60)).not.toThrow();
    expect(() => player.update(undefined, 1 / 60)).not.toThrow();
  });

  it("skips a degenerate case where the shoulder sits exactly at the target, without throwing or producing NaN", () => {
    const { root, upperArm } = buildArm(new THREE.Vector3(0, 0, 0));
    const player = createArmReachPlayer(root);

    player.update(new THREE.Vector3(0, 0, 0), FULLY_BLENDED_SECONDS);

    expect(Number.isNaN(upperArm.quaternion.x)).toBe(false);
  });
});

describe("findArmReachNodes", () => {
  const buildRig = (): THREE.Object3D => {
    const root = new THREE.Object3D();
    const shoulderL = new THREE.Object3D();
    shoulderL.name = "ShoulderL";
    const upperArmL = new THREE.Object3D();
    upperArmL.name = "UpperArmL";
    shoulderL.add(upperArmL);
    root.add(shoulderL);
    const shoulderR = new THREE.Object3D();
    shoulderR.name = "ShoulderR";
    const upperArmR = new THREE.Object3D();
    upperArmR.name = "UpperArmR";
    shoulderR.add(upperArmR);
    root.add(shoulderR);
    return root;
  };

  it("finds both shoulder/upper-arm pairs when present", () => {
    expect(findArmReachNodes(buildRig())).toHaveLength(2);
  });

  it("skips a side missing either of its own nodes rather than throwing", () => {
    const root = buildRig();
    const shoulderR = root.getObjectByName("ShoulderR")!;
    root.remove(shoulderR);

    const nodes = findArmReachNodes(root);
    expect(nodes).toHaveLength(1);
  });

  it("finds nothing on a rig with neither node", () => {
    expect(findArmReachNodes(new THREE.Object3D())).toHaveLength(0);
  });

  it("captures the lower arm and its current (bind-pose) rotation when present", () => {
    const root = buildRig();
    const lowerArmL = new THREE.Object3D();
    lowerArmL.name = "LowerArmL";
    lowerArmL.quaternion.setFromEuler(new THREE.Euler(0.3, 0, 0));
    root.getObjectByName("UpperArmL")!.add(lowerArmL);

    const [left] = findArmReachNodes(root);
    expect(left!.lowerArm).toBe(lowerArmL);
    expect(left!.lowerArmBindQuaternion!.equals(lowerArmL.quaternion)).toBe(true);
  });

  it("leaves lowerArm/lowerArmBindQuaternion undefined for a side with no forearm node", () => {
    const [left] = findArmReachNodes(buildRig());
    expect(left!.lowerArm).toBeUndefined();
    expect(left!.lowerArmBindQuaternion).toBeUndefined();
  });
});
