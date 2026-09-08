import { CAPSULE_BOTTOM_OFFSET, RAGDOLL_BONES } from "@dont-fall/shared";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { LocomotionState } from "./locomotionAnimation.js";

/**
 * MushroomKing from Quaternius' "Ultimate Platformer Pack" (CC0) —
 * apps/client/public/models/MushroomKing.gltf. A single self-contained glTF
 * (embedded buffer + texture), rigged with a skeleton and named animation
 * clips (Idle, Walk, Jump_Idle, …).
 */
const MODEL_URL = "/models/MushroomKing.gltf";

export interface CharacterModel {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}

/** Locomotion clip crossfade duration (s) — shared by the local Character and every real remote one (ADR 0046). */
export const LOCOMOTION_CROSSFADE_SECONDS = 0.15;

/**
 * Vertical distance from the ragdoll's pelvis (a Character's own reported
 * `position` while Ragdoll/GettingUp) down to the feet — the pelvis rest
 * offset from the capsule centre plus the capsule's own centre-to-feet
 * distance. Lets the Ragdoll collapse anchor be derived from the pelvis
 * alone, correct whether it came from a live Impact or a Fall's Respawn
 * teleport (both activate the ragdoll the same way, at the capsule-centre
 * convention). One definition shared by the local Character (`scene.ts`) and
 * every real remote one (`remoteCharacterPool.ts`, ADR 0046) — previously
 * duplicated verbatim between the two (code review, M6 ticket 02).
 */
export const RAGDOLL_PELVIS_TO_FEET =
  CAPSULE_BOTTOM_OFFSET + RAGDOLL_BONES.find((b) => b.name === "pelvis")!.restCenter.y;

export const loadCharacterModel = async (): Promise<CharacterModel> => {
  const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
  return { scene: gltf.scene, animations: gltf.animations };
};

/** The named clips a Character's rig plays — one `AnimationAction` per name, bound to one `mixer`/rig instance. */
export interface CharacterActions {
  idle: THREE.AnimationAction | null;
  walk: THREE.AnimationAction | null;
  run: THREE.AnimationAction | null;
  jump: THREE.AnimationAction | null;
  /** Doubles for both Ragdoll (forward) and GettingUp (reverse) — see `scene.ts`'s own Death-clip driving logic. */
  death: THREE.AnimationAction | null;
  /** Plays once on the striker the instant their own Hit swing fires (M6 ticket 03) — see `HitReactionPlayer`. */
  punch: THREE.AnimationAction | null;
  /** Plays once on a Character the instant it's on the receiving end of a landed Hit (M6 ticket 03) — see `HitReactionPlayer`. */
  hitReact: THREE.AnimationAction | null;
}

/**
 * Binds `mixer` to every named clip a Character's rig needs (M6 ticket 02) —
 * extracted so a real remote Character (ADR 0046) can load its own clone's
 * actions identically to the local Character's, rather than re-deriving the
 * same five `clipAction` calls and the Death clip's one-shot/clamp setup a
 * second time.
 */
export const loadCharacterActions = (mixer: THREE.AnimationMixer, animations: THREE.AnimationClip[]): CharacterActions => {
  const clipAction = (name: string): THREE.AnimationAction | null => {
    const clip = THREE.AnimationClip.findByName(animations, name);
    return clip ? mixer.clipAction(clip) : null;
  };
  const death = clipAction("Death");
  if (death) {
    death.setLoop(THREE.LoopOnce, 1);
    death.clampWhenFinished = true;
  }
  // Punch/HitReact (M6 ticket 03): one-shot overlays, but unlike Death they
  // hand back to ordinary locomotion the instant they finish rather than
  // holding on the last frame — `clampWhenFinished: false`.
  const punch = clipAction("Punch");
  if (punch) punch.setLoop(THREE.LoopOnce, 1);
  const hitReact = clipAction("HitReact");
  if (hitReact) hitReact.setLoop(THREE.LoopOnce, 1);
  return {
    idle: clipAction("Idle"),
    walk: clipAction("Walk"),
    run: clipAction("Run"),
    jump: clipAction("Jump_Idle"),
    death,
    punch,
    hitReact,
  };
};

/** Whether a one-shot action (Punch, HitReact — never looping) has finished playing out. */
export const isOneShotFinished = (action: THREE.AnimationAction): boolean => action.time >= action.getClip().duration;

/**
 * The actual clip for a {@link LocomotionState} — `run` falls back to `walk`
 * when no dedicated running clip exists, matching the fallback the local
 * Character's own animation has always used for a Dash's locomotion.
 */
export const actionFor = (state: LocomotionState, actions: CharacterActions): THREE.AnimationAction | null => {
  switch (state) {
    case "idle":
      return actions.idle;
    case "walk":
      return actions.walk;
    case "run":
      return actions.run ?? actions.walk;
    case "jump":
      return actions.jump;
  }
};

/**
 * Crossfades to `next` if it differs from `current`, otherwise leaves it
 * playing untouched. Returns the action that is now current — the caller
 * holds it in its own per-rig variable (local and remote each track their
 * own).
 */
export const crossfadeLocomotion = (
  next: THREE.AnimationAction | null,
  current: THREE.AnimationAction | null,
  crossfadeSeconds: number,
): THREE.AnimationAction | null => {
  if (!next || next === current) return current;
  next.reset().fadeIn(crossfadeSeconds).play();
  current?.fadeOut(crossfadeSeconds);
  return next;
};
