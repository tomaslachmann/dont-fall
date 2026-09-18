import { CAPSULE_BOTTOM_OFFSET, RAGDOLL_BONES } from "@dont-fall/shared";

/** Standing height (units) the loaded model is rescaled to, a touch taller than the capsule. */
export const CHARACTER_VISUAL_HEIGHT = 2 * CAPSULE_BOTTOM_OFFSET + 0.35;
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { LocomotionState } from "./locomotionAnimation.js";
import { publicUrl } from "../lib/publicUrl.js";

/**
 * BLIP — the game's Character (ADR 0071), `apps/client/public/models/BLIP.glb`.
 * One self-contained GLB: three meshes (body and two eyes) over a 20-joint
 * skeleton, with fifty-one named clips authored for this game's own verbs
 * (`BLIP_Animated_v7.glb`: v6 with `Walk` and `Run` reworked to share one
 * stride and a new `Sprint`, ADR 0081), plus the body's `Hat_Tuck` morph
 * that hides the crest under a hat (ADR 0083).
 *
 * The file served is that rig as the *skins* pack exports it
 * (`BLIP_Character_Skins_v1.glb`, ADR 0091) — the same nodes, joints,
 * morph and clips as the cosmetics pack before it, with two additions the
 * skins need: a `TEXCOORD_0` UV channel on the body, and a body material
 * that carries a base-color map (the `starter-cream` texture, embedded)
 * rather than a flat cream factor. Every equipped skin is that one map
 * swapped (`render/skins.ts`); a body wearing a color clears it instead.
 * The older texture-less GLB cannot wear any of it — there is nothing to
 * map the art onto.
 *
 * It replaced MushroomKing (Quaternius, CC0), which was a stand-in with five
 * usable clips and no pelvis in its rig.
 */
const MODEL_URL = publicUrl("models/BLIP.glb");

/**
 * How far the rig's own forward is from the game's (radians) — **zero for
 * BLIP**, which is already authored the way the engine expects.
 *
 * Kept as a named constant rather than deleted because the next rig swap will
 * need to ask the question, and this is where the answer is measured. The
 * measurement, taken from the *loaded* scene graph (never the raw file):
 *
 * - The engine's yaw 0 means facing **+Z** — `scene.ts`'s own forward vector
 *   is `(sin yaw, 0, cos yaw)`.
 * - MushroomKing, the rig every convention here was built around, faces +Z:
 *   its head's own +Z axis lands on world `(0, −0.34, 0.94)`.
 * - BLIP faces +Z too — its eyes sit at `z = +0.69`.
 *
 * So no turn: an earlier π here (the file was read, not the loaded graph) spun
 * every Character to walk backwards — W drove it away from the camera facing
 * the wrong way, found live 2026-09-16. Left and right are a *separate*
 * question. The knockdown's six falls are measured against the loaded graph
 * too (`knockdownAnimation.ts`, pinned in `modelBones.test.ts`).
 */
export const MODEL_YAW_OFFSET = 0;

export interface CharacterModel {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}

/** Locomotion clip crossfade duration (s) — shared by the local Character and every real remote one (ADR 0046). */
export const LOCOMOTION_CROSSFADE_SECONDS = 0.15;

/**
 * Vertical distance from the ragdoll's pelvis (a Character's own reported
 * `position` while Ragdoll) down to where its feet stood: the pelvis rest
 * offset from the capsule centre plus the capsule's own centre-to-feet
 * distance. It is where a knocked-down rig stands while the body is in the
 * air (ADR 0076, `knockdownFeetY`). On a deck, the floor under it wins.
 */
export const RAGDOLL_PELVIS_TO_FEET =
  CAPSULE_BOTTOM_OFFSET + RAGDOLL_BONES.find((b) => b.name === "pelvis")!.restCenter.y;

export const loadCharacterModel = async (): Promise<CharacterModel> => {
  const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
  return { scene: gltf.scene, animations: gltf.animations };
};

/**
 * Which way a Character went down, as the rig names it (ADR 0071): forward or
 * back, optionally veering left or right. The knockdown and the getting-up
 * clips come in one of each, and the pair must agree — you get up the way you
 * fell.
 */
export const KNOCKDOWN_DIRECTIONS = ["F", "FL", "FR", "B", "BL", "BR"] as const;
export type KnockdownDirection = (typeof KNOCKDOWN_DIRECTIONS)[number];

/** The named clips a Character's rig plays — one `AnimationAction` per name, bound to one `mixer`/rig instance. */
export interface CharacterActions {
  idle: THREE.AnimationAction | null;
  /**
   * The three gaits (ADR 0081): `run` is the ordinary one, `walk` the slow
   * end of it, `sprint` the Dash. They share one stride (left foot down at
   * the start of each clip, right foot halfway), which is what lets
   * {@link crossfadeLocomotion} carry the step from one into the next.
   */
  walk: THREE.AnimationAction | null;
  run: THREE.AnimationAction | null;
  sprint: THREE.AnimationAction | null;
  /**
   * The jump's five pieces, played end to end as one sequence paced to the
   * real arc (`jumpSequence.ts`). Together they are exactly the rig's
   * `Jump_Full`. That clip itself stays unbound because it also lifts its own
   * root by 1.2 units, and the simulation already owns the height.
   */
  jumpStart: THREE.AnimationAction | null;
  jumpRise: THREE.AnimationAction | null;
  jumpApex: THREE.AnimationAction | null;
  jumpFall: THREE.AnimationAction | null;
  jumpLand: THREE.AnimationAction | null;
  /** Plays once on the striker the instant their own Hit swing fires (M6 ticket 03) — see `HitReactionPlayer`. */
  punch: THREE.AnimationAction | null;
  /** Plays once on a Character the instant it's on the receiving end of a landed Hit (M6 ticket 03) — see `HitReactionPlayer`. */
  hitReact: THREE.AnimationAction | null;
  /**
   * Going down, by direction: the knockdown (ADR 0076), held on its last
   * frame until the Character gets up. Posed by `Knockdowns`' own clock.
   */
  ko: Readonly<Record<KnockdownDirection, THREE.AnimationAction | null>>;
  /** Getting back up, by the same direction it went down. Its first frame is `ko`'s last. */
  getUp: Readonly<Record<KnockdownDirection, THREE.AnimationAction | null>>;
  /**
   * A collapse nobody gets up from, by direction. Bound for the day the game
   * has a death, and driven by nothing yet (ADR 0076). Its last frame is not
   * where `getUp` begins.
   */
  death: Readonly<Record<KnockdownDirection, THREE.AnimationAction | null>>;
  /**
   * The Grab, as a sequence: reach for them, then hold them at arm's length.
   * `grabHold` is the rig's `Grab_HoldOut` — its arms-out hold loop, whose
   * first frame IS `Grab_Reach`'s last (measured seam: 0°), so the reach
   * flows straight into the hold with nothing between. The rig's other hold —
   * the `Grab_Pull`/`Grab_HoldIn` hug against the chest — is deliberately
   * unbound: the game carries at arm's length (ADR 0104), and the hug put the
   * hands 0.7 units away from the body they were supposedly holding.
   */
  grabReach: THREE.AnimationAction | null;
  grabHold: THREE.AnimationAction | null;
  /** Letting go from arm's length — how a reach that caught nobody comes back in. */
  grabDropOut: THREE.AnimationAction | null;
  /** Being held: the struggle, on the ground and in the air. */
  struggleHeld: THREE.AnimationAction | null;
  struggleAir: THREE.AnimationAction | null;
  /**
   * Unsteady on your feet (ADR 0072) — the `Stagger` state, which had no
   * animation at all until this rig brought one. M1's procedural lean of the
   * same name (ADR 0010) was a different thing and stays switched off.
   */
  wobble: THREE.AnimationAction | null;
  /** The same wobble while moving — the legs step instead of standing still under it. */
  wobbleWalk: THREE.AnimationAction | null;
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
  /** A one-shot that hands back to ordinary locomotion the moment it ends. */
  const once = (name: string): THREE.AnimationAction | null => {
    const action = clipAction(name);
    if (action) action.setLoop(THREE.LoopOnce, 1);
    return action;
  };
  /** A one-shot that holds its last frame — a Character stays down until it gets up. */
  const held = (name: string): THREE.AnimationAction | null => {
    const action = once(name);
    if (action) action.clampWhenFinished = true;
    return action;
  };
  const byDirection = (
    clip: (direction: KnockdownDirection) => THREE.AnimationAction | null,
  ): Record<KnockdownDirection, THREE.AnimationAction | null> =>
    Object.fromEntries(KNOCKDOWN_DIRECTIONS.map((d) => [d, clip(d)])) as Record<
      KnockdownDirection,
      THREE.AnimationAction | null
    >;

  return {
    idle: clipAction("Idle"),
    walk: clipAction("Walk"),
    run: clipAction("Run"),
    sprint: clipAction("Sprint"),
    // Never looped: the jump sequence poses each piece frame by frame
    // (`pinClipPose`), so none of them runs on the mixer's own clock.
    // `Jump_Full` stays unbound — see the field's own comment.
    jumpStart: held("Jump_Start"),
    jumpRise: held("Jump_Rise"),
    jumpApex: held("Jump_Apex"),
    jumpFall: held("Jump_Fall"),
    jumpLand: held("Jump_Land"),
    punch: once("Punch"),
    hitReact: once("Hit_React"),
    ko: byDirection((d) => held(`KO_${d}`)),
    getUp: byDirection((d) => held(`GetUp_${d}`)),
    death: byDirection((d) => held(`Death_${d}`)),
    // Posed by the grab's own clock (`pinClipPose`), like the jump.
    grabReach: held("Grab_Reach"),
    grabHold: clipAction("Grab_HoldOut"),
    grabDropOut: held("Grab_DropOut"),
    struggleHeld: clipAction("Struggle_Held"),
    struggleAir: clipAction("Struggle_Air"),
    wobble: clipAction("Wobble"),
    wobbleWalk: clipAction("Wobble_Walk"),
  };
};

/** Whether a one-shot action (Punch, HitReact — never looping) has finished playing out. */
export const isOneShotFinished = (action: THREE.AnimationAction): boolean => action.time >= action.getClip().duration;

/**
 * Binds one authored clip by name (the screen previews' sequence player) —
 * `loadCharacterActions` covers the match's own verbs as fixed fields, but a
 * podium celebration or a menu hero addresses clips as data. `loop` repeats
 * the clip; one-shots clamp on their last frame so a held pose never snaps
 * back to the bind pose mid-crossfade. Missing names bind `null` — the
 * caller skips the step (and says which name it skipped).
 */
export const bindClipAction = (
  mixer: THREE.AnimationMixer,
  animations: THREE.AnimationClip[],
  name: string,
  loop: boolean,
): THREE.AnimationAction | null => {
  const clip = THREE.AnimationClip.findByName(animations, name);
  if (!clip) return null;
  const action = mixer.clipAction(clip);
  if (loop) action.setLoop(THREE.LoopRepeat, Infinity);
  else action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  return action;
};

/**
 * The actual clip for a {@link LocomotionState}. A rig missing a gait plays
 * the next slower one it has: `sprint` falls back to `run`, `run` to `walk`.
 */
export const actionFor = (state: LocomotionState, actions: CharacterActions): THREE.AnimationAction | null => {
  switch (state) {
    case "idle":
      return actions.idle;
    case "walk":
      return actions.walk;
    case "run":
      return actions.run ?? actions.walk;
    case "sprint":
      return actions.sprint ?? actions.run ?? actions.walk;
    case "jump":
      // Only the coarse fallback: the real choice is the jump sequence's
      // (`jumpPoseAt`), at the call site that has one.
      return actions.jumpRise ?? actions.jumpApex;
    case "wobble":
      // Falls back to the walk rather than to nothing: a rig without the clip
      // should still move its legs, just without the tell (ADR 0072).
      return actions.wobble ?? actions.walk;
    case "wobbleWalk":
      // A rig without it keeps the tell over the legs, as ADR 0072 chose.
      return actions.wobbleWalk ?? actions.wobble ?? actions.walk;
  }
};

/** One frame of an authored clip: the action, and how far into its own clip (s). */
export interface ClipPose {
  action: THREE.AnimationAction;
  time: number;
}

/**
 * `seconds` into `pieces` played back to back: the piece under that moment
 * and the time within it, or `null` once every piece has played. A missing
 * piece takes no time, so a partial rig still plays what it has.
 */
export const clipPoseInSequence = (
  seconds: number,
  pieces: readonly (THREE.AnimationAction | null)[],
): ClipPose | null => {
  let offset = 0;
  for (const action of pieces) {
    if (!action) continue;
    const duration = action.getClip().duration;
    if (seconds < offset + duration) return { action, time: Math.max(0, seconds - offset) };
    offset += duration;
  }
  return null;
};

/** The last frame of the last piece `pieces` has — where a played-out sequence rests. */
export const lastClipPose = (pieces: readonly (THREE.AnimationAction | null)[]): ClipPose | null => {
  for (let i = pieces.length - 1; i >= 0; i -= 1) {
    const action = pieces[i];
    if (action) return { action, time: action.getClip().duration };
  }
  return null;
};

/**
 * Holds `pose.action` on `pose.time`, for a clip posed by a clock the caller
 * keeps (the jump sequence, the grab) rather than by the mixer's. A paused
 * action still blends and fades as usual. It just doesn't advance, so it can't
 * run out and lose its weight a frame before the caller moves on. Call it
 * after any crossfade into the action, because `reset()` unpauses it.
 */
export const pinClipPose = (pose: ClipPose): void => {
  pose.action.time = pose.time;
  pose.action.paused = true;
};

/** Whether `action` is one of the rig's three gaits, which share one stride (ADR 0081). */
export const isGait = (action: THREE.AnimationAction | null, actions: CharacterActions): boolean =>
  action !== null && (action === actions.walk || action === actions.run || action === actions.sprint);

/**
 * Crossfades to `next` if it differs from `current`, otherwise leaves it
 * playing untouched. Returns the action that is now current — the caller
 * holds it in its own per-rig variable (local and remote each track their
 * own).
 *
 * `actions`, when given, lets a change of gait keep its step (ADR 0081): if
 * both `current` and `next` are gaits, `next` starts at the same point of the
 * stride `current` has reached, instead of from its own first frame. A Dash
 * starts mid-run all the time, and restarting the Sprint on its left foot
 * while the Run is on its right blends two opposite legs for the length of
 * the fade.
 */
export const crossfadeLocomotion = (
  next: THREE.AnimationAction | null,
  current: THREE.AnimationAction | null,
  crossfadeSeconds: number,
  actions?: CharacterActions,
): THREE.AnimationAction | null => {
  if (!next || next === current) return current;
  next.reset();
  if (actions && current && isGait(current, actions) && isGait(next, actions)) {
    const stride = (current.time / current.getClip().duration) % 1;
    next.time = stride * next.getClip().duration;
  }
  next.fadeIn(crossfadeSeconds).play();
  current?.fadeOut(crossfadeSeconds);
  return next;
};
