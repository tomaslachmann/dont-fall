import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { applyArmReach, findArmReachNodes } from "./armReach.js";

describe("applyArmReach", () => {
  it("points the upper arm's own bone axis (local +Y) at the target, in world space, even with a non-trivial shoulder bind rotation", () => {
    const root = new THREE.Object3D();
    const shoulder = new THREE.Object3D();
    shoulder.position.set(1, 1, 0);
    shoulder.quaternion.setFromEuler(new THREE.Euler(0.3, 0.5, -0.2)); // arbitrary, non-identity bind rotation
    root.add(shoulder);
    const upperArm = new THREE.Object3D();
    shoulder.add(upperArm);
    root.updateMatrixWorld(true);

    const target = new THREE.Vector3(5, 2, 3);
    applyArmReach(root, [{ shoulder, upperArm }], target);
    root.updateMatrixWorld(true);

    const shoulderWorldPos = new THREE.Vector3();
    shoulder.getWorldPosition(shoulderWorldPos);
    const armWorldDir = new THREE.Vector3(0, 1, 0)
      .applyQuaternion(upperArm.getWorldQuaternion(new THREE.Quaternion()))
      .normalize();
    const expectedDir = target.clone().sub(shoulderWorldPos).normalize();
    expect(armWorldDir.angleTo(expectedDir)).toBeLessThan(1e-4);
  });

  it("reaches independently per arm, from each shoulder's own world position", () => {
    const root = new THREE.Object3D();
    const shoulderL = new THREE.Object3D();
    shoulderL.position.set(-1, 0, 0);
    root.add(shoulderL);
    const upperArmL = new THREE.Object3D();
    shoulderL.add(upperArmL);

    const shoulderR = new THREE.Object3D();
    shoulderR.position.set(1, 0, 0);
    root.add(shoulderR);
    const upperArmR = new THREE.Object3D();
    shoulderR.add(upperArmR);
    root.updateMatrixWorld(true);

    const target = new THREE.Vector3(0, 0, 5);
    applyArmReach(root, [{ shoulder: shoulderL, upperArm: upperArmL }, { shoulder: shoulderR, upperArm: upperArmR }], target);
    root.updateMatrixWorld(true);

    const dirFor = (shoulder: THREE.Object3D, upperArm: THREE.Object3D): THREE.Vector3 => {
      const pos = new THREE.Vector3();
      shoulder.getWorldPosition(pos);
      const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(upperArm.getWorldQuaternion(new THREE.Quaternion()));
      return target.clone().sub(pos).normalize().sub(dir.normalize());
    };
    expect(dirFor(shoulderL, upperArmL).length()).toBeLessThan(1e-4);
    expect(dirFor(shoulderR, upperArmR).length()).toBeLessThan(1e-4);
  });

  it(
    "freezes the lower arm at its own bind-pose rotation while reaching, undoing whatever the mixer's walk/idle " +
      "clip had it doing — otherwise the forearm keeps swinging independently of the now-pinned upper arm above it",
    () => {
      const root = new THREE.Object3D();
      const shoulder = new THREE.Object3D();
      root.add(shoulder);
      const upperArm = new THREE.Object3D();
      shoulder.add(upperArm);
      const lowerArm = new THREE.Object3D();
      const bindRotation = new THREE.Euler(0.4, -0.2, 0.1);
      lowerArm.quaternion.setFromEuler(bindRotation);
      upperArm.add(lowerArm);
      root.updateMatrixWorld(true);
      const bindQuaternion = lowerArm.quaternion.clone(); // captured "at lookup time", before any clip runs

      // The mixer (a walk/idle clip) has since moved it away from bind.
      lowerArm.quaternion.setFromEuler(new THREE.Euler(1.2, 0.9, -0.7));

      applyArmReach(root, [{ shoulder, upperArm, lowerArm, lowerArmBindQuaternion: bindQuaternion }], new THREE.Vector3(3, 0, 0));

      expect(lowerArm.quaternion.equals(bindQuaternion)).toBe(true);
    },
  );

  it("leaves a side with no lower-arm node alone — a missing forearm doesn't stop the upper arm from reaching", () => {
    const root = new THREE.Object3D();
    const shoulder = new THREE.Object3D();
    root.add(shoulder);
    const upperArm = new THREE.Object3D();
    shoulder.add(upperArm);
    root.updateMatrixWorld(true);

    expect(() => applyArmReach(root, [{ shoulder, upperArm }], new THREE.Vector3(3, 0, 0))).not.toThrow();
    const armWorldDir = new THREE.Vector3(0, 1, 0).applyQuaternion(upperArm.getWorldQuaternion(new THREE.Quaternion()));
    expect(armWorldDir.x).toBeGreaterThan(0); // still reached toward +X
  });

  it("is a no-op when given no nodes", () => {
    const root = new THREE.Object3D();
    expect(() => applyArmReach(root, [], new THREE.Vector3())).not.toThrow();
  });

  it("skips a degenerate case where the shoulder sits exactly at the target, without throwing or producing NaN", () => {
    const root = new THREE.Object3D();
    const shoulder = new THREE.Object3D();
    root.add(shoulder);
    const upperArm = new THREE.Object3D();
    shoulder.add(upperArm);
    root.updateMatrixWorld(true);
    const before = upperArm.quaternion.clone();

    applyArmReach(root, [{ shoulder, upperArm }], new THREE.Vector3(0, 0, 0));

    expect(Number.isNaN(upperArm.quaternion.x)).toBe(false);
    expect(upperArm.quaternion.equals(before)).toBe(true); // left untouched
  });
});

describe("findArmReachNodes", () => {
  const buildRig = (): THREE.Object3D => {
    const root = new THREE.Object3D();
    const shoulderL = new THREE.Object3D();
    shoulderL.name = "Shoulder.L";
    const upperArmL = new THREE.Object3D();
    upperArmL.name = "UpperArm.L";
    shoulderL.add(upperArmL);
    root.add(shoulderL);
    const shoulderR = new THREE.Object3D();
    shoulderR.name = "Shoulder.R";
    const upperArmR = new THREE.Object3D();
    upperArmR.name = "UpperArm.R";
    shoulderR.add(upperArmR);
    root.add(shoulderR);
    return root;
  };

  it("finds both shoulder/upper-arm pairs when present", () => {
    expect(findArmReachNodes(buildRig())).toHaveLength(2);
  });

  it("skips a side missing either of its own nodes rather than throwing", () => {
    const root = buildRig();
    const shoulderR = root.getObjectByName("Shoulder.R")!;
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
    lowerArmL.name = "LowerArm.L";
    lowerArmL.quaternion.setFromEuler(new THREE.Euler(0.3, 0, 0));
    root.getObjectByName("UpperArm.L")!.add(lowerArmL);

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
