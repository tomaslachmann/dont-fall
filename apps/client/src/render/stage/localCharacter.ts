import {
  GRAB_TURN_SPEED_MULTIPLIER,
  CAPSULE_BOTTOM_OFFSET,
  DASH_SPEED,
  isDownMotionState,
  type CharacterMotionState,
  type RenderCharacter,
  type Vec3,
} from "@dont-fall/shared";
import * as THREE from "three";
import { carriedFlail, restCarriedHang, type CarriedHang } from "../carriedFlail.js";
import {
  actionFor,
  CHARACTER_VISUAL_HEIGHT,
  crossfadeLocomotion,
  loadCharacterActions,
  LOCOMOTION_CROSSFADE_SECONDS,
  MODEL_YAW_OFFSET,
  pinClipPose,
  type CharacterModel,
} from "../characterModel.js";
import { blendFloatStruggle, FloatLimbs } from "../floatPose.js";
import { Footsteps, steppingClip, type SteppingClip } from "../footsteps.js";
import { GrabAnimations } from "../grabAnimation.js";
import type { Wardrobe } from "../hats.js";
import { HitReactionPlayer } from "../hitReactionPlayer.js";
import type { IceFootingQuery } from "../iceFooting.js";
import { JUMP_CROSSFADE_SECONDS, JumpSequences, jumpPoseAt, jumpTimeline } from "../jumpSequence.js";
import {
  KNOCKDOWN_CROSSFADE_SECONDS,
  KnockdownOrigin,
  Knockdowns,
  knockdownFeetY,
  type FloorQuery,
} from "../knockdownAnimation.js";
import { selectLocomotion } from "../locomotionAnimation.js";
import {
  clampSpinMomentum,
  decayedSpinMomentum,
  facingFromModelYaw,
  measuredYawRate,
  modelYawFromFacing,
  nextModelYaw,
} from "../modelFacing.js";
import { tintHueForColor } from "../playerTint.js";
import { setShadowRole } from "../shadowRoles.js";
import type { SkinCloset } from "../skins.js";
import type { Stage } from "../scene.js";

/** What the local Character needs from the rest of the Stage. */
export interface LocalCharacterWorld {
  /** The floor under a knocked-down body (ADR 0076). */
  floorBelow: FloorQuery;
  /** Whether a point is held aloft by a Volume (ADR 0077). */
  inUpdraft: (point: Vec3) => boolean;
  /** Whether a point stands on ice (ADR 0082). */
  onIce: IceFootingQuery;
  /** One of its feet came down (M14 ticket 04). */
  onFootstep: (clip: SteppingClip, centre: Vec3) => void;
  /** The Dash's speed lines, which this Character's own Dash drives. */
  speedLines: { setIntensity: (intensity: number) => void };
  /** Shared with every remote rig, so a hat or a skin several Players wear loads once. */
  wardrobe: Wardrobe;
  closet: SkinCloset;
}

/** The one Character this Stage predicts and draws for its own Player. */
export interface LocalCharacter {
  /** Place the rig from an interpolated snapshot — at the feet, or where the knockdown stands it. */
  place: (character: RenderCharacter) => void;
  /** Advance its animation and turn it — `Stage.updateCharacterAnimation`, argument for argument. */
  animate: Stage["updateCharacterAnimation"];
  /** Dress it: its equipped skin, else its color (ADR 0091). */
  setLook: (color: number | null, skin: string | null) => void;
  /** Put a hat on it, or take it off for `null` (ADR 0083). */
  setHat: (hat: string | null) => void;
  /** Where its body is turned right now (ADR 0085). */
  facing: () => number;
  /** Its capsule centre as last placed, `null` before the first snapshot. */
  centre: () => Vec3 | null;
  /** Stop its mixer and drop the clips cached against the rig, before the rig is freed. */
  dispose: () => void;
}

/**
 * Sets up the local Character's rig in `scene` and returns what drives it.
 * Must run before any remote rig is cloned from `characterModel`: the scale,
 * the feet and the facing correction set here are what every clone inherits.
 */
export const createLocalCharacter = (
  scene: THREE.Scene,
  characterModel: CharacterModel,
  { floorBelow, inUpdraft, onIce, onFootstep, speedLines, wardrobe, closet }: LocalCharacterWorld,
): LocalCharacter => {
  // `character` is the runtime placement handle: its position is the capsule's
  // ground-contact point (feet), its yaw the cosmetic facing (`bodyYaw`).
  // The loaded model's own pivot/scale quirks are corrected once, on the child.
  const character = new THREE.Group();
  const naturalBounds = new THREE.Box3().setFromObject(characterModel.scene);
  const naturalHeight = naturalBounds.getSize(new THREE.Vector3()).y;
  const naturalFeetY = naturalBounds.min.y;
  const modelScale = naturalHeight > 0 ? CHARACTER_VISUAL_HEIGHT / naturalHeight : 1;
  characterModel.scene.scale.setScalar(modelScale);
  characterModel.scene.position.y = -naturalFeetY * modelScale;
  // …and which way it faces (ADR 0071). BLIP is authored looking down +Z while
  // a Track runs toward −Z. Corrected here with the scale and the feet, on the
  // child, so every remote clone inherits it and nothing downstream — the
  // cosmetic facing on `character`, the ragdoll's bone mapping — has to know.
  characterModel.scene.rotation.y = MODEL_YAW_OFFSET;
  // Marked before any remote rig is cloned from it, so every clone casts too.
  setShadowRole(characterModel.scene, "caster");
  character.add(characterModel.scene);
  character.position.y = CAPSULE_BOTTOM_OFFSET; // arbitrary until the first `place`
  scene.add(character);

  const mixer = new THREE.AnimationMixer(characterModel.scene);
  // A knockdown plays the rig's own KO and GetUp clips (ADR 0076); the
  // physics ragdoll underneath still decides where the body is.
  const actions = loadCharacterActions(mixer, characterModel.animations);
  const { idle: idleAction } = actions;
  let activeAction: THREE.AnimationAction | null = idleAction;
  activeAction?.play();

  /** The last `motionState` seen, to detect the Ragdoll/GettingUp/Controlled edges. */
  let visualState: CharacterMotionState = "Controlled";
  /** Drives the Punch/HitReact one-shot overlays (M6 ticket 03). */
  const hitReactionPlayer = new HitReactionPlayer();
  /** The hold, the struggle, and a reach at nobody (ADR 0071). */
  const grabAnimations = new GrabAnimations();
  const jumpSequences = new JumpSequences();
  const localJumpTimeline = jumpTimeline(actions);
  /** The fall, the get-up, and the get-up's tail (ADR 0076). */
  const knockdowns = new Knockdowns();
  /** A Floating Character's arms, legs and crest (ADR 0077). */
  const localFloatLimbs = new FloatLimbs(characterModel.scene);
  /** Where the knocked-down rig stands, vertically (ADR 0076). */
  const localOrigin = new KnockdownOrigin();
  /** Counts this Character's own steps (M14 ticket 04); a remote rig counts its own. */
  const footsteps = new Footsteps();
  /** The replicated velocity, stashed by `place`: the push a fall reads its direction from. */
  let localVelocity: Vec3 = { x: 0, y: 0, z: 0 };
  /** The capsule centre, stashed by `place`. */
  let localCentre: Vec3 | null = null;
  const modelQuaternion = new THREE.Quaternion();
  /** This body's damped hang while someone carries it (ADR 0104's drawn hold) — `null` on its feet. */
  let carriedHang: CarriedHang | null = null;
  /** The released Spin's leftover turn (rad/s), bleeding off — see `decayedSpinMomentum`. */
  let spinMomentum = 0;
  /** The yaw rate the last Spin-pinned frame turned at, the momentum's seed. */
  let lastSpinRate = 0;
  /** Whether the previous frame's yaw was pinned by a Spin — the release edge seeds the momentum. */
  let wasSpinPinned = false;
  /**
   * The body's yaw (model convention, `atan2(x, z)`) — what every branch
   * turns, what the rig is written from, and what {@link LocalCharacter.facing}
   * sends (ADR 0085). Kept here rather than read back off `character.rotation.y`
   * (ADR 0109): a carry sets the rig's orientation whole, and three.js then
   * reads its Euler angles back off the quaternion with y in [−π/2, π/2] —
   * past a quarter turn as (π, π − yaw, π). Read back, a body held at facing
   * 0.3 sent 2.84 for the whole carry and was let go of facing the mirror of
   * where it had hung, on the server and every other screen too.
   */
  let bodyYaw = 0;

  // The model's own body look (M9 ticket 15, ADR 0091) — the closet drops a
  // `setLook` that changes nothing, since restyling clones every material.
  let localColor: number | null = null;
  let localSkin: string | null = null;

  return {
    place: ({ position, motionState, velocity }) => {
      localCentre = position;
      localVelocity = velocity;
      const fallingRagdoll = motionState === "Ragdoll";
      const gettingUp = motionState === "GettingUp";
      const enteringRagdoll = fallingRagdoll && visualState !== "Ragdoll";
      const enteringGettingUp = gettingUp && visualState !== "GettingUp";
      // Covers both the normal GettingUp → Controlled completion AND a
      // reconciliation snapping straight from Ragdoll to Controlled (the
      // server rejected a knockdown the client mispredicted, skipping the
      // GettingUp frame entirely): either way the next knockdown must stand
      // up from wherever it happens, not from this one's floor.
      const wasDown = isDownMotionState(visualState);
      const leavingDown = !fallingRagdoll && !gettingUp && wasDown;
      visualState = motionState;

      if (fallingRagdoll || gettingUp) {
        // The rig stands where the Character is (ADR 0076): `position` is the
        // physics pelvis while down, so the origin is the floor under it, or
        // where standing feet would be when the body is in the air. The pose
        // is the knockdown's own clips, set in `animate`.
        if (enteringRagdoll || enteringGettingUp) hitReactionPlayer.stop(actions);
        const floorY = floorBelow(position.x, position.y, position.z);
        const originY = localOrigin.place(floorY, knockdownFeetY(motionState, position.y), performance.now());
        character.position.set(position.x, originY, position.z);
      } else if (leavingDown) {
        // Back on its feet, at the real capsule position. The get-up's own
        // clip is still the active action, so locomotion fades in from it.
        localOrigin.reset();
        character.position.set(position.x, position.y - CAPSULE_BOTTOM_OFFSET, position.z);
      } else {
        // `position` is the capsule centre; the model rig is placed at the feet.
        character.position.set(position.x, position.y - CAPSULE_BOTTOM_OFFSET, position.z);
      }
    },

    animate: (
      deltaSeconds,
      moveDirection,
      grounded,
      dashing,
      dashSpeed,
      verticalVelocity,
      hitEpoch,
      hitReactEpoch,
      grabEpoch,
      hold,
    ) => {
      if (visualState !== "Controlled") {
        speedLines.setIntensity(0);
      }

      const moving = moveDirection.x !== 0 || moveDirection.z !== 0;
      // The knockdown (ADR 0076), advanced every frame: this call is also what
      // ends it. The get-up's last frames play on in Controlled only while
      // the Player does nothing. A held Grab counts as doing something, in
      // either role.
      characterModel.scene.getWorldQuaternion(modelQuaternion);
      const knockdownPose = knockdowns.advance(
        "local",
        {
          motionState: visualState,
          velocity: localVelocity,
          modelQuaternion,
          busy: moving || dashing || !grounded || hold.role !== "free",
          deltaSeconds,
        },
        actions,
      );

      // No steps to count across a knockdown. Landings are heard in
      // `applyCharacterSounds`.
      if (isDownMotionState(visualState)) footsteps.forget("local");

      // While down, the knockdown owns the whole body, and the model keeps
      // the yaw it went down with.
      if (isDownMotionState(visualState)) {
        // Code review, M6.1: keeps the reaction baseline current even though
        // no reaction may play while down — see `observeBaseline`'s own doc.
        hitReactionPlayer.observeBaseline(hitEpoch, hitReactEpoch);
        // Getting up is not the end of whatever jump it went down in.
        jumpSequences.forget("local");
        // Nor is it the end of a hold: no release tail after the get-up, no
        // leftover carry tilt or Spin momentum under the KO clips (ADR 0104).
        grabAnimations.forget("local");
        carriedHang = null;
        spinMomentum = 0;
        wasSpinPinned = false;
        // Written whole, not by zeroing a carry's tilt off x/z: those Euler
        // angles were read back off the carry's quaternion (see `bodyYaw`),
        // and zeroing them mirrored the yaw of a body hurled into a knockdown.
        character.rotation.set(0, bodyYaw, 0);
        blendFloatStruggle(actions, 0, activeAction);
        if (knockdownPose) {
          activeAction = crossfadeLocomotion(knockdownPose.action, activeAction, KNOCKDOWN_CROSSFADE_SECONDS);
          pinClipPose(knockdownPose);
          mixer.update(deltaSeconds);
        }
        return;
      }

      const nowMs = performance.now();
      // The jump, all five pieces end to end, paced to the real arc so every
      // frame of it is seen (ADR 0071). Advanced before the reaction below may
      // take the frame, so a Punch thrown in the air doesn't freeze the jump's
      // clock underneath it.
      const jumpPlayhead = localJumpTimeline
        ? jumpSequences.advance(
            "local",
            {
              grounded,
              verticalVelocity,
              height: character.position.y,
              moving,
              deltaSeconds,
              nowMs,
              inUpdraft: localCentre !== null && inUpdraft(localCentre),
            },
            localJumpTimeline,
          )
        : null;
      // A Grab owns the whole body while it plays (ADR 0071): the authored
      // hold in either role, and the reach of an attempt that caught nobody.
      // A held body kicks, or hangs Limp (ADR 0104). Also asked before the
      // reaction below, so an attempt made during one isn't lost.
      const grabPose = grabAnimations.pose("local", hold.role, grabEpoch, grounded, nowMs, actions, hold.phase === "limp");

      // M6 ticket 03: Punch/HitReact take priority over ordinary locomotion
      // while playing — the caller (this method) never picks a locomotion
      // clip on a frame where a reaction is still in progress.
      const reacting = hitReactionPlayer.update(hitEpoch, hitReactEpoch, actions, LOCOMOTION_CROSSFADE_SECONDS, activeAction);
      if (reacting) {
        knockdowns.forget("local");
        // The reaction restarts the gait it hands back to: no step to count across it.
        footsteps.forget("local");
        activeAction = reacting;
        mixer.update(deltaSeconds);
        return;
      }

      // A grounded playhead is the landing, drawn over locomotion. It is
      // suppressed while Stagger owns the body: a Respawn drops the Character
      // at its Checkpoint, and the wobble is the whole point of that landing
      // (ADR 0072).
      const jumpPose =
        jumpPlayhead === null || (grounded && visualState !== "Controlled") ? null : jumpPoseAt(jumpPlayhead, actions);
      // The get-up's tail only survives a frame with nothing else to draw.
      const posed = grabPose ?? jumpPose ?? knockdownPose;
      // A Dash with no direction held plays from lastMoveDir (see DashController),
      // so it must still select a locomotion clip even though moveDirection is zero.
      // `visualState` is the replicated motion state this rig is drawing —
      // `Stagger` is the Wobble (ADR 0072), whether it came from a light hit
      // or from coming back off a Respawn. Ice wobbles too (ADR 0082). Walk or
      // Run is the Character's own speed (ADR 0081).
      const next =
        posed?.action ??
        actionFor(
          selectLocomotion({
            moving,
            grounded,
            dashing,
            wobbling: visualState === "Stagger",
            onIce: localCentre !== null && onIce(localCentre),
            speed: Math.hypot(localVelocity.x, localVelocity.z),
            walking: activeAction !== null && activeAction === actions.walk,
          }),
          actions,
        );
      // Gaits blend into each other over a long fade, keeping their step. The
      // jump's pieces get a short one: at gait length, a quarter-second piece
      // never reaches full weight.
      activeAction = crossfadeLocomotion(
        next,
        activeAction,
        posed === null
          ? LOCOMOTION_CROSSFADE_SECONDS
          : posed === jumpPose
            ? JUMP_CROSSFADE_SECONDS
            : posed === knockdownPose
              ? KNOCKDOWN_CROSSFADE_SECONDS
              : LOCOMOTION_CROSSFADE_SECONDS,
        actions,
      );
      if (posed) pinClipPose(posed);
      // A Float's overlay (ADR 0077), only ever under the jump's own pose.
      const floatWeight = posed !== null && posed === jumpPose ? jumpSequences.floatWeight("local") : 0;
      blendFloatStruggle(actions, floatWeight, activeAction);
      mixer.update(deltaSeconds);
      localFloatLimbs.apply(floatWeight, verticalVelocity, nowMs);

      // Footsteps (M14 ticket 04): where the stepping clip puts a foot down,
      // on the ground, not Sliding, with nothing posed over the legs.
      const stepping =
        posed === null && grounded && visualState !== "Sliding" && (moving || dashing) ? steppingClip(activeAction, actions) : null;
      const feetDown = footsteps.update("local", stepping ? activeAction : null);
      if (stepping && localCentre) for (let foot = 0; foot < feetDown; foot += 1) onFootstep(stepping, localCentre);

      // ADR 0104: a body the sim turns — Held, or Spinning someone — is drawn
      // where the sim has it; a grabber turns itself, but slower. A Spin that
      // just let go keeps its whirl and bleeds it off (`decayedSpinMomentum`)
      // instead of freezing mid-frame — and since this drawn yaw IS the
      // facing the client sends (ADR 0085), the spin-down is what the server
      // and every other client see too.
      const spinPinned = hold.role === "grabbing" && hold.pinnedFacing !== null;
      if (hold.pinnedFacing !== null) {
        const pinnedYaw = modelYawFromFacing(hold.pinnedFacing);
        if (spinPinned) lastSpinRate = measuredYawRate(pinnedYaw, bodyYaw, deltaSeconds);
        bodyYaw = pinnedYaw;
        spinMomentum = 0;
      } else {
        if (wasSpinPinned) spinMomentum = clampSpinMomentum(lastSpinRate);
        bodyYaw = nextModelYaw({
          currentYaw: bodyYaw + spinMomentum * deltaSeconds,
          moveDirection,
          deltaSeconds,
          turnScale: hold.role === "grabbing" ? GRAB_TURN_SPEED_MULTIPLIER : 1,
        });
        spinMomentum = decayedSpinMomentum(spinMomentum, deltaSeconds);
      }
      wasSpinPinned = spinPinned;

      // Carried (ADR 0104's drawn hold): this body hangs from its grabber's
      // grip and streams with the carry's speed — your own screen shows you
      // whirled exactly as everyone else sees you.
      if (hold.role === "held" && hold.pinnedFacing !== null && localCentre !== null) {
        carriedHang ??= restCarriedHang();
        const placed = carriedFlail(
          carriedHang,
          { centre: localCentre, facing: hold.pinnedFacing, velocity: localVelocity },
          bodyYaw,
          CAPSULE_BOTTOM_OFFSET,
          deltaSeconds,
        );
        character.position.copy(placed.feet);
        character.quaternion.copy(placed.quaternion);
      } else {
        // Upright, turned to the body's yaw — written whole every frame, so a
        // body fresh out of the carry sheds the hang's tilt without its yaw
        // ever being read back off the tilted rig (see `bodyYaw`).
        carriedHang = null;
        character.rotation.set(0, bodyYaw, 0);
      }

      if (visualState === "Controlled") {
        // Speed lines: driven directly by the Dash's own envelope value
        // (0 when not dashing, ramping via the same `dashEnvelope` curve
        // driving the physics) rather than a velocity derived from position
        // deltas — a simulation-owned value needs no noise margin and can't
        // be perturbed by a reconciliation correction.
        speedLines.setIntensity(dashSpeed / DASH_SPEED);
      }
    },

    setLook: (color, skin) => {
      if (color === localColor && skin === localSkin) return;
      localColor = color;
      localSkin = skin;
      // Unknown color (or a newer server's unlock this client has no hue
      // for): the default, like every other Character without one. Base is
      // `null`, not unknown — `tintHueForColor` keeps the two apart. An
      // unknown *skin* id is simply no skin, and the color shows.
      closet.wear(character, skin, tintHueForColor(color));
    },

    // On the rig itself, which every remote rig is cloned from: the pool's
    // first `wear` takes the copied hat off each clone.
    setHat: (hat) => wardrobe.wear(characterModel.scene, hat),

    facing: () => facingFromModelYaw(bodyYaw),

    centre: () => localCentre,

    dispose: () => {
      // Stop the mixer before the rig it animates is disposed, and drop the
      // clips it cached against that rig — the mixer keeps them keyed by root
      // object, so a second game booting with a freshly loaded model would
      // otherwise leave the first run's action cache alive.
      mixer.stopAllAction();
      mixer.uncacheRoot(characterModel.scene);
    },
  };
};
