import * as THREE from "three";
import { clone as cloneRig } from "three/addons/utils/SkeletonUtils.js";
import {
  bindClipAction,
  CHARACTER_VISUAL_HEIGHT,
  crossfadeLocomotion,
  loadCharacterModel,
  LOCOMOTION_CROSSFADE_SECONDS,
} from "./characterModel.js";
import { createWardrobe } from "./hats.js";
import { formationHalfSpan, partyFormation } from "./partyFormation.js";
import { tintHueForColor } from "./playerTint.js";
import { createSkinCloset } from "./skins.js";

/** Idle turntable speed (rad/s) — one full turn in ~10 s, slow enough to inspect the bean. */
const TURNTABLE_SPEED = 0.6;

/** How much room the camera leaves around a lone bean's height — a celebration stays in view. */
const FRAME_MARGIN = 1.45;
/** How much room it leaves either side of a Party's formation, so the outermost bean is never cut. */
const GROUP_FRAME_MARGIN = 1.15;
/**
 * How far apart (seconds) the companions' Idle loops start, so a Party
 * breathes out of step instead of as one. Not a multiple of any clip length.
 */
const COMPANION_IDLE_STAGGER_SECONDS = 0.37;

/**
 * One more bean on the stage beside the main one (ADR 0112): a Party member,
 * in their own look. `id` is who it is, so a bean keeps its rig while the
 * others around it change.
 */
export interface PreviewBean {
  id: string;
  color: number | null;
  skin: string | null;
  hat: string | null;
}

/**
 * One sequence step: play `clip`, holding it for `seconds` when set (looped)
 * or exactly once through its own duration when not. A missing clip is
 * skipped with a warning — an authoring rename must degrade one step, never
 * the whole preview.
 */
export interface PreviewStep {
  clip: string;
  seconds?: number;
}

export interface CharacterPreviewStageOptions {
  /** Equipped body color at mount — or null for the default. Later changes go through {@link CharacterPreviewStage.setLook}. */
  color: number | null;
  /** Equipped skin at mount (ADR 0091) — or null for none, which shows the `color`. */
  skin: string | null;
  /** Equipped hat at mount (ADR 0083) — or null for none. Later changes go through {@link CharacterPreviewStage.setHat}. */
  hat: string | null;
  /** Slow idle rotation. */
  autoRotate: boolean;
  /** The sequence to perform, read live at every step so a new one takes effect on {@link CharacterPreviewStage.restart}. */
  steps: () => PreviewStep[];
  /**
   * Beans standing with the main one at mount (the menu's Party, ADR 0112),
   * in formation order — none on every other screen. Later changes go
   * through {@link CharacterPreviewStage.setCompanions}.
   */
  companions?: PreviewBean[];
  /** The model could not be loaded — the screen shows its caption instead. */
  onUnavailable: () => void;
}

/** A mounted preview: what the screen's own effects drive once it exists. */
export interface CharacterPreviewStage {
  /** Dresses the bean's body: its `skin`, or its `color` when it has none. */
  setLook: (color: number | null, skin: string | null) => void;
  /** Puts a hat on, or takes it off for `null`. */
  setHat: (hat: string | null) => void;
  /**
   * The beans standing with the main one, in formation order: a new id gets
   * a rig, a missing one loses its rig, a kept one is re-dressed and moved to
   * its new spot. The camera widens or closes in to fit them.
   */
  setCompanions: (beans: PreviewBean[]) => void;
  /** Restarts the sequence from its first step. */
  restart: () => void;
  /** Queues one full extra turn. */
  spin: () => void;
  dispose: () => void;
}

interface PreviewPlayer {
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  animations: THREE.AnimationClip[];
  active: THREE.AnimationAction | null;
  /** Extra turns queued — eased toward, never snapped to. */
  spinTarget: number;
  spinCurrent: number;
  autoAngle: number;
  stepTimer: ReturnType<typeof setTimeout> | null;
  warnedClips: Set<string>;
}

/** A companion's rig: a copy of the main bean's, idling on its own mixer. */
interface CompanionRig {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
}

/** What the camera fits, measured once off the main bean after it loads. */
interface Framing {
  center: THREE.Vector3;
  /** The bean's height — the formation's unit. */
  height: number;
  halfWidth: number;
  /** Where the bean's feet correction puts every rig's origin. */
  feetY: number;
}

/**
 * The stage behind `CharacterPreview` (M9): renderer, lights, camera fit,
 * tint, sequence player and teardown, for one canvas — one bean performing,
 * and on the main menu the rest of its Party idling beside it (ADR 0112,
 * `partyFormation.ts`). Lives on the game side
 * of the code split (ADR 0008) — the screen loads it with a dynamic
 * `import()`, so the menu bundle never carries three.js or the rig loader.
 *
 * Throws where a WebGL renderer cannot be created (blocked GPU, WebGL off);
 * the caller shows its caption instead.
 */
export const mountCharacterPreview = (
  canvas: HTMLCanvasElement,
  wrap: HTMLElement,
  {
    color: initialColor,
    skin: initialSkin,
    hat: initialHat,
    autoRotate,
    steps,
    companions: initialCompanions = [],
    onUnavailable,
  }: CharacterPreviewStageOptions,
): CharacterPreviewStage => {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x4a3a6a, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(3, 5, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xbfa8ff, 0.7);
  rim.position.set(-4, 2, -3);
  scene.add(rim);

  let color = initialColor;
  let skin = initialSkin;
  let hat = initialHat;
  // This canvas's own wardrobe and closet: a renderer's cosmetics are its own to free.
  const wardrobe = createWardrobe();
  const closet = createSkinCloset();
  let player: PreviewPlayer | null = null;
  let raf = 0;
  let cancelled = false;
  let root: THREE.Group | null = null;
  let mixer: THREE.AnimationMixer | null = null;
  let clips: THREE.AnimationClip[] = [];
  let framing: Framing | null = null;
  let companionBeans = initialCompanions;
  const companionRigs = new Map<string, CompanionRig>();
  const clock = new THREE.Clock();

  /**
   * Frames the scaled bean: far enough a celebration stays in view, close
   * enough it fills the stage — and, with companions, far enough that the
   * whole formation fits this canvas's width. Re-run on every resize, since
   * only the formation's fit depends on the aspect.
   */
  const frame = (): void => {
    if (!framing) return;
    const { center, height, halfWidth } = framing;
    const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    let dist = (height / 2 / tanHalfFov) * FRAME_MARGIN;
    if (companionBeans.length > 0) {
      const reach = formationHalfSpan(partyFormation(companionBeans.length)) * height + halfWidth;
      dist = Math.max(dist, (reach / (tanHalfFov * camera.aspect)) * GROUP_FRAME_MARGIN);
    }
    camera.position.set(center.x, center.y + height * 0.08, center.z + dist);
    camera.lookAt(center);
  };

  const fit = () => {
    const w = Math.max(wrap.clientWidth, 1);
    const h = Math.max(wrap.clientHeight, 1);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    frame();
  };
  const resize = new ResizeObserver(fit);
  resize.observe(wrap);
  fit();

  /** Starts the sequence at step `index`, crossfading in and scheduling the next step. */
  const playStep = (current: PreviewPlayer, index: number, skips = 0): void => {
    if (cancelled || player !== current) return;
    const sequence = steps();
    if (sequence.length === 0) return;
    const step = sequence[index % sequence.length]!;
    const hold = step.seconds !== undefined;
    const action = bindClipAction(current.mixer, current.animations, step.clip, hold || sequence.length === 1);
    if (!action) {
      if (!current.warnedClips.has(step.clip)) {
        current.warnedClips.add(step.clip);
        console.warn(`CharacterPreview: unknown clip "${step.clip}" — step skipped`);
      }
      // Every step missing would spin zero-length timers forever — park instead.
      if (skips + 1 >= sequence.length) return;
      queueStep(current, index + 1, 0, skips + 1);
      return;
    }
    current.active = crossfadeLocomotion(action, current.active, LOCOMOTION_CROSSFADE_SECONDS);
    // A lone clip loops on its own stage forever — no timer to advance.
    if (sequence.length === 1 && !hold) return;
    queueStep(current, index + 1, (hold ? step.seconds! : action.getClip().duration) * 1000, 0);
  };

  const queueStep = (current: PreviewPlayer, index: number, ms: number, skips: number): void => {
    if (current.stepTimer) clearTimeout(current.stepTimer);
    current.stepTimer = setTimeout(() => playStep(current, index, skips), ms);
  };

  /**
   * A companion's rig: a copy of the main bean's (`SkeletonUtils.clone` — its
   * own skeleton, the loaded geometry shared), so a Party of four costs one
   * model load, not four. Idling out of step with the others. The wardrobe
   * and closet undress the copy on its first `wear` (their own rule for a rig
   * copied from a dressed one), so it never shows your look while its own
   * arrives.
   */
  const standCompanion = (source: THREE.Object3D, index: number): CompanionRig => {
    const copy = cloneRig(source);
    scene.add(copy);
    const companionMixer = new THREE.AnimationMixer(copy);
    bindClipAction(companionMixer, clips, "Idle", true)?.play();
    companionMixer.setTime((index + 1) * COMPANION_IDLE_STAGGER_SECONDS);
    return { root: copy, mixer: companionMixer };
  };

  /**
   * Takes a companion off the stage. Its hat goes back to the wardrobe
   * first (a worn hat's materials are the wardrobe's), then only what the
   * copy owns is freed — its skeleton and the materials its first `wear`
   * cloned — never the geometry, which is the main bean's and freed with it.
   */
  const retireCompanion = (rig: CompanionRig): void => {
    rig.mixer.stopAllAction();
    wardrobe.wear(rig.root, null);
    scene.remove(rig.root);
    rig.root.traverse((object) => {
      const mesh = object as Partial<THREE.SkinnedMesh>;
      mesh.skeleton?.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
      for (const material of materials) material.dispose();
    });
  };

  /**
   * Makes the stage's companions match `companionBeans`: a rig per new bean,
   * none for one that left, everyone dressed in their own look and standing
   * in their spot of the formation. Waits for the main bean — its load runs
   * this — since every companion is a copy of it.
   */
  const syncCompanions = (): void => {
    const source = root;
    const measured = framing;
    if (cancelled || !source || !measured) return;
    const wanted = new Set(companionBeans.map((bean) => bean.id));
    for (const [id, rig] of companionRigs) {
      if (wanted.has(id)) continue;
      retireCompanion(rig);
      companionRigs.delete(id);
    }
    const slots = partyFormation(companionBeans.length);
    companionBeans.forEach((bean, index) => {
      let rig = companionRigs.get(bean.id);
      if (!rig) {
        rig = standCompanion(source, index);
        companionRigs.set(bean.id, rig);
      }
      wardrobe.wear(rig.root, bean.hat);
      closet.wear(rig.root, bean.skin, tintHueForColor(bean.color));
      const slot = slots[index]!;
      rig.root.position.set(slot.x * measured.height, measured.feetY, slot.z * measured.height);
      rig.root.rotation.set(0, slot.yaw, 0);
    });
    frame();
  };

  const tick = () => {
    if (cancelled) return;
    raf = requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.05);
    if (!player || !root || !mixer) {
      renderer.render(scene, camera);
      return;
    }
    if (autoRotate) player.autoAngle += dt * TURNTABLE_SPEED;
    // The queued extra turn eases out — a second spin mid-spin just adds
    // another turn to the target instead of fighting the current one.
    player.spinCurrent += (player.spinTarget - player.spinCurrent) * Math.min(1, dt * 4);
    if (Math.abs(player.spinTarget - player.spinCurrent) < 0.001) player.spinCurrent = player.spinTarget;
    root.rotation.y = player.autoAngle + player.spinCurrent;
    mixer.update(dt);
    for (const rig of companionRigs.values()) rig.mixer.update(dt);
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(tick);

  loadCharacterModel()
    .then((model) => {
      if (cancelled) {
        disposeRig(model.scene);
        return;
      }
      root = model.scene;
      // Same scale-and-feet correction the match applies (`scene.ts`), so
      // the previewed bean is the bean in the game, feet at y = 0.
      const natural = new THREE.Box3().setFromObject(root);
      const naturalHeight = natural.getSize(new THREE.Vector3()).y;
      const scale = naturalHeight > 0 ? CHARACTER_VISUAL_HEIGHT / naturalHeight : 1;
      root.scale.setScalar(scale);
      root.position.y = -natural.min.y * scale;
      closet.wear(root, skin, tintHueForColor(color));
      wardrobe.wear(root, hat);
      scene.add(root);
      mixer = new THREE.AnimationMixer(root);
      const loaded: PreviewPlayer = {
        root,
        mixer,
        animations: model.animations,
        active: null,
        spinTarget: 0,
        spinCurrent: 0,
        autoAngle: 0,
        stepTimer: null,
        warnedClips: new Set(),
      };
      player = loaded;
      clips = model.animations;
      playStep(loaded, 0);
      // Measured once, off the scaled bean — `frame` places the camera from it.
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      framing = {
        center: box.getCenter(new THREE.Vector3()),
        height: Math.max(size.y, 0.01),
        halfWidth: size.x / 2,
        feetY: root.position.y,
      };
      // The Party waited for this bean: every companion is a copy of it.
      syncCompanions();
      fit();
    })
    .catch(() => {
      if (!cancelled) onUnavailable();
    });

  return {
    // The body follows the pick — the closet drops a change that shows
    // nothing, since restyling clones every material.
    setLook: (nextColor, nextSkin) => {
      color = nextColor;
      skin = nextSkin;
      if (player) closet.wear(player.root, nextSkin, tintHueForColor(nextColor));
    },
    setHat: (next) => {
      hat = next;
      if (player) wardrobe.wear(player.root, next);
    },
    setCompanions: (beans) => {
      companionBeans = beans;
      syncCompanions();
    },
    restart: () => {
      if (player) playStep(player, 0);
    },
    spin: () => {
      if (player) player.spinTarget += Math.PI * 2;
    },
    dispose: () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      resize.disconnect();
      const current = player;
      player = null;
      if (current?.stepTimer) clearTimeout(current.stepTimer);
      // Companions first: they share the main bean's geometry, freed below.
      for (const rig of companionRigs.values()) retireCompanion(rig);
      companionRigs.clear();
      if (mixer) mixer.stopAllAction();
      if (root) {
        scene.remove(root);
        // A fresh `loadCharacterModel` per mount owns everything it loaded —
        // geometry included — so this is a full dispose, unlike the pooled
        // rigs' shared-geometry teardown (`disposeRemoteRig`).
        disposeRig(root);
      }
      wardrobe.dispose();
      closet.dispose();
      renderer.dispose();
    },
  };
};

/** Frees a wholly-owned rig — geometry, materials, skeleton. See `dispose`'s own note. */
const disposeRig = (root: THREE.Object3D): void => {
  root.traverse((object) => {
    const mesh = object as Partial<THREE.SkinnedMesh>;
    mesh.skeleton?.dispose();
    if (mesh.geometry) mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials) material.dispose();
  });
};
