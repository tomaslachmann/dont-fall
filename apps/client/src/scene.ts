import type { RenderState } from "@dont-fall/shared";
import * as THREE from "three";

const BACKGROUND_COLOR = 0x0b0e14;
/** Half the demo cube's height — its origin sits this far above the ground. */
const DEMO_HALF_HEIGHT = 0.5;

export interface Stage {
  /** Draw the current frame. */
  render: () => void;
  /** Push an interpolated sim state onto the scene. Presentation only (ADR 0004). */
  applyRenderState: (state: RenderState) => void;
}

/** Builds the Three.js stage: ground plane + grid, a demo cube, a fixed camera, lights. */
export const createStage = (): Stage => {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND_COLOR);
  scene.fog = new THREE.Fog(BACKGROUND_COLOR, 20, 80);

  const camera = new THREE.PerspectiveCamera(
    55,
    window.innerWidth / window.innerHeight,
    0.1,
    200,
  );
  camera.position.set(6, 6, 10);
  camera.lookAt(0, DEMO_HALF_HEIGHT, 0);

  scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x1b2430, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(8, 14, 6);
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    new THREE.MeshStandardMaterial({ color: 0x121826, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.001;
  scene.add(ground);
  scene.add(new THREE.GridHelper(60, 60, 0x2a3547, 0x18202e));

  const demo = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x4fd1c5, roughness: 0.4 }),
  );
  scene.add(demo);

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return {
    render: () => renderer.render(scene, camera),
    applyRenderState: (state) => {
      demo.position.set(
        state.demo.position.x,
        state.demo.position.y + DEMO_HALF_HEIGHT,
        state.demo.position.z,
      );
    },
  };
};
