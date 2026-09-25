import type { BombPhase } from "@dont-fall/shared";
import * as THREE from "three";

/**
 * How a Bomb looks (CONTEXT.md: Bomb, ADR 0126): its three authored clips,
 * played for looks only and driven entirely by {@link BombPhase} — what the
 * Snapshot says and the Tick the world is drawn at. Nothing here decides
 * anything; the blast has already happened on the server by the time a
 * client draws it.
 *
 * Built after `BLIP_Bombs_v1`'s own `BombAnimations.js`, with its rules kept:
 * each clip resets every transform and morph it touches, the effect group is
 * switched rather than its meshes, and a finished explosion hides the whole
 * instance instead of stopping the clip (stopping would show the bomb again).
 */

/** The clips, by the names the drop gives them. */
const CLIP = { tick: "Bomb_Tick", tickFast: "Bomb_Tick_Fast", explode: "Bomb_Explode" } as const;

/** Where in `Bomb_Explode` the blast is (seconds) — the drop's own number. The clip is started this far ahead of the blast's Tick. */
export const BOMB_EXPLODE_LEAD_SECONDS = 0.14;

/** The group every explosion effect sits under. */
const EFFECTS = "Bomb_FX";
/** The fuse's embers and glow — lit only while the bomb burns. */
const isFuseEffect = (object: THREE.Object3D): boolean => object.name.startsWith("FX_Fuse_");

/**
 * A bomb template at rest (ADR 0126): no explosion and no burning fuse. What
 * the builder, a Thumbnail and a lying bomb all show — the drop's effect
 * meshes stand at full size in the rest pose, since only a clip scales them
 * away.
 */
export const restBombLook = (root: THREE.Object3D): void => {
  root.traverse((object) => {
    if (object.name === EFFECTS || isFuseEffect(object)) object.visible = false;
  });
};

/** Whether `root` is a bomb — it carries the clips a bomb is drawn with. */
export const isBombTemplate = (root: THREE.Object3D): boolean =>
  root.animations.some((clip) => clip.name === CLIP.explode);

export interface BombLook {
  /** Draw `phase`, `deltaSeconds` after the last call. Returns whether anything of it is drawn at all. */
  update: (phase: BombPhase, deltaSeconds: number) => boolean;
  dispose: () => void;
}

/** A look over one placed instance of a bomb template — `root` is that instance, with the template's `animations`. */
export const createBombLook = (root: THREE.Object3D): BombLook => {
  const clip = (name: string): THREE.AnimationClip => {
    const found = root.animations.find((candidate) => candidate.name === name);
    if (!found) throw new Error(`bomb: missing clip ${name}`);
    return found;
  };
  const mixer = new THREE.AnimationMixer(root);
  const tick = mixer.clipAction(clip(CLIP.tick)).setLoop(THREE.LoopRepeat, Infinity);
  const tickFast = mixer.clipAction(clip(CLIP.tickFast)).setLoop(THREE.LoopRepeat, Infinity);
  const explode = mixer.clipAction(clip(CLIP.explode)).setLoop(THREE.LoopOnce, 1);
  explode.clampWhenFinished = true;
  const effects = root.getObjectByName(EFFECTS);
  const fuse: THREE.Object3D[] = [];
  root.traverse((object) => {
    if (isFuseEffect(object)) fuse.push(object);
  });

  let playing: THREE.AnimationAction | null = null;
  const play = (action: THREE.AnimationAction | null): void => {
    if (action === playing) return;
    mixer.stopAllAction();
    playing = action;
    if (action) action.reset().play();
    // A stopped mixer leaves the last sampled pose behind; the rest pose is
    // the template's, and the clips all reset what they touch anyway.
  };
  const show = (burning: boolean, exploding: boolean): void => {
    if (effects) effects.visible = exploding;
    for (const object of fuse) object.visible = burning;
  };

  return {
    update: (phase, deltaSeconds) => {
      if (phase.kind === "lying") {
        play(null);
        show(false, false);
        return true;
      }
      // The clip leads the blast: until it is due, a spent-by-blast bomb is
      // still the one burning down in the drawn world.
      const clipTime = phase.kind === "spent" ? phase.secondsSince + BOMB_EXPLODE_LEAD_SECONDS : 0;
      if (phase.kind === "lit" || (phase.blasted && clipTime < 0)) {
        play(phase.kind === "lit" && !phase.fast ? tick : tickFast);
        show(true, false);
        mixer.update(deltaSeconds);
        return true;
      }
      if (!phase.blasted || clipTime >= explode.getClip().duration) {
        play(null);
        return false;
      }
      play(explode);
      show(false, true);
      // Set, not advanced: the explosion is where the Tick says it is, so a
      // hitch or a late snapshot skips ahead instead of replaying late.
      explode.time = clipTime;
      mixer.update(0);
      return true;
    },
    dispose: () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
    },
  };
};
