import type { PropSnapshot, ShooterConfig } from "@dont-fall/shared";
import * as THREE from "three";

/**
 * A cannon's recoil and muzzle flash (ADR 0119) — presentation, derived from
 * the balls themselves rather than from anything sent for it.
 *
 * A Projectile waits inside its Shooter and is fired rather than created, so
 * the Tick its `live` flag turns on *is* the shot. Watching for that edge
 * means the flash and the kick happen on the frame the ball appears, on every
 * client, with no new field on the wire and nothing to keep in step.
 *
 * The nodes are the authored ones: the flash spheres sit at scale 0 in the
 * GLB, which is exactly "not showing", and the recoil pivot is the one the
 * clip slides back. Neither is ever simulated.
 */
export const MUZZLE_FLASH_SECONDS = 0.17;
export const RECOIL_SECONDS = 0.35;
/** How far the barrel kicks back, in its own local frame — the authored clip's own 0.18 m. */
export const RECOIL_DEPTH = 0.18;

interface ShooterVisual {
  /** Which entries of the drawn Props are this Shooter's balls. */
  propIndices: number[];
  recoil: THREE.Object3D | undefined;
  flashes: THREE.Object3D[];
  restZ: number;
  firedAtMs: number | null;
}

/** Find one Shooter's authored effect nodes inside the groups that draw it. */
const visualOf = (config: ShooterConfig, groups: readonly THREE.Object3D[]): ShooterVisual => {
  let recoil: THREE.Object3D | undefined;
  const flashes: THREE.Object3D[] = [];
  for (const group of groups) {
    group.traverse((node) => {
      if (node.name.startsWith("Shooter_RecoilPivot")) recoil = node;
      else if (node.name.startsWith("Shooter_MuzzleFlash")) flashes.push(node);
    });
  }
  return { propIndices: [...config.propIndices], recoil, flashes, restZ: recoil?.position.z ?? 0, firedAtMs: null };
};

export class ShooterEffects {
  private readonly visuals: ShooterVisual[];
  /** Whether each drawn Prop was in flight last frame — the edge that is a shot. */
  private readonly wasLive = new Map<number, boolean>();

  constructor(shooters: readonly ShooterConfig[], groupsOf: (segmentIndex: number) => readonly THREE.Object3D[]) {
    this.visuals = shooters.map((config) => visualOf(config, groupsOf(config.segmentIndex)));
    for (const visual of this.visuals) for (const flash of visual.flashes) flash.scale.setScalar(0);
  }

  get any(): boolean {
    return this.visuals.length > 0;
  }

  /**
   * Flash and kick whichever cannon has just put a ball in the air, and settle
   * the rest. Returns the balls that were fired this frame, by Prop index —
   * what the shot is heard from.
   */
  update(props: readonly PropSnapshot[], nowMs: number): number[] {
    const fired: number[] = [];
    for (const visual of this.visuals) {
      for (const index of visual.propIndices) {
        const live = props[index]?.live === true;
        if (live && this.wasLive.get(index) !== true) {
          visual.firedAtMs = nowMs;
          fired.push(index);
        }
        this.wasLive.set(index, live);
      }
      const since = visual.firedAtMs === null ? Infinity : (nowMs - visual.firedAtMs) / 1000;
      const flash = since < MUZZLE_FLASH_SECONDS ? 1 : 0;
      for (const node of visual.flashes) node.scale.setScalar(flash);
      if (visual.recoil) {
        // Back hard, then ease home — the shape of the authored slide.
        const kick = since >= RECOIL_SECONDS ? 0 : Math.sin(Math.PI * (1 - since / RECOIL_SECONDS)) ** 2;
        visual.recoil.position.z = visual.restZ - RECOIL_DEPTH * kick;
      }
    }
    return fired;
  }
}
