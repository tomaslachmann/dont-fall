import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import {
  bindClipAction,
  CHARACTER_VISUAL_HEIGHT,
  crossfadeLocomotion,
  loadCharacterModel,
  LOCOMOTION_CROSSFADE_SECONDS,
} from "../render/characterModel.js";
import { tintHueForSkin, tintModel } from "../render/playerTint.js";
import RenderSlot from "../ui/RenderSlot.js";
import s from "./CharacterPreview.module.css";

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

/** What the preview performs: one clip looped forever, or a list looped as a sequence. */
export type PreviewAnimation = string | PreviewStep[];

/**
 * The authored beats, shared by every screen that stages them — the
 * Win/Sulk/Shrug clips come as In/Hold/Out (or Start/Loop/End) triplets and
 * only read as a performance when played as one. Hold lengths are whole loop
 * counts off the real clip durations (`Win_Loop`/`Shrug_Hold` 1.6 s,
 * `Sulk_Hold` 2.0 s), so a hold never cuts its own clip mid-beat.
 */
export const WIN_SEQUENCE: PreviewStep[] = [{ clip: "Win_Start" }, { clip: "Win_Loop", seconds: 3.2 }, { clip: "Win_End" }];
export const SULK_SEQUENCE: PreviewStep[] = [{ clip: "Sulk_In" }, { clip: "Sulk_Hold", seconds: 4 }, { clip: "Sulk_Out" }];
export const SHRUG_SEQUENCE: PreviewStep[] = [{ clip: "Shrug_In" }, { clip: "Shrug_Hold", seconds: 3.2 }, { clip: "Shrug_Out" }];

export interface CharacterPreviewProps {
  /** Equipped skin — or null for the default, when nobody's skin is known. */
  skin: number | null;
  animation: PreviewAnimation;
  /** Slow idle rotation. On unless the screen stages the bean deliberately still. */
  autoRotate?: boolean | undefined;
  /** Increment to spin the bean one full extra turn. */
  spinToken?: number | undefined;
  /** Fallback caption (no WebGL, no model) — the RenderSlot treatment, same as before. */
  label?: string | undefined;
  sub?: string | undefined;
  canvasLabel?: string | undefined;
  className?: string | undefined;
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
 * The live 3D bean every screen rents (M9): the same BLIP rig the match
 * renders, tinted with a skin, performing one looping clip or a looping
 * sequence. CharacterSelect's turntable, the MainMenu hero, the MatchOver
 * podium, the Rewards celebration and the Auth/NotFound greeters are all
 * this component with different props — the stage (renderer, lights, camera
 * fit, tint, teardown) exists exactly once, here.
 */
export function CharacterPreview({
  skin,
  animation,
  autoRotate = true,
  spinToken = 0,
  label = "3D CHARACTER RENDER",
  sub,
  canvasLabel = "3D character preview",
  className,
}: CharacterPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [available, setAvailable] = useState(true);
  const playerRef = useRef<PreviewPlayer | null>(null);
  /** Restarts this instance's sequence — set by the mount effect, cleared on teardown. */
  const restartRef = useRef<(() => void) | null>(null);
  // Screens pass sequence literals inline — a new array identity every
  // render. The player restarts on the serialized steps, never the reference,
  // or the podium would restart its celebration every frame.
  const steps: PreviewStep[] = typeof animation === "string" ? [{ clip: animation }] : animation;
  const stepsKey = JSON.stringify(steps);
  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  const skinRef = useRef(skin);
  skinRef.current = skin;
  const firstSpin = useRef(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    } catch {
      // jsdom, blocked GPU, WebGL off — the RenderSlot below says what this is.
      setAvailable(false);
      return;
    }
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

    let raf = 0;
    let cancelled = false;
    let root: THREE.Group | null = null;
    let mixer: THREE.AnimationMixer | null = null;
    const clock = new THREE.Clock();
    const rotate = autoRotate;

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
    const playStep = (player: PreviewPlayer, index: number, skips = 0): void => {
      if (cancelled || playerRef.current !== player) return;
      const current = stepsRef.current;
      if (current.length === 0) return;
      const step = current[index % current.length]!;
      const hold = step.seconds !== undefined;
      const action = bindClipAction(player.mixer, player.animations, step.clip, hold || current.length === 1);
      if (!action) {
        if (!player.warnedClips.has(step.clip)) {
          player.warnedClips.add(step.clip);
          console.warn(`CharacterPreview: unknown clip "${step.clip}" — step skipped`);
        }
        // Every step missing would spin zero-length timers forever — park instead.
        if (skips + 1 >= current.length) return;
        queueStep(player, index + 1, 0, skips + 1);
        return;
      }
      player.active = crossfadeLocomotion(action, player.active, LOCOMOTION_CROSSFADE_SECONDS);
      // A lone clip loops on its own stage forever — no timer to advance.
      if (current.length === 1 && !hold) return;
      queueStep(player, index + 1, (hold ? step.seconds! : action.getClip().duration) * 1000, 0);
    };

    const queueStep = (player: PreviewPlayer, index: number, ms: number, skips: number): void => {
      if (player.stepTimer) clearTimeout(player.stepTimer);
      player.stepTimer = setTimeout(() => playStep(player, index, skips), ms);
    };
    restartRef.current = () => {
      const player = playerRef.current;
      if (player) playStep(player, 0);
    };

    const tick = () => {
      if (cancelled) return;
      raf = requestAnimationFrame(tick);
      const dt = Math.min(clock.getDelta(), 0.05);
      const player = playerRef.current;
      if (!player || !root || !mixer) {
        renderer.render(scene, camera);
        return;
      }
      if (rotate) player.autoAngle += dt * TURNTABLE_SPEED;
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
        const hue = tintHueForSkin(skinRef.current);
        tintModel(root, hue);
        scene.add(root);
        mixer = new THREE.AnimationMixer(root);
        const player: PreviewPlayer = {
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
        playerRef.current = player;
        playStep(player, 0);
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
        if (!cancelled) setAvailable(false);
      });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      resize.disconnect();
      restartRef.current = null;
      const player = playerRef.current;
      playerRef.current = null;
      if (player?.stepTimer) clearTimeout(player.stepTimer);
      if (mixer) mixer.stopAllAction();
      if (root) {
        scene.remove(root);
        // A fresh `loadCharacterModel` per mount owns everything it loaded —
        // geometry included — so this is a full dispose, unlike the pooled
        // rigs' shared-geometry teardown (`disposeRemoteRig`).
        disposeRig(root);
      }
      renderer.dispose();
    };
    // stepsKey intentionally excluded: a new sequence restarts the player
    // through the animation effect below, never through a stage rebuild.
  }, []);

  // The preview tint follows the skin — guarded, like the match's `setSkins`,
  // since a re-tint clones every material.
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const hue = tintHueForSkin(skin);
    if (hue === player.appliedHue) return;
    tintModel(player.root, hue);
    player.appliedHue = hue;
  }, [skin]);

  // A new sequence restarts the player from its first step.
  useEffect(() => {
    restartRef.current?.();
    // The key IS the dependency — see the note where it is built.
  }, [stepsKey]);

  useEffect(() => {
    if (firstSpin.current) {
      firstSpin.current = false;
      return;
    }
    const player = playerRef.current;
    if (player) player.spinTarget += Math.PI * 2;
  }, [spinToken]);

  return (
    <div ref={wrapRef} className={[s.stage, className].filter(Boolean).join(" ")}>
      {available ? (
        <canvas ref={canvasRef} className={s.canvas} aria-label={canvasLabel} />
      ) : (
        <RenderSlot label={label} sub={sub} grounded wobble />
      )}
    </div>
  );
}

/** Frees a wholly-owned rig — geometry, materials, skeleton. See the mount effect's own note. */
const disposeRig = (root: THREE.Object3D): void => {
  root.traverse((object) => {
    const mesh = object as Partial<THREE.SkinnedMesh>;
    mesh.skeleton?.dispose();
    if (mesh.geometry) mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials) material.dispose();
  });
};
