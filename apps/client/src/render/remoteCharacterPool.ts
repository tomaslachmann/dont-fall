import { CAPSULE_BOTTOM_OFFSET, isDownMotionState, type RenderCharacter, type Vec3 } from "@dont-fall/shared";
import * as THREE from "three";
import { clone as cloneRig } from "three/addons/utils/SkeletonUtils.js";
import { blendFloatStruggle, FloatLimbs } from "./floatPose.js";
import { GrabAnimations, grabRoleOf } from "./grabAnimation.js";
import { JUMP_CROSSFADE_SECONDS, JumpSequences, jumpPoseAt, jumpTimeline, type JumpTimeline } from "./jumpSequence.js";
import {
  KNOCKDOWN_CROSSFADE_SECONDS,
  KnockdownOrigin,
  Knockdowns,
  knockdownFeetY,
  type FloorQuery,
} from "./knockdownAnimation.js";
import {
  actionFor,
  crossfadeLocomotion,
  MODEL_YAW_OFFSET,
  loadCharacterActions,
  LOCOMOTION_CROSSFADE_SECONDS,
  pinClipPose,
  type CharacterActions,
  type CharacterModel,
} from "./characterModel.js";
import { HitReactionPlayer } from "./hitReactionPlayer.js";
import type { Wardrobe } from "./hats.js";
import type { IceFootingQuery } from "./iceFooting.js";
import { Footsteps, steppingClip, type SteppingClip } from "./footsteps.js";
import { selectLocomotion } from "./locomotionAnimation.js";
import { tintHueForSkin, tintModel } from "./playerTint.js";

/**
 * Above this horizontal speed (units/s), a remote Character reads as
 * "moving" for locomotion purposes — comfortably above float/ground-stick
 * residual at rest, comfortably below a real walk (`WALK_SPEED` = 6). Unlike
 * the local Character (which knows its own raw input directly), a remote
 * Character only ever has replicated `velocity` to infer this from.
 */
const MOVING_SPEED_THRESHOLD = 0.5;

interface RemoteRig {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: CharacterActions;
  activeAction: THREE.AnimationAction | null;
  /** Where this rig stands, vertically, while its Character is down (ADR 0076). */
  origin: KnockdownOrigin;
  /** This rig's own arms, legs and crest while Floating (ADR 0077). */
  floatLimbs: FloatLimbs;
  /** Drives this rig's own Punch/HitReact one-shot overlays (M6 ticket 03). */
  hitReactionPlayer: HitReactionPlayer;
  /** Where this rig's jump pieces sit end to end (ADR 0071) — `null` if it has none. */
  jumpTimeline: JumpTimeline | null;
  /** Looked up once — this rig's own arm bones, for Grab's arm-reach pose (M6.1). */
  /** The hue this rig currently wears — `setSkins` re-tints only on change (re-tinting clones every material). */
  appliedHue: number | null;
}

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
 * animation and knockdown handling exactly (ADR 0076), driven from each remote
 * Character's replicated `RenderCharacter` fields instead of live local
 * input/state, since a remote Character is only ever interpolated, never
 * predicted (ADR 0003).
 */
export interface RemoteCharacterPool {
  /**
   * Create/update/remove rigs to match `characters`, and advance every
   * surviving rig's animation by `deltaSeconds`. `localId`/`localPosition`
   * are vestigial since ADR 0071 — they fed the retired arm-aiming, and the
   * authored Grab clips need no target; kept on the signature for now so the
   * two call sites (`scene.ts`, `practice.ts`) stay untouched. `localId`/`localPosition`
   * (M6.1) resolve a rig's own arm-reach target when it's grabbing the LOCAL
   * player specifically — the one Character never present in `characters`,
   * since that map only ever holds every OTHER Character.
   */
  apply: (characters: Record<string, RenderCharacter>, deltaSeconds: number, localId: string, localPosition: Vec3) => void;
  /**
   * Refresh equipped skins by session id (M9 ticket 15) — the stage calls
   * this off every snapshot's lobby roster, before `apply`, so a rig built
   * this frame already wears its skin. Rigs standing since before their
   * seat's `auth` resolved (built in the default skin) re-tint to the
   * arriving skin; everything else keeps its hue (a re-tint clones every
   * material, so unchanged rigs are never touched).
   */
  setSkins: (next: ReadonlyMap<string, number | null>) => void;
  /**
   * Refresh equipped hats by session id (ADR 0083), off the same roster as
   * `setSkins` and before `apply` for the same reason. A rig is only
   * re-dressed when its hat changed.
   */
  setHats: (next: ReadonlyMap<string, string | null>) => void;
  /** Tear down every pooled rig still standing — this rig's own exclusively-owned GPU resources included (`disposeRemoteRig`). */
  dispose: () => void;
}

/** What a remote rig asks of the Stage's world. */
export interface RemotePoolWorld {
  /** The floor under a point: a knocked-down rig stands on it (ADR 0076). Without one, it stands where its feet would be. */
  floorBelow?: FloorQuery;
  /** Whether a capsule centre is inside a Volume that holds a Character up (ADR 0077). Without one, nobody Floats. */
  inUpdraft?: (point: Vec3) => boolean;
  /** Whether a Character with this capsule centre stands on ice (ADR 0082). Without one, there is no ice. */
  onIce?: IceFootingQuery;
  /** Puts each rig's hat on (ADR 0083). Without one, nobody wears a hat. */
  wardrobe?: Wardrobe;
  /** A rig's foot came down in `clip`, the Character's capsule centre at `centre` (M14 ticket 04). Without one, nobody is heard stepping. */
  onFootstep?: (clip: SteppingClip, centre: Vec3) => void;
}

export const createRemoteCharacterPool = (
  scene: THREE.Scene,
  characterModel: CharacterModel,
  { floorBelow = () => null, inUpdraft = () => false, onIce = () => false, wardrobe, onFootstep }: RemotePoolWorld = {},
): RemoteCharacterPool => {
  const rigs = new Map<string, RemoteRig>();
  /** Equipped skins by session id (M9 ticket 15) — the stage refreshes this off every snapshot's lobby roster. */
  const skins = new Map<string, number | null>();
  /** Equipped hats by session id (ADR 0083), refreshed the same way. */
  const hats = new Map<string, string | null>();

  /** Takes a rig's hat off before its materials are freed: a worn hat's belong to the wardrobe. */
  const retire = (rig: RemoteRig): void => {
    wardrobe?.wear(rig.root, null);
    scene.remove(rig.root);
    disposeRemoteRig(rig.root);
  };

  const grabAnimations = new GrabAnimations();
  const jumpSequences = new JumpSequences();
  const footsteps = new Footsteps();
  const knockdowns = new Knockdowns();

  const buildRig = (id: string): RemoteRig => {
    // `cloneRig` copies the source root's own transform too — by the time any
    // remote rig is ever built (well after `createStage`'s own local-model
    // setup already scaled/repositioned `characterModel.scene` in place),
    // every clone inherits that same scale/feet-offset for free, with no
    // separate bounds computation needed here.
    const root = cloneRig(characterModel.scene);
    const appliedHue = tintHueForSkin(skins.get(id) ?? null);
    tintModel(root, appliedHue);
    // Even with no hat of its own: the clone copied whatever the local
    // Character wears, and this takes that copy off.
    wardrobe?.wear(root, hats.get(id) ?? null);
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
      origin: new KnockdownOrigin(),
      floatLimbs: new FloatLimbs(root),
      hitReactionPlayer: new HitReactionPlayer(),
      jumpTimeline: jumpTimeline(actions),
      appliedHue,
    };
  };

  const updateRig = (id: string, rig: RemoteRig, rc: RenderCharacter, deltaSeconds: number): void => {
    const {
      position,
      motionState,
      velocity,
      grounded,
      dashing,
      facing,
      hitEpoch,
      hitReactEpoch,
      grabEpoch,
      grabbingId,
      heldByGrabberId,
    } = rc;
    const horizontalSpeed = Math.hypot(velocity.x, velocity.z);
    const moving = horizontalSpeed > MOVING_SPEED_THRESHOLD;
    const nowMs = performance.now();
    // The knockdown, exactly as the local Character draws it (ADR 0076). The
    // rig root is a direct child of the scene, so its own rotation is the
    // model's world rotation. While down, `velocity` is the ragdoll's: the push.
    const knockdownPose = knockdowns.advance(
      id,
      {
        motionState,
        velocity,
        modelQuaternion: rig.root.quaternion,
        busy: moving || dashing || !grounded || grabbingId !== null || heldByGrabberId !== null,
        deltaSeconds,
      },
      rig.actions,
    );

    if (isDownMotionState(motionState)) {
      footsteps.forget(id);
      // Code review, M6.1: keeps the reaction baseline current even though
      // no reaction may play while down — see
      // `HitReactionPlayer.observeBaseline`'s own doc.
      rig.hitReactionPlayer.observeBaseline(hitEpoch, hitReactEpoch);
      rig.hitReactionPlayer.stop(rig.actions);
      // Getting up is not the end of whatever jump it went down in.
      jumpSequences.forget(id);
      blendFloatStruggle(rig.actions, 0, rig.activeAction);
      // Standing where the Character is, on the floor under it or with the
      // body in the air, and keeping the yaw it went down with. A rig that
      // starts watching mid-knockdown plays from the phase it is shown.
      const originY = rig.origin.place(
        floorBelow(position.x, position.y, position.z),
        knockdownFeetY(motionState, position.y),
        nowMs,
      );
      rig.root.position.set(position.x, originY, position.z);
      if (knockdownPose) {
        rig.activeAction = crossfadeLocomotion(knockdownPose.action, rig.activeAction, KNOCKDOWN_CROSSFADE_SECONDS);
        pinClipPose(knockdownPose);
        rig.mixer.update(deltaSeconds);
      }
      return;
    }

    rig.origin.reset();
    rig.root.position.set(position.x, position.y - CAPSULE_BOTTOM_OFFSET, position.z);

    // The jump sequence reads off replicated state, exactly as it does
    // locally (ADR 0071) — `velocity`, `grounded` and `position` are already
    // on the wire, so none of this adds to the protocol. Advanced before the
    // reaction below may take the frame, so a Punch thrown in the air doesn't
    // freeze the jump's clock underneath it.
    const jumpPlayhead = rig.jumpTimeline
      ? jumpSequences.advance(
          id,
          { grounded, verticalVelocity: velocity.y, height: position.y, moving, deltaSeconds, nowMs, inUpdraft: inUpdraft(position) },
          rig.jumpTimeline,
        )
      : null;
    // A Grab owns the body, exactly as it does locally (ADR 0071) — a hold in
    // either role, or the reach of an attempt that caught nobody.
    const grabPose = grabAnimations.pose(id, grabRoleOf(grabbingId, heldByGrabberId), grabEpoch, grounded, nowMs, rig.actions);

    // M6 ticket 03: Punch/HitReact take priority over ordinary locomotion
    // while playing — mirrors `scene.ts`'s own local handling exactly.
    const reacting = rig.hitReactionPlayer.update(hitEpoch, hitReactEpoch, rig.actions, LOCOMOTION_CROSSFADE_SECONDS, rig.activeAction);
    if (reacting) {
      knockdowns.forget(id);
      footsteps.forget(id);
      rig.activeAction = reacting;
      rig.mixer.update(deltaSeconds);
      rig.root.rotation.y = Math.PI + MODEL_YAW_OFFSET - facing;
      return;
    }

    // The landing (a grounded playhead) and the wobble both read off
    // `motionState` the same way they do locally (ADR 0072).
    const jumpPose =
      jumpPlayhead === null || (grounded && motionState !== "Controlled") ? null : jumpPoseAt(jumpPlayhead, rig.actions);
    // The get-up's tail only survives a frame with nothing else to draw.
    const posed = grabPose ?? jumpPose ?? knockdownPose;
    const next =
      posed?.action ??
      actionFor(
        selectLocomotion({
          moving,
          grounded,
          dashing,
          wobbling: motionState === "Stagger",
          onIce: onIce(position),
          speed: horizontalSpeed,
          walking: rig.activeAction !== null && rig.activeAction === rig.actions.walk,
        }),
        rig.actions,
      );
    rig.activeAction = crossfadeLocomotion(
      next,
      rig.activeAction,
      posed === null
        ? LOCOMOTION_CROSSFADE_SECONDS
        : posed === jumpPose
          ? JUMP_CROSSFADE_SECONDS
          : posed === knockdownPose
            ? KNOCKDOWN_CROSSFADE_SECONDS
            : LOCOMOTION_CROSSFADE_SECONDS,
      rig.actions,
    );
    if (posed) pinClipPose(posed);
    // A Float's overlay (ADR 0077), only ever under the jump's own pose.
    const floatWeight = posed !== null && posed === jumpPose ? jumpSequences.floatWeight(id) : 0;
    blendFloatStruggle(rig.actions, floatWeight, rig.activeAction);
    rig.mixer.update(deltaSeconds);
    rig.floatLimbs.apply(floatWeight, velocity.y, nowMs);

    // Footsteps (M14 ticket 04), under the local Character's own rule.
    const stepping =
      posed === null && grounded && motionState !== "Sliding" && (moving || dashing) ? steppingClip(rig.activeAction, rig.actions) : null;
    const feetDown = footsteps.update(id, stepping ? rig.activeAction : null);
    if (stepping && onFootstep) for (let foot = 0; foot < feetDown; foot += 1) onFootstep(stepping, position);

    // ADR 0045: oriented by the Character's own replicated facing, already
    // smoothly interpolated (shortest-arc) upstream — no extra turn-rate
    // clamp here, unlike the local Character's cosmetic turn easing, which
    // exists for a different reason (weighty *predicted* turning feel, not
    // smoothing across snapshots).
    // `MODEL_YAW_OFFSET` is folded in here rather than inherited: `cloneRig`
    // makes the model's own group the rig *root*, whose yaw this line
    // overwrites every frame — so a remote rig cannot pick the rig's forward
    // correction up from the clone the way the local Character does (ADR
    // 0071). Miss it and every other Player runs backwards.
    rig.root.rotation.y = Math.PI + MODEL_YAW_OFFSET - facing;

  };

  return {
    setSkins: (next) => {
      skins.clear();
      for (const [id, skin] of next) skins.set(id, skin);
      for (const [id, rig] of rigs) {
        const hue = tintHueForSkin(skins.get(id) ?? null);
        if (hue === rig.appliedHue) continue;
        tintModel(rig.root, hue);
        rig.appliedHue = hue;
      }
    },
    setHats: (next) => {
      hats.clear();
      for (const [id, hat] of next) hats.set(id, hat);
      for (const [id, rig] of rigs) wardrobe?.wear(rig.root, hats.get(id) ?? null);
    },
    apply: (characters, deltaSeconds) => {
      for (const [id, rc] of Object.entries(characters)) {
        let rig = rigs.get(id);
        if (!rig) {
          rig = buildRig(id);
          rigs.set(id, rig);
        }
        updateRig(id, rig, rc, deltaSeconds);
      }
      for (const [id, rig] of rigs) {
        if (id in characters) continue;
        retire(rig);
        rigs.delete(id);
        // The per-id bookkeeping is keyed by session id, not held on the rig,
        // so it outlives the rig unless dropped here — and an id that comes
        // back (a reconnect) would otherwise resume a hold or a jump that
        // belonged to the Character before it left.
        grabAnimations.forget(id);
        jumpSequences.forget(id);
        knockdowns.forget(id);
        footsteps.forget(id);
      }
    },
    dispose: () => {
      for (const rig of rigs.values()) retire(rig);
      rigs.clear();
      grabAnimations.reset();
      jumpSequences.reset();
      knockdowns.reset();
    },
  };
};
