import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { type BoneSpec, CAPSULE_BOTTOM_OFFSET, GRAVITY_Y } from "@dont-fall/shared";
import {
  bindClipAction,
  CHARACTER_VISUAL_HEIGHT,
  KNOCKDOWN_DIRECTIONS,
  type KnockdownDirection,
  loadCharacterModel,
  MODEL_YAW_OFFSET,
} from "../render/characterModel.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { publicUrl } from "../lib/publicUrl.js";
import { RubberBody } from "../render/rubberBody.js";
import { authoredDrawBones, AUTHORED_SPECS, BLIP_BONE_ORDER, hasAuthoredSpec, registerAuthoredSpec } from "./blipRagdoll.js";
import { BLENDER_COLLIDER_MODEL, specFromColliderScene } from "./blenderHulls.js";
import { clearRig, loadRig, saveRig } from "./rigStore.js";
import { BLIP_RAGDOLL_BONES, SKELETONS, type SkeletonName } from "./blipSkeleton.js";
import { asSource, BONE_ROWS, FIELD_LABEL, readField, writeField } from "./skeletonEditor.js";
import { skeletonFromRig } from "./skeletonFromRig.js";
import {
  addJoint,
  boneEnd,
  draftFromBones,
  draftFromRig,
  draftToSource,
  fitLength,
  removeJoint,
  type RigDraft,
  rotateSubtree,
  shapeCentre,
  shapeOffsetFor,
  toBoneSpecs,
} from "./rigTool.js";
import { createPhysicsKnockout, type GetUpPose, HOLD_RADIUS, type Landing, type PhysicsKnockout } from "./physicsKo.js";
import { SkeletonView } from "./skeletonView.js";
import {
  RUBBER_BONES,
  RUBBER_IMPACT_MAGNITUDE,
  RubberBones,
  type RubberBoneSpec,
  type RubberImpactKind,
} from "../render/rubberBones.js";

/**
 * The rubber skeleton on a stand, so its numbers can be found by looking at
 * it (the user's ask, 2026-09-20). Dev-only: no test in this repo can
 * rasterise a rig, so every constant in `rubberBones.ts` is a first guess
 * until someone drives this page.
 *
 * It plays whole performances, not the pieces the game happens to address
 * them by (the user's correction: "několik animací = jeden klip, já chci
 * vidět celý klip"). A knockdown is going down *and* getting up; an emote is
 * its in, its hold and its out; a jump is `Jump_Full`, which the game itself
 * never plays because it lifts its own root. Each runs end to end and then
 * again, so an Impact can be thrown into any moment of it and watched all the
 * way out.
 */

const IMPACTS: readonly { kind: RubberImpactKind; label: string; key: string }[] = [
  { kind: "knockdownHeavy", label: "KNOCKDOWN ×heavy", key: "1" },
  { kind: "knockdown", label: "KNOCKDOWN", key: "2" },
  { kind: "hitTaken", label: "HIT TAKEN", key: "3" },
  { kind: "bump", label: "BUMP", key: "4" },
  { kind: "hardLanding", label: "HARD LANDING", key: "5" },
];

/**
 * One performance. `clips` are played in order and the whole thing then runs
 * again; `<d>` is filled in with the knockdown direction. `loop` marks the
 * single clips that simply repeat — a gait, a struggle — which the mixer
 * loops on its own.
 */
interface Sequence {
  group: string;
  label: string;
  clips: readonly string[];
  loop?: boolean;
  /**
   * Nothing plays and nothing is written over the pose: the rig sits in the
   * bind pose the artist built it in. The only state in which the skeleton's
   * own numbers can be lined up against the body honestly, because everything
   * else — a clip, the springs, the squash — is moving the thing being
   * measured (the user, 2026-09-20: "přestaň ho animovat, ať to můžu udělat
   * správně").
   */
  rest?: boolean;
}

const SEQUENCES: readonly Sequence[] = [
  { group: "Gait", label: "rest pose — no animation", clips: [], rest: true },
  { group: "Gait", label: "idle", clips: ["Idle"], loop: true },
  { group: "Gait", label: "walk", clips: ["Walk"], loop: true },
  { group: "Gait", label: "run", clips: ["Run"], loop: true },
  { group: "Gait", label: "sprint", clips: ["Sprint"], loop: true },
  { group: "Gait", label: "wobble", clips: ["Wobble"], loop: true },
  { group: "Gait", label: "wobble walk", clips: ["Wobble_Walk"], loop: true },

  // Down and up as one performance — the way it actually happens to a Player.
  { group: "Down", label: "knockdown → get up", clips: ["KO_<d>", "GetUp_<d>"] },
  { group: "Down", label: "death", clips: ["Death_<d>"] },
  { group: "Down", label: "fall back", clips: ["Fall_Back"] },
  { group: "Down", label: "hit react", clips: ["Hit_React"] },
  { group: "Down", label: "punch", clips: ["Punch"] },

  // `Jump_Full` is the whole arc in one clip. The game never plays it — it
  // lifts its own root 1.2 units and the simulation owns the height — so this
  // page is the only place it is ever seen.
  { group: "Jump", label: "jump (whole)", clips: ["Jump_Full"] },
  {
    group: "Jump",
    label: "jump (as the game poses it)",
    clips: ["Jump_Start", "Jump_Rise", "Jump_Apex", "Jump_Fall", "Jump_Land"],
  },

  { group: "Grab", label: "grab", clips: ["Grab"] },
  { group: "Grab", label: "at arm's length", clips: ["Grab_Reach", "Grab_HoldOut", "Grab_DropOut"] },
  { group: "Grab", label: "hugged in", clips: ["Grab_Pull", "Grab_HoldIn", "Grab_DropIn"] },
  { group: "Grab", label: "struggle", clips: ["Struggle_Held"], loop: true },
  { group: "Grab", label: "struggle (air)", clips: ["Struggle_Air"], loop: true },

  { group: "Emote", label: "win", clips: ["Win_Start", "Win_Loop", "Win_End"] },
  { group: "Emote", label: "shrug", clips: ["Shrug_In", "Shrug_Hold", "Shrug_Out"] },
  { group: "Emote", label: "sulk", clips: ["Sulk_In", "Sulk_Hold", "Sulk_Out"] },
];

const GROUPS = [...new Set(SEQUENCES.map((s) => s.group))];

/** The longest frame the demo advances by — a guard against a backgrounded tab, not a frame-rate cap. */
const MAX_FRAME_SECONDS = 0.25;

/** Blend between one piece of a performance and the next (s). */
const PIECE_CROSSFADE = 0.12;
/** How long a performance rests on its last frame before it runs again (ms). */
const SEQUENCE_HOLD_MS = 700;

/** Where the shove comes from, as the compass reads it — the direction the body is pushed. */
const DIRECTIONS: readonly { label: string; x: number; z: number }[] = [
  { label: "↖", x: -0.7, z: -0.7 },
  { label: "↑ back", x: 0, z: -1 },
  { label: "↗", x: 0.7, z: -0.7 },
  { label: "← left", x: -1, z: 0 },
  { label: "⟳ rnd", x: 0, z: 0 },
  { label: "right →", x: 1, z: 0 },
  { label: "↙", x: -0.7, z: 0.7 },
  { label: "front ↓", x: 0, z: 1 },
  { label: "↘", x: 0.7, z: 0.7 },
];

const knobs = { gain: 1, hz: 1, zeta: 1, delay: 1, scale: 1, body: 1 };
let layerOn = true;
let bodyOn = true;
let showSkeleton = false;
let timeScale = 1;
let auto = false;
let direction = { x: 0, z: 1 };
let koDirection: KnockdownDirection = "F";

const scaledSpecs = (): RubberBoneSpec[] =>
  RUBBER_BONES.map((b) => ({
    ...b,
    gain: b.gain * knobs.gain,
    hz: b.hz * knobs.hz,
    zeta: Math.min(0.99, b.zeta * knobs.zeta),
    delayMs: b.delayMs * knobs.delay,
  }));

const view = document.getElementById("view")!;
const panel = document.getElementById("panel")!;
const status = document.getElementById("status")!;
const hint = document.getElementById("hint")!;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping;
view.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14130f);
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50);
/** Where the camera sits relative to whatever it is watching. */
const CAMERA_START = new THREE.Vector3(1.7, 0.6, 3.1);
/** How fast it closes on its target (1/s), so a clip that travels does not whip the view. */
const CAMERA_FOLLOW_RATE = 4;
const cameraTarget = new THREE.Vector3(0, 0.95, 0);
camera.position.copy(cameraTarget).add(CAMERA_START);
camera.lookAt(cameraTarget);

scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x4a4438, 1.5));
const sun = new THREE.DirectionalLight(0xfff0d0, 2.2);
sun.position.set(3, 6, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.top = sun.shadow.camera.right = 3;
sun.shadow.camera.bottom = sun.shadow.camera.left = -3;
scene.add(sun);

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(4, 48).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0x2b2820, roughness: 1 }),
);
floor.receiveShadow = true;
scene.add(floor);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(cameraTarget);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 1;
controls.maxDistance = 12;

const resize = (): void => {
  const { clientWidth: w, clientHeight: h } = view;
  if (w === 0 || h === 0) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
};
new ResizeObserver(resize).observe(view);

const main = async (): Promise<void> => {
  const model = await loadCharacterModel();

  // The Blender-authored colliders, if the export is there: registered as the
  // authored rig "v4" so it can be knocked down beside the JSON ones. The
  // page carries on without it — the button below just stays disabled.
  try {
    const colliders = await new GLTFLoader().loadAsync(publicUrl(BLENDER_COLLIDER_MODEL));
    registerAuthoredSpec("v4", specFromColliderScene(colliders.scene, AUTHORED_SPECS.v3));
  } catch (error) {
    console.warn("rubber: no Blender collider export, the v4 skeleton is off", error);
  }
  status.remove();

  const root = new THREE.Group();
  const bounds = new THREE.Box3().setFromObject(model.scene);
  const size = bounds.getSize(new THREE.Vector3()).y;
  const scale = size > 0 ? CHARACTER_VISUAL_HEIGHT / size : 1;
  model.scene.scale.setScalar(scale);
  model.scene.position.y = -bounds.min.y * scale;
  model.scene.rotation.y = MODEL_YAW_OFFSET;
  model.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  root.add(model.scene);
  scene.add(root);

  // A performance that travels (a knockdown, the whole jump) walks the body
  // off a fixed camera — exactly the clips this page exists to watch.
  const watched = new THREE.Vector3();
  const pelvis = model.scene.getObjectByName("pelvis");

  const mixer = new THREE.AnimationMixer(model.scene);
  const has = (name: string): boolean =>
    THREE.AnimationClip.findByName(model.animations, name.replace("<d>", "F")) != null;

  /** The demo's own clock — what slow-motion slows, what an Impact is stamped with, and what paces a performance. */
  let showMs = 0;
  let lastAutoMs = 0;

  let sequence: Sequence = SEQUENCES[0]!;
  let pieceIndex = 0;
  let pieceEndsAt = 0;
  let current: THREE.AnimationAction | null = null;

  /** What is on screen right now, named — a stalled sequence is otherwise invisible. */
  let nowPlaying = "";

  /** Every skinned mesh on the rig, for putting it back in its bind pose. */
  const skinnedMeshes: THREE.SkinnedMesh[] = [];
  model.scene.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinnedMeshes.push(o as THREE.SkinnedMesh);
  });
  /** The bind pose, as the rig was built — `Skeleton.pose` writes it back over whatever is there. */
  const restPose = (): void => {
    for (const mesh of skinnedMeshes) mesh.skeleton.pose();
  };

  /**
   * The first frame of a get-up, read off the rig once at load: the
   * knockout's final stretch drives the doll INTO this pose (the user's ask,
   * 2026-09-20 — "predat rapieru startovni pozice do ceho ma dosahnout"), so
   * physics ends exactly where the clip begins. Captured in the character's
   * own frame: root at the origin, facing +Z, floor at y 0 — which is how
   * the scene stands right now, before anything has played.
   */
  const getUpFirstFrame = (name: string): GetUpPose | null => {
    const action = bindClipAction(mixer, model.animations, name, false);
    if (!action) return null;
    action.reset().play();
    mixer.update(0);
    model.scene.updateMatrixWorld(true);
    const pose = new Map<string, { position: THREE.Vector3; quaternion: THREE.Quaternion }>();
    const bones = new Map<string, THREE.Object3D>();
    model.scene.traverse((o) => {
      if ((o as THREE.Bone).isBone) bones.set(o.name, o);
    });
    for (const specName of BLIP_BONE_ORDER) {
      const bone = bones.get(specName.replace(/\./g, "")) ?? bones.get(specName);
      if (!bone) continue;
      pose.set(specName, {
        position: bone.getWorldPosition(new THREE.Vector3()),
        quaternion: bone.getWorldQuaternion(new THREE.Quaternion()),
      });
    }
    action.stop();
    return pose;
  };
  const getUpStart = { F: getUpFirstFrame("GetUp_F"), B: getUpFirstFrame("GetUp_B") };
  mixer.stopAllAction();
  restPose();
  model.scene.updateMatrixWorld(true);

  const playPiece = (index: number): void => {
    const name = sequence.clips[index]!.replace("<d>", koDirection);
    const next = bindClipAction(mixer, model.animations, name, sequence.loop === true);
    if (!next) {
      // Never silently: a missing clip would otherwise freeze the sequence on
      // whatever piece came before it.
      nowPlaying = `${name} — MISSING`;
      return;
    }
    if (current && current !== next) current.fadeOut(PIECE_CROSSFADE);
    next.reset().fadeIn(PIECE_CROSSFADE).play();
    current = next;
    pieceIndex = index;
    pieceEndsAt = showMs + next.getClip().duration * 1000;
    nowPlaying = `${name}  ${index + 1}/${sequence.clips.length}  ${next.getClip().duration.toFixed(2)}s`;
  };

  const start = (next: Sequence): void => {
    sequence = next;
    if (next.rest) {
      // Stop everything, then write the bind pose back: a stopped mixer leaves
      // the bones wherever its last frame put them.
      mixer.stopAllAction();
      current = null;
      nowPlaying = "rest pose — nothing is playing";
      restPose();
      return;
    }
    playPiece(0);
  };
  start(SEQUENCES[0]!);

  // A knockout with no animation in it, to hold against the authored ones.
  const carrierRest = root.position.clone();
  let physics: PhysicsKnockout | null = null;
  /** Where the last knockout put the body, waiting for the get-up to pick it up. */
  let landed: Landing | null = null;
  void createPhysicsKnockout(
    model.scene,
    root,
    carrierRest,
    {
      // The authored rig is written in the GLB's own units, from the GLB's own
      // origin — and the mesh is lowered so its lowest vertex sits on the floor
      // (`model.scene.position.y` above), so the physics goes down with it or
      // the two disagree by 26 mm and the first sync frame pops the body up.
      // Read fresh per knockout: a get-up moves the character, and the next
      // doll spawns where it now stands, facing the way it now faces.
      scale,
      origin: () => new THREE.Vector3(root.position.x, root.position.y + model.scene.position.y, root.position.z),
      yaw: () => model.scene.rotation.y,
    },
    (landing) => {
      // The character gets up where it fell, not where it was standing before.
      root.position.x = landing.position.x;
      root.position.z = landing.position.z;
      model.scene.rotation.y = landing.yaw;
      // Recomputed NOW, not at the next render: the re-sync that follows
      // solves bone locals against this matrix, and against the stale one
      // the whole heap jumped by the carrier's move on the next frame —
      // the body (and the camera chasing its pelvis) leapt across the floor.
      root.updateMatrixWorld(true);
      landed = landing;
    },
    getUpStart,
  ).then((ko) => (physics = ko));

  // A second BLIP to do the grabbing (the user's ask, 2026-09-20): the
  // physics stays the invisible anchor's, proven as it is — this one is
  // presentation over it. It stands at the pivot, reaches, holds at arm's
  // length, turns with the spin, lets go, and is left standing there.
  const grabberGltf = await loadCharacterModel();
  grabberGltf.scene.scale.setScalar(scale);
  grabberGltf.scene.position.y = model.scene.position.y;
  grabberGltf.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  const grabber = new THREE.Group();
  grabber.add(grabberGltf.scene);
  grabber.visible = false;
  // Yaw first, then the lean about his own sideways axis.
  grabber.rotation.order = "YXZ";
  scene.add(grabber);
  /**
   * How far he leans back against the spin — a damped spring, not an ease,
   * because the throw is where it earns its keep: the pull he was braced
   * against vanishes at release, so the spring gets a backward kick sized by
   * the load that just disappeared, he staggers past his lean, catches
   * himself and settles with a wobble. Underdamped on purpose.
   */
  let grabberLean = 0;
  let grabberLeanVel = 0;
  /** rad/s of natural frequency and the damping ratio of his balance. */
  const GRABBER_LEAN_HZ = 9;
  const GRABBER_LEAN_ZETA = 0.45;
  /** After letting go he keeps turning with the spin's own momentum, bleeding off. */
  let grabberYawVel = 0;
  /** The spin as it stood last frame, for sizing the release reaction. */
  let grabberLastOmega = 0;
  const grabberMixer = new THREE.AnimationMixer(grabberGltf.scene);
  let grabberAction: THREE.AnimationAction | null = null;
  /** One queued clip, so the reach can flow into the hold and the drop into idling. */
  let grabberNext: { at: number; name: string; loop: boolean } | null = null;
  let grabberWasHolding = false;
  const grabberPlay = (name: string, loop: boolean): number => {
    const action = bindClipAction(grabberMixer, grabberGltf.animations, name, loop);
    if (!action) return 0;
    if (grabberAction && grabberAction !== action) grabberAction.fadeOut(PIECE_CROSSFADE);
    action.reset().fadeIn(PIECE_CROSSFADE).play();
    grabberAction = action;
    return action.getClip().duration * 1000;
  };

  // --- the get-up: out of the heap, back into animation ---------------------
  /** Every bone's local pose the moment physics let go, blended away over the get-up's first moments. */
  let heapPose: Map<THREE.Bone, { position: THREE.Vector3; quaternion: THREE.Quaternion }> | null = null;
  let getUpFrom = 0;
  /** What was playing when the knockout hit, to come back to once the body is up. */
  let resumeAfterKo: Sequence | null = null;
  let getUpSequence: Sequence | null = null;
  const GETUP_BLEND_MS = 400;
  const blendQ = new THREE.Quaternion();
  const blendP = new THREE.Vector3();
  let koForce = 1;
  /** Which skeleton the knockout uses — the game's, or one shaped like BLIP. */
  let skeleton: SkeletonName = "game";
  /**
   * The BLIP skeleton as it stands right now. Replaced whole on every edit,
   * never mutated: `physicsKo` reuses its ragdoll while the array is the same
   * one, so a new array is how it is told the numbers moved.
   */
  // Measured off the rig that is already in the GLB, every load — not the
  // hand-written table, which is kept only as the fallback and as a record of
  // what the measurement produced.
  let measured: readonly BoneSpec[] = BLIP_RAGDOLL_BONES;
  try {
    measured = skeletonFromRig(model.scene);
  } catch (error) {
    console.warn("rubber: could not read a skeleton off the rig, using the written one", error);
  }
  // The rig-derived one, because it is the structurally right one: limbs as
  // segments between joints, turned the way the rig turns them. The written
  // table was tuned against blobs centred on the joints and is kept only as
  // what that produced.
  // Drawn from the authored spec's own shapes. It was falling back to the
  // game's skeleton here, so picking "authored" looked like picking nothing.
  const authoredDrawn = authoredDrawBones(scale, "v1", model.scene.position.y);
  const authoredV2Drawn = authoredDrawBones(scale, "v2", model.scene.position.y);
  const authoredV3Drawn = authoredDrawBones(scale, "v3", model.scene.position.y);
  // Empty when the Blender export is missing — its button stays disabled.
  const authoredV4Drawn = hasAuthoredSpec("v4") ? authoredDrawBones(scale, "v4", model.scene.position.y) : [];

  // --- three skeletons, each with its own work ------------------------------
  //
  // Every skeleton keeps its own bones and its own draft, and the one last
  // open is remembered. Switching used to reach for one shared table and the
  // rig tool used to override what was shown, so picking another skeleton
  // either did nothing or threw the work away.
  const kept = loadRig();

  /** What each skeleton looks like untouched. */
  const defaults: Record<SkeletonName, readonly BoneSpec[]> = {
    game: SKELETONS.game.bones,
    blip: measured,
    authored: authoredDrawn,
    authoredV2: authoredV2Drawn,
    authoredV3: authoredV3Drawn,
    authoredV4: authoredV4Drawn,
  };
  /** The draft for a skeleton nobody has edited yet. `blip` is read off the rig; the others from their own bones. */
  const freshDraft = (name: SkeletonName): RigDraft =>
    name === "blip" ? draftFromRig(model.scene, CAPSULE_BOTTOM_OFFSET) : draftFromBones(defaults[name]);

  const work: Record<SkeletonName, { draft: RigDraft; bones: readonly BoneSpec[] }> = {
    game: { draft: freshDraft("game"), bones: defaults.game },
    blip: { draft: freshDraft("blip"), bones: defaults.blip },
    authored: { draft: freshDraft("authored"), bones: defaults.authored },
    authoredV2: { draft: freshDraft("authoredV2"), bones: defaults.authoredV2 },
    authoredV3: { draft: freshDraft("authoredV3"), bones: defaults.authoredV3 },
    authoredV4: { draft: freshDraft("authoredV4"), bones: defaults.authoredV4 },
  };
  for (const name of ["game", "blip", "authored", "authoredV2", "authoredV3", "authoredV4"] as const) {
    const saved = kept?.work[name];
    if (!saved) continue;
    const reference = work[name].draft;
    work[name] = {
      bones: saved.bones,
      draft: saved.draft.map((joint) => {
        const fresh = reference.find((f) => f.name === joint.name);
        // A session saved before hulls were carried through has joints with
        // no points and no size, which draw as nothing at all. Rather than
        // making anyone throw their work away, the shape is taken from the
        // skeleton as it stands and only the placing is kept.
        const lostItsHull = fresh?.hullPoints !== undefined && joint.hullPoints === undefined;
        const base = lostItsHull ? { ...fresh } : joint;
        return {
          ...base,
          at: joint.at,
          shapeOffset: joint.shapeOffset,
          // Hinges are never carried across a reload — nothing here can change
          // one, so they come fresh rather than from a stale copy.
          hinge: fresh?.hinge,
        };
      }),
    };
  }
  skeleton = (kept?.selected as SkeletonName | undefined) ?? skeleton;
  // A session can remember v4 from a day the Blender export was there.
  if (skeleton === "authoredV4" && !hasAuthoredSpec("v4")) skeleton = "game";

  /** Written on every change, so a reload or a mistyped number costs nothing. */
  const remember = (): void => {
    work[skeleton] = { draft, bones: editable };
    saveRig({ selected: skeleton, work });
  };

  let selected = 0;
  let rigMode = false;
  let bodyVisible = true;
  /** The skeleton being worked on right now — swapped whole when another is picked. */
  let draft: RigDraft = work[skeleton].draft;
  let editable: readonly BoneSpec[] = work[skeleton].bones;
  /** What the view looked like before the tool took it over, to hand back on the way out. */
  let beforeRig: { showSkeleton: boolean; bodyVisible: boolean } | null = null;

  /** A small ball at each joint — what you click and drag. */
  const handles = new THREE.Group();
  scene.add(handles);

  /**
   * The armature: a line from every joint to its parent. This is what the rig
   * *is* — joints connected by bones — and the shape it makes is the thing
   * being judged (the user, 2026-09-20: "kosti mají být prostě čáry spojené,
   * je to takový polohumanoidní tvar"). The colliders are drawn separately
   * and can be switched off, because solid shapes bury the very structure
   * they hang on.
   */
  const boneLines = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.9 }),
  );
  boneLines.renderOrder = 1001;
  boneLines.frustumCulled = false;
  scene.add(boneLines);

  /** Redraws the armature from wherever the joints are now. */
  const drawBones = (): void => {
    const points: number[] = [];
    const line = (a: THREE.Vector3, b: THREE.Vector3): void => {
      points.push(a.x, a.y + CAPSULE_BOTTOM_OFFSET, a.z, b.x, b.y + CAPSULE_BOTTOM_OFFSET, b.z);
    };
    for (const joint of draft) {
      // The chain: which joint hangs off which.
      const parent = joint.parent ? draft.find((other) => other.name === joint.parent) : undefined;
      if (parent) line(parent.at, joint.at);
      // And how far this bone actually reaches, which is its own number now
      // and need not match the gap to the next joint.
      const end = boneEnd(draft, joint.name);
      if (end) line(joint.at, end);
    }
    boneLines.geometry.dispose();
    boneLines.geometry = new THREE.BufferGeometry().setAttribute(
      "position",
      new THREE.Float32BufferAttribute(points, 3),
    );
  };
  const handleGeometry = new THREE.SphereGeometry(0.055, 12, 8);
  let handleMeshes: THREE.Mesh[] = [];
  const rebuildHandles = (): void => {
    for (const mesh of handleMeshes) {
      (mesh.material as THREE.Material).dispose();
      handles.remove(mesh);
    }
    handleMeshes = draft.map((joint) => {
      const mesh = new THREE.Mesh(
        handleGeometry,
        new THREE.MeshBasicMaterial({ color: 0xff7a5c, depthTest: false, transparent: true, opacity: 0.95 }),
      );
      mesh.renderOrder = 1000;
      mesh.userData.joint = joint.name;
      handles.add(mesh);
      return mesh;
    });
  };
  rebuildHandles();

  /** A second handle, on the shape rather than on the joint. */
  const shapeHandle = new THREE.Mesh(
    new THREE.BoxGeometry(0.07, 0.07, 0.07),
    new THREE.MeshBasicMaterial({ color: 0x6fd3ff, depthTest: false, transparent: true, opacity: 0.95 }),
  );
  shapeHandle.renderOrder = 1000;
  shapeHandle.visible = false;
  scene.add(shapeHandle);

  const gizmo = new TransformControls(camera, renderer.domElement);
  gizmo.setSize(0.6);
  /**
   * What the gizmo has hold of: the joint (and so the skeleton), the shape
   * alone, or a turn of everything below the joint. A joint and its collider
   * are two different things and each needs its own handle.
   */
  let gizmoMode: "translate" | "shape" | "rotate" = "translate";
  /** The handle's turn when the current drag started, so each frame applies only what is new. */
  const turnAtDragStart = new THREE.Quaternion();
  const turnDelta = new THREE.Quaternion();
  gizmo.addEventListener("dragging-changed", (event) => {
    const dragging = (event as unknown as { value: boolean }).value;
    // The orbit must let go while a joint is being dragged, or both move.
    controls.enabled = !dragging;
    if (dragging) turnAtDragStart.copy(handleMeshes[selected]!.quaternion);
  });
  const gizmoHelper = gizmo.getHelper();
  scene.add(gizmoHelper);
  gizmoHelper.visible = false;
  gizmo.enabled = false;

  /** Writes the dragged handle back into the draft, and the draft into the skeleton. */
  const applyDraft = (): void => {
    const handle = handleMeshes[selected];
    if (gizmoMode === "shape") {
      // Only the shape moves; the joint, and so the skeleton, stays put.
      const joint = draft[selected]!;
      const world = new THREE.Vector3(
        shapeHandle.position.x,
        shapeHandle.position.y - CAPSULE_BOTTOM_OFFSET,
        shapeHandle.position.z,
      );
      joint.shapeOffset = shapeOffsetFor(draft, joint.name, world);
    } else if (gizmoMode === "rotate" && handle) {
      // Only what has been turned since the last frame, so the swing does not
      // compound on itself while the mouse is held.
      turnDelta.copy(handle.quaternion).multiply(turnAtDragStart.clone().invert());
      turnAtDragStart.copy(handle.quaternion);
      draft = rotateSubtree(draft, draft[selected]!.name, turnDelta);
    } else {
      for (const [i, mesh] of handleMeshes.entries()) {
        const joint = draft[i]!;
        joint.at.set(mesh.position.x, mesh.position.y - CAPSULE_BOTTOM_OFFSET, mesh.position.z);
      }
    }
    remember();
    refreshRig.forEach((sync) => sync());
  };
  gizmo.addEventListener("objectChange", applyDraft);

  const placeHandles = (): void => {
    const centre = draft[selected] ? shapeCentre(draft, draft[selected]!.name) : null;
    shapeHandle.visible = rigMode && gizmoMode === "shape" && centre !== null;
    // Left where the gizmo put it while it is being dragged.
    if (centre && !(gizmoMode === "shape" && gizmo.dragging)) {
      shapeHandle.position.set(centre.x, centre.y + CAPSULE_BOTTOM_OFFSET, centre.z);
    }
    for (const [i, mesh] of handleMeshes.entries()) {
      const joint = draft[i]!;
      mesh.position.set(joint.at.x, joint.at.y + CAPSULE_BOTTOM_OFFSET, joint.at.z);
      // The one being turned keeps whatever the gizmo has put on it; the rest
      // sit upright, since a handle's own turn means nothing once it is read.
      if (!(gizmoMode === "rotate" && i === selected)) mesh.quaternion.identity();
      (mesh.material as THREE.MeshBasicMaterial).color.set(i === selected ? 0xffd24a : 0xff7a5c);
    }
  };

  const select = (index: number): void => {
    selected = Math.max(0, Math.min(index, draft.length - 1));
    // A fresh handle starts upright, so a turn is measured from here.
    handleMeshes[selected]!.quaternion.identity();
    turnAtDragStart.identity();
    gizmo.attach(gizmoMode === "shape" ? shapeHandle : handleMeshes[selected]!);
    placeHandles();
    refreshRig.forEach((sync) => sync());
  };

  const refreshRig: (() => void)[] = [];
  const skeletonLabel = (): string => {
    if (skeleton === "game" || skeleton === "blip") return SKELETONS[skeleton].label;
    return `authored ${skeleton.replace("authored", "").toLowerCase() || "v1"}`;
  };
  const liveBones = (): readonly BoneSpec[] => {
    // `editable` is always the *current* skeleton's bones, so this needs no
    // idea of which one that is. It used to name them one by one and so only
    // ever showed edits made to `blip`.
    if (rigMode) return toBoneSpecs(draft);
    return editable;
  };
  /**
   * Switch to another skeleton. Each one keeps its own bones and its own
   * draft, so what was done to this one is put away untouched and what was
   * done to that one comes back exactly as it was left. The button used to
   * set the name and nothing else, which is why picking one did nothing.
   */
  const pickSkeleton = (next: SkeletonName): void => {
    work[skeleton] = { draft, bones: editable };
    skeleton = next;
    draft = work[next].draft;
    editable = work[next].bones;
    rebuildHandles();
    select(Math.min(selected, draft.length - 1));
    remember();
    refreshEditor.forEach((sync) => sync());
    toggles.forEach((t) => t());
  };

  const skeletonView = new SkeletonView(scene);

  // Drawn bones are only useful *inside* the body, so the body stops hiding
  // them (the user's ask). Every material's own settings are kept, because a
  // skin's material is not this file's to redefine.
  const skinned: { material: THREE.Material; opacity: number; transparent: boolean; depthWrite: boolean }[] = [];
  model.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      skinned.push({
        material,
        opacity: material.opacity,
        transparent: material.transparent,
        depthWrite: material.depthWrite,
      });
    }
  });
  const setSeeThrough = (on: boolean): void => {
    for (const kept of skinned) {
      kept.material.transparent = on || kept.transparent;
      kept.material.opacity = on ? 0.25 : kept.opacity;
      kept.material.depthWrite = on ? false : kept.depthWrite;
      kept.material.needsUpdate = true;
    }
  };

  const rubberFor = (): RubberBones => new RubberBones(root, scaledSpecs());
  let rubber = rubberFor();
  if (!rubber.complete) console.warn("rubber: the rig is missing bones this layer drives");

  // The soft body scales the group the loader's scene hangs in, so the rig's
  // own animated `root.scale` (every `Death_*` clip writes one) is left alone.
  const softBody = new RubberBody(model.scene);
  /** The pelvis in the model's own space — a world height would feed the body's own squash back into itself. */
  const pelvisLocal = new THREE.Vector3();
  const bodyHeight = (): number => model.scene.worldToLocal(pelvis!.getWorldPosition(pelvisLocal)).y;

  const fire = (kind: RubberImpactKind): void => {
    const d =
      direction.x === 0 && direction.z === 0
        ? (() => {
            const a = Math.random() * Math.PI * 2;
            return { x: Math.sin(a), z: Math.cos(a) };
          })()
        : direction;
    rubber.impact({ direction: { x: d.x, y: 0, z: d.z }, magnitude: RUBBER_IMPACT_MAGNITUDE[kind] }, showMs);
    softBody.impact(RUBBER_IMPACT_MAGNITUDE[kind], showMs);
  };

  // --- panel ---------------------------------------------------------------
  const el = (html: string): HTMLElement => {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild as HTMLElement;
  };
  const section = (title: string, node: HTMLElement): void => {
    panel.append(el(`<h2>${title}</h2>`), node);
  };
  const toggles: (() => void)[] = [];
  let koButtonRef: HTMLElement | null = null;

  panel.append(el("<h1>Rubber skeleton</h1>"), el("<p class=sub>impact → springs on the bones. dev-only.</p>"));

  const impactGrid = el("<div class='grid'></div>");
  for (const i of IMPACTS) {
    const b = el(`<button>${i.label}<span style="float:right;color:#8e8a80">${i.key}</span></button>`);
    b.onclick = () => fire(i.kind);
    impactGrid.append(b);
  }
  section("Impact", impactGrid);

  const dirGrid = el("<div class='grid g3'></div>");
  for (const d of DIRECTIONS) {
    const b = el(`<button>${d.label}</button>`);
    b.onclick = () => {
      direction = { x: d.x, z: d.z };
      toggles.forEach((t) => t());
    };
    toggles.push(() => b.classList.toggle("on", direction.x === d.x && direction.z === d.z));
    dirGrid.append(b);
  }
  section("Shoved toward", dirGrid);

  for (const group of GROUPS) {
    const grid = el("<div class='grid g2'></div>");
    for (const entry of SEQUENCES.filter((s) => s.group === group)) {
      const missing = !entry.clips.every(has);
      const b = el(`<button${missing ? " disabled title='not on this rig'" : ""}>${entry.label}</button>`);
      if (missing) b.style.opacity = "0.35";
      else
        b.onclick = () => {
          start(entry);
          toggles.forEach((t) => t());
        };
      toggles.push(() => b.classList.toggle("on", sequence === entry));
      grid.append(b);
    }
    section(`Playing — ${group.toLowerCase()}`, grid);
  }

  /**
   * Where the Character's capsule centre is. Every `restCenter` in a skeleton
   * is measured from there and `root.position` is the **feet**, so reading one
   * for the other builds the whole ragdoll `CAPSULE_BOTTOM_OFFSET` below the
   * bean — which is what it was doing: the bones sat through the floor and the
   * knockout came out wrong.
   */
  const capsuleCentre = (): THREE.Vector3 =>
    new THREE.Vector3(root.position.x, root.position.y + CAPSULE_BOTTOM_OFFSET, root.position.z);

  /** Knock the body down from `d`, out of whatever pose is on screen right now. */
  const knockOut = (d: { x: number; z: number }): void => {
    if (!physics) return;
    const aimed =
      d.x === 0 && d.z === 0
        ? (() => {
            const a = Math.random() * Math.PI * 2;
            return { x: Math.sin(a), z: Math.cos(a) };
          })()
        : d;
    // The get-up comes back to what was playing — unless the knockout landed
    // mid-get-up, which would make the get-up the thing to come back to.
    if (sequence !== getUpSequence) resumeAfterKo = sequence;
    heapPose = null;
    physics.start(capsuleCentre(), aimed, koForce, showMs, { name: skeleton, bones: liveBones() });
    softBody.reset();
    rubber.reset();
  };

  // Its own eight directions rather than the Impact compass above: a
  // knockout from the side is the case the authored clips read worst in (the
  // user, 2026-09-20), so trying every side has to be one click.
  // The slider lives beside the grid, never inside it: a range input's
  // min-content width is far wider than a third of this panel, and a grid
  // item that wide drags every column out with it.
  const physicsPane = el("<div></div>");
  const physicsGrid = el("<div class='grid g3'></div>");
  for (const d of DIRECTIONS) {
    const b = el(`<button>${d.label}</button>`);
    b.onclick = () => knockOut({ x: d.x, z: d.z });
    if (d.x === 0 && d.z === 0) koButtonRef = b;
    physicsGrid.append(b);
  }
  physicsPane.append(physicsGrid);
  const stopKo = el("<button style='width:100%;margin-top:5px'>back to the clip</button>");
  stopKo.onclick = () => physics?.stop();
  physicsPane.append(stopKo);
  const forceRow = el(`<div class=row><label>force ×</label>
    <input type=range min=0.1 max=3 step=0.05 value=1><output>1.00</output></div>`);
  {
    const input = forceRow.querySelector("input")!;
    const out = forceRow.querySelector("output")!;
    input.oninput = () => {
      koForce = Number(input.value);
      out.textContent = koForce.toFixed(2);
    };
  }
  physicsPane.append(forceRow);
  // ADR 0104's Spin and Hurl, physical: an invisible grabber winds the doll
  // up and lets go — press once to be grabbed, again to be hurled sooner.
  const hurlBtn = el("<button style='width:100%;margin-top:5px'>GRAB — spin, then HURL</button>");
  hurlBtn.onclick = () => {
    if (!physics) return;
    if (physics.holding) {
      physics.hurl(showMs);
    } else {
      if (sequence !== getUpSequence) resumeAfterKo = sequence;
      heapPose = null;
      softBody.reset();
      rubber.reset();
      physics.startSpin(showMs, { name: skeleton, bones: liveBones() });
      if (physics.holding && physics.hold) {
        // The grabbing BLIP takes the pivot — an arm's length in front of
        // its catch, where the physics put its own capsule.
        grabber.position.set(physics.hold.pivotX, 0, physics.hold.pivotZ);
        grabber.visible = true;
        const reachMs = grabberPlay("Grab_Reach", false);
        grabberNext = { at: showMs + reachMs, name: "Grab_HoldOut", loop: true };
      }
    }
  };
  physicsPane.append(hurlBtn);
  const skeletonGrid = el("<div class='grid g3' style='margin-top:5px'></div>");
  for (const [name, label] of [
    ["game", SKELETONS.game.label],
    ["blip", SKELETONS.blip.label],
    ["authored", "authored"],
    ["authoredV2", "authored v2"],
    ["authoredV3", "authored v3"],
    ["authoredV4", "v4 · blender"],
  ] as const) {
    const missing = name === "authoredV4" && !hasAuthoredSpec("v4");
    const b = el(`<button${missing ? " disabled title='blip_with_coliders.glb did not load'" : ""}>${label}</button>`);
    if (missing) b.style.opacity = "0.35";
    else b.onclick = () => pickSkeleton(name as SkeletonName);
    toggles.push(() => b.classList.toggle("on", skeleton === name));
    skeletonGrid.append(b);
  }
  physicsPane.append(el("<div style='color:#8e8a80;font-size:10px;margin-top:8px'>SKELETON</div>"), skeletonGrid);
  section("Knockout — physics, not a clip · hit from any side", physicsPane);

  // Live numbers for the BLIP skeleton. Editing any of them replaces the
  // working array whole, which is how `physicsKo` is told to rebuild.
  const editorPane = el("<div></div>");
  const refreshEditor: (() => void)[] = [];
  for (const row of BONE_ROWS) {
    const line = el(`<div style="display:grid;grid-template-columns:62px repeat(${row.fields.length},1fr);gap:3px;align-items:center;margin-bottom:3px"></div>`);
    line.append(el(`<span style="color:#8e8a80;font-size:10px">${row.label}</span>`));
    for (const field of row.fields) {
      const cell = el(`<label style="display:block"><span style="display:block;color:#5f5c54;font-size:9px;line-height:1">${FIELD_LABEL[field]}</span>
        <input type=number step=0.01 style="width:100%;font:inherit;font-size:11px;color:var(--ink);background:#232118;border:1px solid var(--line);border-radius:4px;padding:2px 3px"></label>`);
      const input = cell.querySelector("input")!;
      const sync = (): void => {
        const spec = editable.find((b) => b.name === row.names[0]);
        if (spec) input.value = String(+readField(spec, field).toFixed(3));
      };
      input.oninput = () => {
        const value = Number(input.value);
        if (!Number.isFinite(value)) return;
        editable = editable.map((b) => (row.names.includes(b.name) ? writeField(b, field, value) : b));
        // Editing the numbers is only useful while you can see them — but the
        // skeleton being edited is left alone, since switching it used to
        // discard the work.
        showSkeleton = true;
        remember();
        toggles.forEach((t) => t());
      };
      refreshEditor.push(sync);
      line.append(cell);
    }
    editorPane.append(line);
  }
  const editorButtons = el("<div class='grid g2' style='margin-top:6px'></div>");
  const copyBones = el("<button>COPY SKELETON</button>");
  copyBones.onclick = () => {
    void navigator.clipboard.writeText(asSource(editable)).then(
      () => (copyBones.textContent = "COPIED"),
      () => console.log(asSource(editable)),
    );
    setTimeout(() => (copyBones.textContent = "COPY SKELETON"), 1200);
  };
  const resetBones = el("<button>from the rig</button>");
  resetBones.onclick = () => {
    editable = measured;
    remember();
    refreshEditor.forEach((sync) => sync());
  };
  const fromRig = el("<button style='grid-column:1/-1'>the written table (tuned on the old shape)</button>");
  fromRig.onclick = () => {
    editable = BLIP_RAGDOLL_BONES;
    remember();
    refreshEditor.forEach((sync) => sync());
  };
  const forget = el("<button style='grid-column:1/-1'>forget the saved session</button>");
  forget.onclick = () => {
    clearRig();
    // Everything back to how each skeleton starts.
    for (const name of ["game", "blip", "authored", "authoredV2", "authoredV3", "authoredV4"] as const) {
      work[name] = { draft: freshDraft(name), bones: defaults[name] };
    }
    draft = work[skeleton].draft;
    editable = work[skeleton].bones;
    rebuildHandles();
    select(0);
    refreshEditor.forEach((sync) => sync());
  };
  editorButtons.append(forget);
  editorButtons.append(copyBones, resetBones, fromRig);
  editorPane.append(editorButtons);
  section("BLIP skeleton — live numbers", editorPane);
  refreshEditor.forEach((sync) => sync());

  // The rig tool's own panel.
  const rigPane = el("<div></div>");
  const rigToggle = el("<button style='width:100%'>RIG TOOL — drag the joints</button>");
  rigToggle.onclick = () => {
    rigMode = !rigMode;
    handles.visible = rigMode;
    boneLines.visible = rigMode;
    gizmoHelper.visible = rigMode;
    gizmo.enabled = rigMode;
    if (rigMode) {
      beforeRig = { showSkeleton, bodyVisible };
      showSkeleton = true;
      select(selected);
    } else {
      // Hand the view back exactly as it was found: the shapes and the
      // see-through body belong to the tool, not to the page.
      showSkeleton = beforeRig?.showSkeleton ?? false;
      bodyVisible = beforeRig?.bodyVisible ?? true;
      model.scene.visible = bodyVisible;
      beforeRig = null;
      gizmo.detach();
      shapeHandle.visible = false;
    }
    rigToggle.classList.toggle("on", rigMode);
    toggles.forEach((t) => t());
    refreshRig.forEach((sync) => sync());
  };
  rigPane.append(rigToggle);

  const jointGrid = el("<div class='grid g3' style='margin-top:5px'></div>");
  const rebuildJointList = (): void => {
    jointGrid.replaceChildren();
    for (const [i, joint] of draft.entries()) {
      const b = el(`<button style="font-size:10px;padding:4px 2px">${joint.name}</button>`);
      b.onclick = () => select(i);
      b.classList.toggle("on", selected === i && rigMode);
      jointGrid.append(b);
    }
  };
  refreshRig.push(rebuildJointList);
  rigPane.append(jointGrid);

  /** Anything that changes which joints exist has to redo the handles, the list and the skeleton. */
  const draftChanged = (next: RigDraft, pick: number): void => {
    draft = next;
    rebuildHandles();
    remember();
    select(pick);
  };

  const viewGrid = el("<div class='grid g2' style='margin-top:5px'></div>");
  const bonesOnly = el("<button>BONES ONLY</button>");
  bonesOnly.onclick = () => {
    showSkeleton = !showSkeleton;
    bonesOnly.classList.toggle("on", !showSkeleton);
    toggles.forEach((t) => t());
  };
  const seeThrough = el("<button>SEE-THROUGH</button>");
  seeThrough.onclick = () => {
    bodyVisible = !bodyVisible;
    model.scene.visible = bodyVisible;
    seeThrough.classList.toggle("on", !bodyVisible);
  };
  viewGrid.append(bonesOnly, seeThrough);
  rigPane.append(viewGrid);

  const modeGrid2 = el("<div class='grid g3' style='margin-top:5px'></div>");
  const setMode = (mode: "translate" | "shape" | "rotate"): void => {
    gizmoMode = mode;
    gizmo.setMode(mode === "rotate" ? "rotate" : "translate");
    handleMeshes[selected]?.quaternion.identity();
    turnAtDragStart.identity();
    placeHandles();
    gizmo.attach(mode === "shape" ? shapeHandle : handleMeshes[selected]!);
    refreshRig.forEach((sync) => sync());
  };
  for (const [mode, label, key] of [
    ["translate", "MOVE JOINT", "g"],
    ["shape", "MOVE SHAPE", "h"],
    ["rotate", "ROTATE", "r"],
  ] as const) {
    const b = el(`<button>${label}<span style="float:right;color:#8e8a80">${key.toUpperCase()}</span></button>`);
    b.onclick = () => setMode(mode);
    refreshRig.push(() => b.classList.toggle("on", gizmoMode === mode && rigMode));
    modeGrid2.append(b);
  }
  rigPane.append(modeGrid2);

  const jointButtons = el("<div class='grid g2' style='margin-top:5px'></div>");
  const addChild = el("<button>+ joint here</button>");
  addChild.onclick = () => {
    const parent = draft[selected]!;
    // Named off its parent, and made unique, so a chain can be grown freely.
    let name = `${parent.name}_x`;
    for (let n = 2; draft.some((j) => j.name === name); n += 1) name = `${parent.name}_x${n}`;
    draftChanged(addJoint(draft, parent.name, name), draft.length);
  };
  const dropJoint = el("<button>− drop joint</button>");
  dropJoint.onclick = () => {
    const going = draft[selected]!;
    if (going.parent === null) return;
    draftChanged(removeJoint(draft, going.name), Math.max(0, selected - 1));
  };
  jointButtons.append(addChild, dropJoint);
  rigPane.append(jointButtons);

  const shapeRows = el("<div style='margin-top:6px'></div>");
  const shapeKnob = (label: string, key: "width" | "depth" | "length" | "roundness" | "mass", min: number, max: number): void => {
    const row = el(`<div class=row><label>${label}</label>
      <input type=range min=${min} max=${max} step=0.005><output>0.00</output></div>`);
    const input = row.querySelector("input")!;
    const out = row.querySelector("output")!;
    input.oninput = () => {
      draft[selected]![key] = Number(input.value);
      out.textContent = Number(input.value).toFixed(3);
      remember();
    };
    refreshRig.push(() => {
      const value = draft[selected]![key];
      input.value = String(value);
      out.textContent = value.toFixed(3);
    });
    shapeRows.append(row);
  };
  shapeKnob("wide", "width", 0.02, 1.2);
  shapeKnob("deep", "depth", 0.02, 1.2);
  shapeKnob("length", "length", 0.02, 1.2);
  shapeKnob("round", "roundness", 0, 1);
  shapeKnob("mass", "mass", 0.05, 8);
  rigPane.append(shapeRows);

  // Back to exactly spanning the gap to the child — the one thing the old
  // derived length did, kept as a button now that it is not automatic.
  const fitBone = el("<button style='width:100%;margin-top:4px'>FIT length to the next joint</button>");
  fitBone.onclick = () => {
    draft[selected]!.length = fitLength(draft, draft[selected]!.name);
    remember();
    refreshRig.forEach((sync) => sync());
  };
  rigPane.append(fitBone);

  const copyRig = el("<button style='width:100%;margin-top:4px'>COPY RIG</button>");
  copyRig.onclick = () => {
    void navigator.clipboard.writeText(draftToSource(draft)).then(
      () => (copyRig.textContent = "COPIED"),
      () => console.log(draftToSource(draft)),
    );
    setTimeout(() => (copyRig.textContent = "COPY RIG"), 1200);
  };
  rigPane.append(copyRig);
  section("Rig tool", rigPane);
  handles.visible = false;
  boneLines.visible = false;
  placeHandles();
  drawBones();
  refreshRig.forEach((sync) => sync());

  const koGrid = el("<div class='grid g3'></div>");
  for (const d of KNOCKDOWN_DIRECTIONS) {
    const b = el(`<button>${d}</button>`);
    b.onclick = () => {
      koDirection = d;
      // Re-run from the top, so picking a direction shows it at once.
      if (sequence.clips.some((c) => c.includes("<d>"))) start(sequence);
      toggles.forEach((t) => t());
    };
    toggles.push(() => b.classList.toggle("on", koDirection === d));
    koGrid.append(b);
  }
  section("Went down — direction", koGrid);

  const modeGrid = el("<div class='grid g3'></div>");
  const mode = (label: string, get: () => boolean, set: () => void): void => {
    const b = el(`<button>${label}</button>`);
    b.onclick = () => {
      set();
      toggles.forEach((t) => t());
    };
    toggles.push(() => b.classList.toggle("on", get()));
    modeGrid.append(b);
  };
  mode("BONES", () => layerOn, () => (layerOn = !layerOn));
  mode("BODY", () => bodyOn, () => (bodyOn = !bodyOn));
  mode("SLOW-MO", () => timeScale !== 1, () => (timeScale = timeScale === 1 ? 0.2 : 1));
  mode("AUTO", () => auto, () => (auto = !auto));
  mode("SKELETON", () => showSkeleton, () => (showSkeleton = !showSkeleton));
  section("A / B", modeGrid);

  const knobRows = el("<div></div>");
  const knob = (key: keyof typeof knobs, label: string, min: number, max: number): void => {
    const row = el(`<div class=row><label>${label}</label>
      <input type=range min=${min} max=${max} step=0.05 value=${knobs[key]}><output>${knobs[key].toFixed(2)}</output></div>`);
    const input = row.querySelector("input")!;
    const out = row.querySelector("output")!;
    input.oninput = () => {
      knobs[key] = Number(input.value);
      out.textContent = knobs[key].toFixed(2);
      // The springs live in the layer, so a changed shape means a new one.
      if (key !== "scale") rubber = rubberFor();
    };
    knobRows.append(row);
  };
  knob("gain", "gain ×", 0, 3);
  knob("hz", "speed ×", 0.2, 3);
  knob("zeta", "damping ×", 0.2, 3);
  knob("delay", "travel ×", 0, 4);
  knob("scale", "master", 0, 2);
  section("Bones", knobRows);

  const bodyRows = el("<div></div>");
  const bodyRow = el(`<div class=row><label>softness ×</label>
    <input type=range min=0 max=4 step=0.05 value=1><output>1.00</output></div>`);
  {
    const input = bodyRow.querySelector("input")!;
    const out = bodyRow.querySelector("output")!;
    input.oninput = () => {
      knobs.body = Number(input.value);
      out.textContent = knobs.body.toFixed(2);
    };
  }
  bodyRows.append(bodyRow);
  section("Body — soft all the time", bodyRows);

  const bars = el("<div id=bars></div>");
  const fills = RUBBER_BONES.map((spec) => {
    const bar = el(`<div class=bar><span>${spec.name}</span><i><b></b></i></div>`);
    bars.append(bar);
    return bar.querySelector("b")!;
  });
  section("Deflection", bars);

  const copy = el("<button style='width:100%;margin-top:6px'>COPY TABLE</button>");
  copy.onclick = () => {
    const rows = scaledSpecs()
      .map(
        (b) =>
          `  { name: ${JSON.stringify(b.name)}, gain: ${+b.gain.toFixed(3)}, delayMs: ${Math.round(b.delayMs)}, ` +
          `hz: ${+b.hz.toFixed(2)}, zeta: ${+b.zeta.toFixed(3)}, maxAngle: ${b.maxAngle} },`,
      )
      .join("\n");
    const text = `export const RUBBER_BONES: readonly RubberBoneSpec[] = [\n${rows}\n];\n// master scale ${knobs.scale.toFixed(2)}`;
    void navigator.clipboard.writeText(text).then(
      () => (copy.textContent = "COPIED"),
      () => console.log(text),
    );
    setTimeout(() => (copy.textContent = "COPY TABLE"), 1200);
  };
  section("Out", copy);
  toggles.forEach((t) => t());

  const pick = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  renderer.domElement.addEventListener("pointerdown", (event) => {
    if (!rigMode) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    pick.setFromCamera(pointer, camera);
    const hit = pick.intersectObjects(handleMeshes, false)[0];
    if (hit) select(handleMeshes.findIndex((mesh) => mesh === hit.object));
  });

  addEventListener("keydown", (e) => {
    const hit = IMPACTS.find((i) => i.key === e.key);
    if (hit) fire(hit.kind);
    else if (e.code === "Space") fire("knockdown");
    else if (e.key === "ArrowUp") direction = { x: 0, z: -1 };
    else if (e.key === "ArrowDown") direction = { x: 0, z: 1 };
    else if (e.key === "ArrowLeft") direction = { x: -1, z: 0 };
    else if (e.key === "ArrowRight") direction = { x: 1, z: 0 };
    else if (e.key.toLowerCase() === "l") layerOn = !layerOn;
    else if (e.key.toLowerCase() === "b") bodyOn = !bodyOn;
    else if (e.key.toLowerCase() === "s") timeScale = timeScale === 1 ? 0.2 : 1;
    else if (e.key.toLowerCase() === "r") {
      if (rigMode) setMode("rotate");
      else start(sequence);
    } else if (e.key.toLowerCase() === "g" && rigMode) setMode("translate");
    else if (e.key.toLowerCase() === "h" && rigMode) setMode("shape");
    else if (e.key.toLowerCase() === "k") koButtonRef?.click();
    else return;
    e.preventDefault();
    toggles.forEach((t) => t());
  });

  // A dev probe for chasing hand-over glitches from the console: sampled per
  // frame by whoever needs it, never read by the page itself.
  (window as unknown as Record<string, unknown>).__rubberProbe = {
    root,
    model: model.scene,
    pelvis,
    camera,
    controls,
    grabber,
    physicsActive: () => physics?.active ?? false,
    holding: () => physics?.holding ?? false,
  };

  // --- the frame -----------------------------------------------------------
  resize();
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    // One delta drives the mixer, the springs and the sequence's own clock,
    // so a performance can never run ahead of what is drawn. The cap is only
    // there to survive a backgrounded tab, and is deliberately well past a
    // slow frame: at 0.1 s a machine drawing 7 fps threw away three quarters
    // of every second and played everything in slow motion.
    const delta = Math.min(MAX_FRAME_SECONDS, clock.getDelta()) * timeScale;
    showMs += delta * 1000;

    // A performance runs on the demo's own clock, so slow-motion stretches
    // the whole thing and not just the springs over it.
    if (!physics?.active && !sequence.rest && !sequence.loop && showMs >= pieceEndsAt) {
      if (pieceIndex + 1 < sequence.clips.length) playPiece(pieceIndex + 1);
      else if (sequence === getUpSequence) {
        // Up — straight back to what the knockout interrupted, no hold.
        getUpSequence = null;
        if (resumeAfterKo) start(resumeAfterKo);
        toggles.forEach((t) => t());
      } else if (showMs >= pieceEndsAt + SEQUENCE_HOLD_MS) playPiece(0);
    }

    // While physics owns the rig, nothing else writes to it: no mixer, no
    // springs, no squash. That is the whole point of the comparison — what is
    // on screen is the ragdoll and only the ragdoll.
    const physicsRunning = physics?.update(showMs) ?? false;

    // The moment physics lets go — inside that update — the bones hold the
    // synced heap, and it has to be captured HERE, before the mixer below
    // writes anything. Captured at the top of the loop it was one frame
    // late: the mixer had already overwritten the heap with the old clip's
    // pose, which both flashed for a frame and made the blend start from
    // the wrong pose entirely.
    if (landed) {
      // The body was carried at one squash and one bone-spring state and
      // lands at another — both layers restart clean or their springs ring
      // on the difference (measured: the scene's Y-scale swung 0.43–0.76).
      softBody.reset();
      rubber.reset();
      const clip = `GetUp_${landed.side}`;
      if (landed.driven && has(clip)) {
        // The doll was driven onto this clip's exact first frame, so the
        // clip starts at FULL weight, no fade, no blend: the world pose
        // already matches. A fade would mix the clip with the heap's own
        // encoding of the same pose (bones lying under an upright root vs
        // the clip's pitched root), and interpolating between two encodings
        // of one pose sweeps the body through the floor — the jump.
        getUpSequence = { group: "Down", label: "get up", clips: [clip] };
        sequence = getUpSequence;
        mixer.stopAllAction();
        const action = bindClipAction(mixer, model.animations, clip, false)!;
        action.reset().play();
        current = action;
        pieceIndex = 0;
        pieceEndsAt = showMs + action.getClip().duration * 1000;
        nowPlaying = `${clip} — get up, seamless`;
        heapPose = null;
      } else {
        // No clip to land in (or an undriven heap): keep the eased blend
        // out of the captured pose — better than snapping.
        heapPose = new Map();
        model.scene.traverse((o) => {
          const bone = o as THREE.Bone;
          if (bone.isBone) heapPose!.set(bone, { position: bone.position.clone(), quaternion: bone.quaternion.clone() });
        });
        getUpFrom = showMs;
        if (has(clip)) {
          getUpSequence = { group: "Down", label: "get up", clips: [clip] };
          start(getUpSequence);
        } else if (resumeAfterKo) {
          start(resumeAfterKo);
        }
      }
      landed = null;
      toggles.forEach((t) => t());
    }

    if (!physicsRunning && sequence.rest) {
      // Held still on purpose: no clip, no springs, no squash.
      restPose();
      model.scene.scale.setScalar(scale);
    } else if (!physicsRunning) {
      mixer.update(delta);
      // The body is soft whether or not anything hit it — driven every frame
      // by how the rig's own pose is carrying it.
      if (pelvis) softBody.follow(bodyHeight(), delta, knobs.body);
      softBody.apply(showMs, bodyOn ? knobs.body : 0);
    }
    // After the mixer, always: it rewrites the bones this layer just bent —
    // for the clips that move them. See `rubberBones.ts` for the ones it does not.
    if (!physicsRunning && !sequence.rest) rubber.apply(showMs, layerOn ? knobs.scale : 0);

    // Out of the heap: whatever the clip wants, the first moments of the
    // get-up still show the captured heap, eased away — physics hands the
    // body to animation without a snap.
    if (heapPose && !physicsRunning) {
      const w = Math.min(1, (showMs - getUpFrom) / GETUP_BLEND_MS);
      const eased = w * w * (3 - 2 * w);
      for (const [bone, held] of heapPose) {
        blendQ.copy(bone.quaternion);
        bone.quaternion.copy(held.quaternion).slerp(blendQ, eased);
        blendP.copy(bone.position);
        bone.position.copy(held.position).lerp(blendP, eased);
      }
      if (w >= 1) heapPose = null;
    }

    if (auto && showMs - lastAutoMs > 1800) {
      lastAutoMs = showMs;
      fire(IMPACTS[Math.floor(Math.random() * IMPACTS.length)]!.kind);
    }
    for (const [i, spec] of RUBBER_BONES.entries()) {
      const bone = root.getObjectByName(spec.name.replace(/\./g, ""));
      const angle = bone ? 2 * Math.acos(Math.min(1, Math.abs(bone.quaternion.w))) : 0;
      fills[i]!.style.width = `${Math.min(100, (angle / spec.maxAngle) * 100).toFixed(0)}%`;
    }
    // The physics bones, drawn where they really are: standing, that is the
    // authored rest pose beside the bean; knocked out, it is the live one.
    skeletonView.visible = showSkeleton;
    setSeeThrough(showSkeleton);
    if (showSkeleton) {
      if (physicsRunning && physics) {
        const { bones, pose } = physics.skeleton;
        skeletonView.update(bones, pose);
      } else {
        skeletonView.updateAtRest(liveBones(), capsuleCentre());
      }
    }
    if (pelvis) {
      // While something is being wound up, the show is the pair — the orbit
      // watched from its own still centre, not from the whirling pelvis.
      const holdNow = physics?.hold;
      if (holdNow) watched.set(holdNow.pivotX, 0.9, holdNow.pivotZ);
      else pelvis.getWorldPosition(watched);
      // The body is followed by moving what the orbit looks at, and the
      // camera is carried along with it — so dragging still sets the angle
      // and the distance, and a knockdown that travels never leaves frame.
      const ease = 1 - Math.exp(-CAMERA_FOLLOW_RATE * Math.max(delta, 1 / 240));
      const before = controls.target.clone();
      controls.target.lerp(watched, ease);
      camera.position.add(controls.target.clone().sub(before));
    }
    // The grabbing BLIP is its own little performer: turned by the spin,
    // leaned by the actual centrifugal load, thrown off balance by letting
    // go, then left idling where it threw from.
    if (grabber.visible) {
      const hold = physics?.hold;
      if (hold) {
        grabber.rotation.y = hold.yaw;
        grabberYawVel = hold.omega;
        grabberLastOmega = hold.omega;
      } else if (grabberYawVel > 0.01) {
        // Nobody stops dead out of a spin: the turn carries on and bleeds off.
        grabber.rotation.y += grabberYawVel * delta;
        grabberYawVel *= Math.exp(-delta / 0.35);
      }
      if (grabberWasHolding && !hold) {
        // The release: the pull he was braced against is suddenly gone, and
        // what held him at his lean now tips him further back — a kick sized
        // by the actual load that vanished (ω²·R against gravity), capped
        // before it reads as a pratfall.
        grabberLeanVel += Math.min(
          2.2,
          (grabberLastOmega * grabberLastOmega * HOLD_RADIUS) / Math.abs(GRAVITY_Y),
        );
        const dropMs = grabberPlay("Grab_DropOut", false);
        grabberNext = { at: showMs + dropMs, name: "Idle", loop: true };
      }
      // A hammer thrower leans away from the weight. ω²·R against gravity,
      // scaled well down (the honest balance angle is ~50° at full wind —
      // right for a hammer, silly for a bean) and capped.
      const leanTarget = hold
        ? Math.min(0.3, (hold.omega * hold.omega * HOLD_RADIUS) / (Math.abs(GRAVITY_Y) * 4))
        : 0;
      const dt = Math.min(delta, 1 / 30);
      grabberLeanVel +=
        (GRABBER_LEAN_HZ * GRABBER_LEAN_HZ * (leanTarget - grabberLean) -
          2 * GRABBER_LEAN_ZETA * GRABBER_LEAN_HZ * grabberLeanVel) *
        dt;
      grabberLean = Math.max(-0.6, Math.min(0.6, grabberLean + grabberLeanVel * dt));
      grabber.rotation.x = -grabberLean;
      if (grabberNext && showMs >= grabberNext.at) {
        grabberPlay(grabberNext.name, grabberNext.loop);
        grabberNext = null;
      }
      grabberMixer.update(delta);
    }
    grabberWasHolding = physics?.holding ?? false;

    // The grabber lets go on its own timer too, so the button's label follows
    // the hold rather than the clicks.
    const holdLabel = physics?.holding ? "HURL!" : "GRAB — spin, then HURL";
    if (hurlBtn.textContent !== holdLabel) {
      hurlBtn.textContent = holdLabel;
      hurlBtn.classList.toggle("on", physics?.holding ?? false);
    }
    // A looping clip has no end to report, and a stale one reads as a stall.
    // Said out loud, because a skeleton that draws nothing looks exactly like
    // a skeleton that was never picked, and only the page knows which it is.
    const drawn = skeletonView.drawn;
    const shapes = showSkeleton
      ? `  ·  ${skeletonLabel()}: ${drawn.shapes} shapes${drawn.failed > 0 ? `, ${drawn.failed} unbuildable` : ""}`
      : "";
    const ends = sequence.rest ? "held" : sequence.loop ? "looping" : `ends ${(pieceEndsAt / 1000).toFixed(1)}s`;
    hint.textContent = physicsRunning
      ? `PHYSICS KO — ${skeletonLabel()} skeleton, no animation, no layers   ·   t ${(showMs / 1000).toFixed(1)}s${shapes}`
      : `${nowPlaying}   ·   t ${(showMs / 1000).toFixed(1)}s   ${ends}` +
        `   ·   body ${(softBody.squash * 100).toFixed(1)}%${shapes}`;
    if (rigMode) {
      placeHandles();
      drawBones();
    }
    controls.update();
    renderer.render(scene, camera);
  });
};

void main().catch((error: unknown) => {
  status.textContent = `BLIP failed to load: ${String(error)}`;
});
