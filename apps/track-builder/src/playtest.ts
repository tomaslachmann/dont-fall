import {
  CAPSULE_BOTTOM_OFFSET,
  CAPSULE_HALF_HEIGHT,
  CAPSULE_RADIUS,
  DEFAULT_CHARACTER_ID,
  RapierSimulation,
  advanceFixed,
  initPhysics,
  movementDirection,
  resolveTrack,
  type Module,
  type Track,
  type Vec3,
} from "@dont-fall/shared";
import * as THREE from "three";
import { KeyboardInput } from "./keyboard.js";
import { applySegmentTransform, buildModuleGroup } from "./render.js";

export interface Playtest {
  /** Call once per `requestAnimationFrame`, passing its timestamp. */
  frame: (nowMs: number) => void;
  dispose: () => void;
}

/**
 * Local single-player playtest (ticket 05) — the same shared Rapier
 * simulation the live game runs, stepped at its fixed tick rate via
 * `advanceFixed` exactly like a real client, with no networking, no auth, and
 * no dependency on the live game client. Lets a developer walk/jump/dash the
 * Track currently being edited before saving it.
 */
export const startPlaytest = async (
  container: HTMLElement,
  modules: Record<string, Module>,
  track: Track,
): Promise<Playtest> => {
  await initPhysics();

  const { statics, checkpoints, spinners, props } = resolveTrack(modules, track);
  const first = track[0]?.position ?? { x: 0, y: 0, z: 0 };
  const spawn: Vec3 = { x: first.x, y: first.y + 1.2, z: first.z };
  const simulation = new RapierSimulation({ statics, checkpoints, spinners, props, spawn });

  const keyboard = new KeyboardInput();

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070b);
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const light = new THREE.DirectionalLight(0xffffff, 0.9);
  light.position.set(10, 20, 10);
  scene.add(light);
  scene.add(new THREE.GridHelper(200, 40, 0x2f3b4c, 0x1c2430));

  for (const segment of track) {
    const module = modules[segment.moduleId];
    if (!module) continue;
    const group = buildModuleGroup(module);
    applySegmentTransform(group, segment);
    scene.add(group);
  }

  const characterMesh = new THREE.Mesh(
    new THREE.CapsuleGeometry(CAPSULE_RADIUS, CAPSULE_HALF_HEIGHT * 2, 4, 8),
    new THREE.MeshStandardMaterial({ color: 0x4ade80 }),
  );
  scene.add(characterMesh);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);

  const resize = (): void => {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener("resize", resize);
  resize();

  let accumulatorMs = 0;
  let lastNow: number | undefined;

  const frame = (nowMs: number): void => {
    const elapsedMs = lastNow === undefined ? 0 : nowMs - lastNow;
    lastNow = nowMs;

    // Fixed, non-camera-relative controls (cameraYaw = 0): the follow camera
    // below never rotates with input, so W/A/S/D always mean the same world
    // directions — simplest correct choice for a collision/footprint check,
    // not a claim this is how the live game's own camera-relative look works.
    const input = {
      moveDirection: movementDirection(keyboard.movementKeys(), 0),
      jumpHeld: keyboard.jumpHeld(),
      dashHeld: keyboard.dashHeld(),
    };

    const result = advanceFixed({
      simulation,
      input: { [DEFAULT_CHARACTER_ID]: input },
      accumulatorMs,
      elapsedMs,
    });
    accumulatorMs = result.accumulatorMs;

    const character = result.snapshot.characters[DEFAULT_CHARACTER_ID]!;
    characterMesh.position.set(character.position.x, character.position.y, character.position.z);

    camera.position.set(character.position.x, character.position.y + 4, character.position.z + 8);
    camera.lookAt(
      character.position.x,
      character.position.y + CAPSULE_BOTTOM_OFFSET * 0.5,
      character.position.z,
    );

    renderer.render(scene, camera);
  };

  return {
    frame,
    dispose: () => {
      window.removeEventListener("resize", resize);
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
};
