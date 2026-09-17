import * as THREE from "three";
import {
  bindClipAction,
  CHARACTER_VISUAL_HEIGHT,
  crossfadeLocomotion,
  loadCharacterModel,
  LOCOMOTION_CROSSFADE_SECONDS,
} from "./characterModel.js";
import { createWardrobe } from "./hats.js";
import { tintHueForSkin, tintModel } from "./playerTint.js";

/** Idle turntable speed (rad/s) — one full turn in ~10 s, slow enough to inspect the bean. */
const TURNTABLE_SPEED = 0.6;

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
  /** Equipped skin at mount — or null for the default. Later changes go through {@link CharacterPreviewStage.setSkin}. */
  skin: number | null;
  /** Equipped hat at mount (ADR 0083) — or null for none. Later changes go through {@link CharacterPreviewStage.setHat}. */
  hat: string | null;
  /** Slow idle rotation. */
  autoRotate: boolean;
  /** The sequence to perform, read live at every step so a new one takes effect on {@link CharacterPreviewStage.restart}. */
  steps: () => PreviewStep[];
  /** The model could not be loaded — the screen shows its caption instead. */
  onUnavailable: () => void;
}

/** A mounted preview: what the screen's own effects drive once it exists. */
export interface CharacterPreviewStage {
  setSkin: (skin: number | null) => void;
  /** Puts a hat on, or takes it off for `null`. */
  setHat: (hat: string | null) => void;
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
  appliedHue: number | null;
  /** Extra turns queued — eased toward, never snapped to. */
  spinTarget: number;
  spinCurrent: number;
  autoAngle: number;
  stepTimer: ReturnType<typeof setTimeout> | null;
  warnedClips: Set<string>;
}

/**
 * The stage behind `CharacterPreview` (M9): renderer, lights, camera fit,
 * tint, sequence player and teardown, for one canvas. Lives on the game side
 * of the code split (ADR 0008) — the screen loads it with a dynamic
 * `import()`, so the menu bundle never carries three.js or the rig loader.
 *
 * Throws where a WebGL renderer cannot be created (blocked GPU, WebGL off);
 * the caller shows its caption instead.
 */
export const mountCharacterPreview = (
  canvas: HTMLCanvasElement,
  wrap: HTMLElement,
  { skin: initialSkin, hat: initialHat, autoRotate, steps, onUnavailable }: CharacterPreviewStageOptions,
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

  let skin = initialSkin;
  let hat = initialHat;
  // This canvas's own wardrobe: a renderer's hats are its own to free.
  const wardrobe = createWardrobe();
  let player: PreviewPlayer | null = null;
  let raf = 0;
  let cancelled = false;
  let root: THREE.Group | null = null;
  let mixer: THREE.AnimationMixer | null = null;
  const clock = new THREE.Clock();

  const fit = () => {
    const w = Math.max(wrap.clientWidth, 1);
    const h = Math.max(wrap.clientHeight, 1);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
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
      const hue = tintHueForSkin(skin);
      tintModel(root, hue);
      wardrobe.wear(root, hat);
      scene.add(root);
      mixer = new THREE.AnimationMixer(root);
      const loaded: PreviewPlayer = {
        root,
        mixer,
        animations: model.animations,
        active: null,
        appliedHue: hue,
        spinTarget: 0,
        spinCurrent: 0,
        autoAngle: 0,
        stepTimer: null,
        warnedClips: new Set(),
      };
      player = loaded;
      playStep(loaded, 0);
      // Frame the scaled bean: far enough a celebration stays in view,
      // close enough it fills the stage.
      const box = new THREE.Box3().setFromObject(root);
      const center = box.getCenter(new THREE.Vector3());
      const height = Math.max(box.getSize(new THREE.Vector3()).y, 0.01);
      const dist = (height / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.45;
      camera.position.set(center.x, center.y + height * 0.08, center.z + dist);
      camera.lookAt(center);
      fit();
    })
    .catch(() => {
      if (!cancelled) onUnavailable();
    });

  return {
    // The tint follows the skin — guarded, like the match's `setSkins`,
    // since a re-tint clones every material.
    setSkin: (next) => {
      skin = next;
      if (!player) return;
      const hue = tintHueForSkin(next);
      if (hue === player.appliedHue) return;
      tintModel(player.root, hue);
      player.appliedHue = hue;
    },
    setHat: (next) => {
      hat = next;
      if (player) wardrobe.wear(player.root, next);
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
      if (mixer) mixer.stopAllAction();
      if (root) {
        scene.remove(root);
        // A fresh `loadCharacterModel` per mount owns everything it loaded —
        // geometry included — so this is a full dispose, unlike the pooled
        // rigs' shared-geometry teardown (`disposeRemoteRig`).
        disposeRig(root);
      }
      wardrobe.dispose();
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
