import { CAPSULE_BOTTOM_OFFSET, GETUP_MS, isDownMotionState, type CharacterMotionState, type RenderCharacter } from "@dont-fall/shared";
import * as THREE from "three";
import { clone as cloneRig } from "three/addons/utils/SkeletonUtils.js";
import {
  actionFor,
  crossfadeLocomotion,
  loadCharacterActions,
  LOCOMOTION_CROSSFADE_SECONDS,
  RAGDOLL_PELVIS_TO_FEET,
  type CharacterActions,
  type CharacterModel,
} from "./characterModel.js";
import { planDeathClip } from "./deathClipPlan.js";
import { HitReactionPlayer } from "./hitReactionPlayer.js";
import { selectLocomotion } from "./locomotionAnimation.js";
import { tintHueForId } from "./playerTint.js";

/**
 * Above this horizontal speed (units/s), a remote Character reads as
 * "moving" for locomotion purposes — comfortably above float/ground-stick
 * residual at rest, comfortably below a real walk (`WALK_SPEED` = 6). Unlike
 * the local Character (which knows its own raw input directly), a remote
 * Character only ever has replicated `velocity` to infer this from.
 */
const MOVING_SPEED_THRESHOLD = 0.5;

/** Tint saturation/lightness — the hue alone (`tintHueForId`) is what varies per player. */
const TINT_SATURATION = 0.55;
const TINT_LIGHTNESS = 0.55;

interface RemoteRig {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: CharacterActions;
  activeAction: THREE.AnimationAction | null;
  /** The last `motionState` seen, to detect the Ragdoll/GettingUp/Controlled edges — one per rig, mirroring the local Character's own `visualState`. */
  visualState: CharacterMotionState;
  /** Whether this rig's own `deathAction` has actually been started for the current down episode — see `planDeathClip`'s own doc comment. */
  everEnteredRagdoll: boolean;
  /** True only until this rig's first `updateRig` call — see `planDeathClip`'s `isFirstObservation`. */
  isFirstObservation: boolean;
  /** Drives this rig's own Punch/HitReact one-shot overlays (M6 ticket 03). */
  hitReactionPlayer: HitReactionPlayer;
}

/**
 * Clones every mesh's material before recoloring it — `SkeletonUtils.clone`
 * (like `Object3D.clone`) shares material references across every clone of
 * the same source by default, so tinting one player's rig without this would
 * visibly recolor every other clone (including the local Character's own
 * model) sharing that exact material instance.
 */
const tintModel = (root: THREE.Object3D, hue: number): void => {
  const color = new THREE.Color().setHSL(hue / 360, TINT_SATURATION, TINT_LIGHTNESS);
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const cloned = materials.map((material) => {
      const own = material.clone();
      if ("color" in own && own.color instanceof THREE.Color) own.color.copy(color);
      return own;
    });
    object.material = Array.isArray(object.material) ? cloned : cloned[0]!;
  });
};

/**
 * Releases only what a cloned rig genuinely owns exclusively — NOT the
 * general-purpose `disposeSceneGraph` (code review, M6 ticket 02): that
 * sweep is correct for tearing down the *entire* scene (nothing survives it
 * to still need the freed resources), but a single rig's geometry and every
 * material's textures are shared by reference with the local Character's own
 * rig and every other clone (`SkeletonUtils.clone` never clones geometry,
 * and `Material.clone()` copies texture references, not the textures
 * themselves). Disposing them on every disconnect would thrash the GPU
 * cache for every still-connected player. The skeleton IS genuinely cloned
 * per rig (needed since each rig animates independently) and the material
 * INSTANCE is genuinely this rig's own (`tintModel`'s clone, for the tint) —
 * both are safe, and correct, to free here.
 */
const disposeRemoteRig = (root: THREE.Object3D): void => {
  root.traverse((object) => {
    const mesh = object as Partial<THREE.SkinnedMesh>;
    mesh.skeleton?.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials) material.dispose();
  });
};

/**
 * Pools one real, animated, tinted clone of the shared Character model per
 * remote Player (M6 ticket 02, ADR 0046) — replacing the flat capsule that
 * stood in since M2 ticket 04. Mirrors `scene.ts`'s own local-Character
 * animation/Ragdoll-collapse handling exactly, driven from each remote
 * Character's replicated `RenderCharacter` fields instead of live local
 * input/state, since a remote Character is only ever interpolated, never
 * predicted (ADR 0003).
 */
export interface RemoteCharacterPool {
  /** Create/update/remove rigs to match `characters`, and advance every surviving rig's animation by `deltaSeconds`. */
  apply: (characters: Record<string, RenderCharacter>, deltaSeconds: number) => void;
  /** Tear down every pooled rig still standing — this rig's own exclusively-owned GPU resources included (`disposeRemoteRig`). */
  dispose: () => void;
}

export const createRemoteCharacterPool = (scene: THREE.Scene, characterModel: CharacterModel): RemoteCharacterPool => {
  const rigs = new Map<string, RemoteRig>();

  const buildRig = (id: string): RemoteRig => {
    // `cloneRig` copies the source root's own transform too — by the time any
    // remote rig is ever built (well after `createStage`'s own local-model
    // setup already scaled/repositioned `characterModel.scene` in place),
    // every clone inherits that same scale/feet-offset for free, with no
    // separate bounds computation needed here.
    const root = cloneRig(characterModel.scene);
    tintModel(root, tintHueForId(id));
    scene.add(root);

    const mixer = new THREE.AnimationMixer(root);
    const actions = loadCharacterActions(mixer, characterModel.animations);
    const activeAction = actions.idle;
    activeAction?.play();

    return {
      root,
      mixer,
      actions,
      activeAction,
      visualState: "Controlled",
      everEnteredRagdoll: false,
      isFirstObservation: true,
      hitReactionPlayer: new HitReactionPlayer(),
    };
  };

  const updateRig = (rig: RemoteRig, rc: RenderCharacter, deltaSeconds: number): void => {
    const { position, motionState, velocity, grounded, dashing, facing, hitEpoch, hitReactEpoch } = rc;
    const plan = planDeathClip(motionState, rig.visualState, rig.isFirstObservation, rig.everEnteredRagdoll);
    rig.visualState = motionState;
    rig.isFirstObservation = false;

    const { death: deathAction } = rig.actions;

    switch (plan.kind) {
      case "collapse":
        // Same canned collapse the local Character plays — see `scene.ts`'s own
        // Death-clip doc comment for why (no compatible get-up clip for this rig).
        rig.root.position.set(position.x, position.y - RAGDOLL_PELVIS_TO_FEET, position.z);
        rig.activeAction?.fadeOut(0);
        rig.activeAction = null;
        deathAction?.reset();
        if (deathAction) deathAction.timeScale = 1;
        deathAction?.play();
        rig.everEnteredRagdoll = true;
        break;
      case "snapDown":
        // This rig's very first observation of this Character is already
        // Ragdoll (code review, M6 ticket 02 regression) — no real moment of
        // impact to animate from, so snap straight to the clip's own
        // fully-collapsed end frame rather than visibly popping upright to
        // play the fall from frame 0 on an already-downed body.
        rig.root.position.set(position.x, position.y - RAGDOLL_PELVIS_TO_FEET, position.z);
        rig.activeAction?.fadeOut(0);
        rig.activeAction = null;
        if (deathAction) {
          deathAction.reset();
          deathAction.time = deathAction.getClip().duration;
          deathAction.paused = true;
          deathAction.play();
        }
        rig.everEnteredRagdoll = true;
        break;
      case "resumeReverse": {
        const fallen = deathAction?.time ?? 0;
        if (deathAction) deathAction.timeScale = fallen > 0 ? -fallen / (GETUP_MS / 1000) : -1;
        if (deathAction) deathAction.paused = false;
        break;
      }
      case "coldReverse":
        // This rig never actually played the collapse (code review, M6 ticket
        // 02 regression) — start the reverse cold, from the clip's own
        // fully-collapsed end frame, the same anchor a real collapse would
        // have left it at.
        rig.root.position.set(position.x, position.y - RAGDOLL_PELVIS_TO_FEET, position.z);
        if (deathAction) {
          deathAction.reset();
          deathAction.time = deathAction.getClip().duration;
          deathAction.timeScale = -1;
          deathAction.paused = false;
          deathAction.play();
        }
        rig.everEnteredRagdoll = true;
        break;
      case "resume":
        deathAction?.stop();
        rig.root.position.set(position.x, position.y - CAPSULE_BOTTOM_OFFSET, position.z);
        rig.everEnteredRagdoll = false;
        {
          const resume = rig.actions.idle ?? rig.actions.walk;
          if (resume) {
            resume.reset().fadeIn(LOCOMOTION_CROSSFADE_SECONDS).play();
            rig.activeAction = resume;
          }
        }
        break;
      case "none":
        if (!isDownMotionState(motionState)) {
          rig.root.position.set(position.x, position.y - CAPSULE_BOTTOM_OFFSET, position.z);
        }
        break;
    }
    // While Ragdoll/GettingUp continue (plan "none" while down), the root stays put at the frozen anchor.

    if (isDownMotionState(motionState)) {
      rig.mixer.update(deltaSeconds);
      return;
    }

    // M6 ticket 03: Punch/HitReact take priority over ordinary locomotion
    // while playing — mirrors `scene.ts`'s own local handling exactly.
    const reacting = rig.hitReactionPlayer.update(hitEpoch, hitReactEpoch, rig.actions, LOCOMOTION_CROSSFADE_SECONDS);
    if (reacting) {
      rig.activeAction = reacting;
      rig.mixer.update(deltaSeconds);
      rig.root.rotation.y = Math.PI - facing;
      return;
    }

    const horizontalSpeed = Math.hypot(velocity.x, velocity.z);
    const moving = horizontalSpeed > MOVING_SPEED_THRESHOLD;
    const next = actionFor(selectLocomotion(moving, grounded, dashing), rig.actions);
    rig.activeAction = crossfadeLocomotion(next, rig.activeAction, LOCOMOTION_CROSSFADE_SECONDS);
    rig.mixer.update(deltaSeconds);

    // ADR 0045: oriented by the Character's own replicated facing, already
    // smoothly interpolated (shortest-arc) upstream — no extra turn-rate
    // clamp here, unlike the local Character's cosmetic turn easing, which
    // exists for a different reason (weighty *predicted* turning feel, not
    // smoothing across snapshots).
    rig.root.rotation.y = Math.PI - facing;
  };

  return {
    apply: (characters, deltaSeconds) => {
      for (const [id, rc] of Object.entries(characters)) {
        let rig = rigs.get(id);
        if (!rig) {
          rig = buildRig(id);
          rigs.set(id, rig);
        }
        updateRig(rig, rc, deltaSeconds);
      }
      for (const [id, rig] of rigs) {
        if (id in characters) continue;
        scene.remove(rig.root);
        disposeRemoteRig(rig.root);
        rigs.delete(id);
      }
    },
    dispose: () => {
      for (const rig of rigs.values()) {
        scene.remove(rig.root);
        disposeRemoteRig(rig.root);
      }
      rigs.clear();
    },
  };
};
