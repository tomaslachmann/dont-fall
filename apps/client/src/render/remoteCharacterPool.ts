import { CAPSULE_BOTTOM_OFFSET, isDownMotionState, type RenderCharacter, type Vec3 } from "@dont-fall/shared";
import * as THREE from "three";
import { clone as cloneRig } from "three/addons/utils/SkeletonUtils.js";
import { ARM_REACH_TARGET_HEIGHT, createArmReachPlayer, type ArmReachPlayer } from "./armReach.js";
import { createRagdollPose, type RagdollPose } from "./ragdollPose.js";
import {
  actionFor,
  crossfadeLocomotion,
  loadCharacterActions,
  LOCOMOTION_CROSSFADE_SECONDS,
  RAGDOLL_PELVIS_TO_FEET,
  type CharacterActions,
  type CharacterModel,
} from "./characterModel.js";
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
  /** Drives this rig straight from the ragdoll's bones while its Character is down (M6.1 ticket 02). */
  pose: RagdollPose;
  /** Drives this rig's own Punch/HitReact one-shot overlays (M6 ticket 03). */
  hitReactionPlayer: HitReactionPlayer;
  /** Looked up once — this rig's own arm bones, for Grab's arm-reach pose (M6.1). */
  armReachPlayer: ArmReachPlayer;
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
  /**
   * Create/update/remove rigs to match `characters`, and advance every
   * surviving rig's animation by `deltaSeconds`. `localId`/`localPosition`
   * (M6.1) resolve a rig's own arm-reach target when it's grabbing the LOCAL
   * player specifically — the one Character never present in `characters`,
   * since that map only ever holds every OTHER Character.
   */
  apply: (characters: Record<string, RenderCharacter>, deltaSeconds: number, localId: string, localPosition: Vec3) => void;
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
      pose: createRagdollPose(root),
      hitReactionPlayer: new HitReactionPlayer(),
      armReachPlayer: createArmReachPlayer(root),
    };
  };

  const updateRig = (
    rig: RemoteRig,
    rc: RenderCharacter,
    deltaSeconds: number,
    resolvePosition: (id: string) => Vec3 | undefined,
  ): void => {
    const { position, motionState, velocity, grounded, dashing, facing, hitEpoch, hitReactEpoch, grabbingId } = rc;
    if (isDownMotionState(motionState)) {
      // Code review, M6.1: keeps the reaction baseline current even though
      // the down-state pose owns the model and the mixer isn't advanced
      // below — see `HitReactionPlayer.observeBaseline`'s own doc.
      rig.hitReactionPlayer.observeBaseline(hitEpoch, hitReactEpoch);
      // The same bone-driven knockdown the local Character gets (M6.1 ticket
      // 02, ADR 0048), from the same `bones` — already interpolated between
      // snapshots upstream. This retires `planDeathClip` outright: its four
      // cases existed only to decide how to wind a canned clip when a rig
      // joined mid-fall or never saw the collapse, and a pose taken straight
      // from the bones has nothing to wind. Whenever you start watching, the
      // bones already say exactly what the body is doing.
      if (rig.activeAction) {
        // Stopped, not faded: a faded action stays bound, and the mixer is
        // deliberately not advanced below, so nothing would ever finish the
        // fade. Running it *after* the pose would overwrite the pose anyway.
        rig.activeAction.stop();
        rig.activeAction = null;
        rig.hitReactionPlayer.stop(rig.actions);
      }
      rig.root.position.set(position.x, position.y - RAGDOLL_PELVIS_TO_FEET, position.z);
      rig.pose.apply(rc.bones);
      return;
    }

    if (rig.pose.isPosing) {
      // Back on its feet — drop the anchor and hand the rig to locomotion.
      rig.pose.release();
      const resume = rig.actions.idle ?? rig.actions.walk;
      if (resume) {
        resume.reset().fadeIn(LOCOMOTION_CROSSFADE_SECONDS).play();
        rig.activeAction = resume;
      }
    }
    rig.root.position.set(position.x, position.y - CAPSULE_BOTTOM_OFFSET, position.z);

    // M6 ticket 03: Punch/HitReact take priority over ordinary locomotion
    // while playing — mirrors `scene.ts`'s own local handling exactly.
    const reacting = rig.hitReactionPlayer.update(hitEpoch, hitReactEpoch, rig.actions, LOCOMOTION_CROSSFADE_SECONDS, rig.activeAction);
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

    // M6.1: no Grab clip exists on the rig — see `scene.ts`'s own identical
    // arm-reach call for the local Character. Called every frame regardless
    // of grab state — `armReachPlayer` eases the pose in and out itself.
    const targetPosition = grabbingId ? resolvePosition(grabbingId) : undefined;
    rig.armReachPlayer.update(
      targetPosition
        ? new THREE.Vector3(targetPosition.x, targetPosition.y + ARM_REACH_TARGET_HEIGHT, targetPosition.z)
        : undefined,
      deltaSeconds,
    );
  };

  return {
    apply: (characters, deltaSeconds, localId, localPosition) => {
      const resolvePosition = (id: string): Vec3 | undefined => (id === localId ? localPosition : characters[id]?.position);
      for (const [id, rc] of Object.entries(characters)) {
        let rig = rigs.get(id);
        if (!rig) {
          rig = buildRig(id);
          rigs.set(id, rig);
        }
        updateRig(rig, rc, deltaSeconds, resolvePosition);
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
