import type { Module, Track } from "@dont-fall/shared";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { applySegmentTransform, boundingRadius, buildModuleGroup, disposeGroup } from "./render.js";

/**
 * A small, self-contained preview of one Module — the palette's "visual
 * preview of every Module" requirement (ticket 04). Framed automatically from
 * the Module's own bounding box, with a slow auto-rotate so the shape reads
 * as 3D even from a single still frame.
 */
export const createModulePreview = (canvas: HTMLCanvasElement, module: Module): (() => void) => {
  const width = canvas.width || canvas.clientWidth || 96;
  const height = canvas.height || canvas.clientHeight || 96;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setSize(width, height, false);

  const scene = new THREE.Scene();
  const group = buildModuleGroup(module);
  scene.add(group);
  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const dir = new THREE.DirectionalLight(0xffffff, 0.9);
  dir.position.set(3, 6, 4);
  scene.add(dir);

  const radius = boundingRadius(group);
  const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 200);
  camera.position.set(radius * 1.4, radius * 1.1, radius * 1.4);
  camera.lookAt(0, radius * 0.2, 0);

  let angle = 0;
  return () => {
    angle += 0.008;
    group.rotation.y = angle;
    renderer.render(scene, camera);
  };
};

const SELECTION_COLOR = 0xfacc15;

export interface TrackViewport {
  setTrack: (modules: Record<string, Module>, track: Track) => void;
  /** Highlights Segment `index` (or clears the highlight if `undefined`). */
  setSelected: (index: number | undefined) => void;
  /** Raycasts from a mouse event's client coordinates; returns the Segment index hit, if any. */
  pick: (clientX: number, clientY: number) => number | undefined;
  render: () => void;
  dispose: () => void;
}

/** The whole-assembled-Track overview (ticket 04's second visual-preview requirement) — an orbit camera over every placed Segment, distinct from first-person placement. */
export const createTrackViewport = (container: HTMLElement): TrackViewport => {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070b);
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dir = new THREE.DirectionalLight(0xffffff, 0.9);
  dir.position.set(10, 20, 10);
  scene.add(dir);
  scene.add(new THREE.GridHelper(200, 40, 0x2f3b4c, 0x1c2430));

  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2000);
  camera.position.set(10, 12, 20);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  let trackGroup = new THREE.Group();
  scene.add(trackGroup);

  const selectionBox = new THREE.BoxHelper(new THREE.Object3D(), SELECTION_COLOR);
  selectionBox.visible = false;
  scene.add(selectionBox);

  const raycaster = new THREE.Raycaster();

  const resize = (): void => {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener("resize", resize);
  resize();

  return {
    setTrack(modules, track) {
      scene.remove(trackGroup);
      disposeGroup(trackGroup);
      trackGroup = new THREE.Group();
      track.forEach((segment, index) => {
        const module = modules[segment.moduleId];
        if (!module) return;
        const group = buildModuleGroup(module);
        applySegmentTransform(group, segment);
        group.userData.segmentIndex = index;
        trackGroup.add(group);
      });
      scene.add(trackGroup);
      if (track.length > 0) {
        const mid = track[Math.floor(track.length / 2)]!.position;
        controls.target.set(mid.x, mid.y, mid.z);
      }
      selectionBox.visible = false;
    },
    setSelected(index) {
      if (index === undefined) {
        selectionBox.visible = false;
        return;
      }
      const group = trackGroup.children.find((c) => c.userData.segmentIndex === index);
      if (!group) {
        selectionBox.visible = false;
        return;
      }
      selectionBox.setFromObject(group);
      selectionBox.visible = true;
    },
    pick(clientX, clientY) {
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(trackGroup.children, true);
      for (const hit of hits) {
        let node: THREE.Object3D | null = hit.object;
        while (node) {
          if (typeof node.userData.segmentIndex === "number") return node.userData.segmentIndex;
          node = node.parent;
        }
      }
      return undefined;
    },
    render() {
      controls.update();
      renderer.render(scene, camera);
    },
    dispose() {
      window.removeEventListener("resize", resize);
      disposeGroup(trackGroup);
      controls.dispose();
      renderer.dispose();
    },
  };
};
