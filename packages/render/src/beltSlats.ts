import { beltSlatAt, type BeltPath } from "@dont-fall/shared";
import * as THREE from "three";

/**
 * A conveyor's slats riding their loop (ADR 0120). Drawn only: the push a
 * Character feels is the Conveyor's, and both read the same speed, so what
 * you see is what carries you.
 *
 * The nodes are the authored ones, found by name — `Conveyor_Slat_00` and up.
 * Their own clip is never played: the loop is four numbers in the def
 * (`BeltPath`), which is what the clip was drawing.
 */
export class BeltSlats {
  private readonly slats: THREE.Object3D[] = [];

  constructor(
    root: THREE.Object3D,
    private readonly path: BeltPath,
    /** Units per second, from the Conveyor this belt runs. Negative runs it the other way. */
    private readonly speed: number,
  ) {
    const found = new Map<number, THREE.Object3D>();
    root.traverse((node) => {
      const match = /^Conveyor_Slat_(\d+)/.exec(node.name);
      if (match) found.set(Number(match[1]), node);
    });
    for (let i = 0; i < path.slats; i += 1) {
      const node = found.get(i);
      if (node) this.slats.push(node);
    }
  }

  get any(): boolean {
    return this.slats.length > 0;
  }

  /** Put every slat where it is `seconds` into the belt's own running. */
  update(seconds: number): void {
    this.slats.forEach((node, i) => {
      const pose = beltSlatAt(this.path, i, this.speed, seconds);
      node.position.set(pose.position.x, pose.position.y, pose.position.z);
      node.quaternion.set(pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.w);
    });
  }
}
