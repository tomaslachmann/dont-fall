import { orientBox, quatToEuler, type Module, type Track } from "@dont-fall/shared";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { applySegmentTransform, boundingRadius, buildModuleGroup, disposeGroup } from "./render.js";
import {
  MOVE_STEP_FINE,
  ROTATE_STEP,
  ROTATE_STEP_FINE,
  segmentOverlapsAnyOther,
  snapPositionToNeighborSocket,
} from "./trackEdit.js";

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

/** The absolute transform an on-canvas gizmo drag commits (ticket 03) — see `trackEdit.ts`'s `setSegmentTransform`. */
export interface SegmentTransform {
  position: { x: number; y: number; z: number };
  rotation: number;
  pitch: number;
  roll: number;
}

export interface TrackViewport {
  setTrack: (modules: Record<string, Module>, track: Track) => void;
  /**
   * Re-applies every existing Segment group's position/orientation from
   * `track` without disposing/rebuilding any geometry (code review, ticket
   * 02) — for a move/rotate, which never adds, removes, or changes the
   * `moduleId` of any Segment, so the existing groups are still valid, just
   * out of place. `track` must be the same length, in the same Segment
   * order, as whatever `setTrack` last built — callers that change Segment
   * count or order must use `setTrack` instead.
   */
  retransformSegments: (track: Track) => void;
  /** Highlights Segment `index` (or clears the highlight if `undefined`) — also attaches/detaches the drag gizmo (ticket 03). */
  setSelected: (index: number | undefined) => void;
  /** Switches the gizmo between moving and rotating the selected Segment (ticket 03). No-op if nothing is selected. */
  setGizmoMode: (mode: "translate" | "rotate") => void;
  /**
   * Whether the pointer is currently over, or dragging, a gizmo handle
   * (ticket 03) — callers doing their own click-to-pick/deselect on the
   * canvas must skip it while this is true, or a click that starts/ends on
   * a gizmo handle would also be misread as "clicked empty space."
   */
  isGizmoActive: () => boolean;
  /** Raycasts from a mouse event's client coordinates; returns the Segment index hit, if any. */
  pick: (clientX: number, clientY: number) => number | undefined;
  render: () => void;
  dispose: () => void;
}

/** The whole-assembled-Track overview (ticket 04's second visual-preview requirement) — an orbit camera over every placed Segment, distinct from first-person placement. */
export const createTrackViewport = (
  container: HTMLElement,
  onSegmentTransformCommit: (index: number, transform: SegmentTransform) => void,
): TrackViewport => {
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

  const orbitControls = new OrbitControls(camera, renderer.domElement);
  orbitControls.enableDamping = true;

  let trackGroup = new THREE.Group();
  scene.add(trackGroup);

  const selectionBox = new THREE.BoxHelper(new THREE.Object3D(), SELECTION_COLOR);
  selectionBox.visible = false;
  scene.add(selectionBox);

  // Live overlap ghost-feedback (ticket 04) — a translucent box sized to the
  // dragged Segment's own Footprint (inflated by its clearance, via
  // `segmentOverlapsAnyOther`), coloured red while it overlaps any other
  // Segment's Footprint and green otherwise. A separate mesh rather than
  // recoloring the Segment's own materials, so nothing about the Segment's
  // actual geometry/materials needs saving and restoring around a drag.
  const OVERLAP_RED = 0xef4444;
  const OVERLAP_GREEN = 0x22c55e;
  const overlapGhostMaterial = new THREE.MeshBasicMaterial({
    color: OVERLAP_GREEN,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  });
  const overlapGhost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), overlapGhostMaterial);
  overlapGhost.visible = false;
  scene.add(overlapGhost);

  // On-canvas drag gizmo (ticket 03). `modules`/`track`/`attachedIndex` are
  // kept up to date by `setTrack`/`setSelected` so the live-drag Socket-snap
  // and the drag-end commit both have what they need without the caller
  // threading them through every call.
  const transformControls = new TransformControls(camera, renderer.domElement);
  scene.add(transformControls.getHelper());
  let modules: Record<string, Module> = {};
  let track: Track = [];
  let attachedIndex: number | undefined;
  let shiftHeld = false;

  const applySnapTiers = (): void => {
    // Position: the default tier is Socket-snap (custom logic below, on
    // every `objectChange`), not a uniform grid — so `translationSnap` stays
    // `null` unless Shift is held, when it becomes the native fine grid.
    transformControls.setTranslationSnap(shiftHeld ? MOVE_STEP_FINE : null);
    // Rotation: both tiers are plain grids — TransformControls' own snap
    // handles this natively either way.
    transformControls.setRotationSnap(shiftHeld ? ROTATE_STEP_FINE : ROTATE_STEP);
  };
  applySnapTiers();

  const onShiftDown = (e: KeyboardEvent): void => {
    if (e.key !== "Shift" || shiftHeld) return;
    shiftHeld = true;
    applySnapTiers();
  };
  const onShiftUp = (e: KeyboardEvent): void => {
    if (e.key !== "Shift") return;
    shiftHeld = false;
    applySnapTiers();
  };
  window.addEventListener("keydown", onShiftDown);
  window.addEventListener("keyup", onShiftUp);

  /** Moves/recolors `overlapGhost` to match the object currently attached to the gizmo, or hides it if there's nothing to show. */
  const updateOverlapGhost = (): void => {
    const object = transformControls.object;
    if (!object || attachedIndex === undefined) {
      overlapGhost.visible = false;
      return;
    }
    const segment = track[attachedIndex];
    const module = segment && modules[segment.moduleId];
    if (!module) {
      overlapGhost.visible = false;
      return;
    }
    const position = { x: object.position.x, y: object.position.y, z: object.position.z };
    const q = object.quaternion;
    const orientation = { x: q.x, y: q.y, z: q.z, w: q.w };
    const box = orientBox(module.footprint.bounds, position, orientation);
    overlapGhost.position.set(box.center.x, box.center.y, box.center.z);
    overlapGhost.quaternion.set(q.x, q.y, q.z, q.w);
    overlapGhost.scale.set(box.halfExtents.x * 2, box.halfExtents.y * 2, box.halfExtents.z * 2);
    const overlapping = segmentOverlapsAnyOther(track, modules, attachedIndex, position, orientation);
    overlapGhostMaterial.color.set(overlapping ? OVERLAP_RED : OVERLAP_GREEN);
    overlapGhost.visible = true;
  };

  // A drag must not also orbit the camera (standard TransformControls/
  // OrbitControls integration).
  transformControls.addEventListener("dragging-changed", (event) => {
    orbitControls.enabled = !event.value;
    if (event.value) {
      updateOverlapGhost(); // drag started — show the ghost even before the first move
      return;
    }

    // Drag ended — commit once (a single undo step), reading back whatever
    // the gizmo left the object at (already Socket-/grid-snapped live).
    overlapGhost.visible = false;
    const object = transformControls.object;
    if (!object || attachedIndex === undefined) return;
    const q = object.quaternion;
    const { yaw, pitch, roll } = quatToEuler({ x: q.x, y: q.y, z: q.z, w: q.w });
    onSegmentTransformCommit(attachedIndex, {
      position: { x: object.position.x, y: object.position.y, z: object.position.z },
      rotation: yaw,
      pitch,
      roll,
    });
  });

  // Live Socket-snap while translating (ticket 03) — TransformControls has
  // no concept of "snap to another object's socket," only uniform grids, so
  // this overrides the object's position on every drag update whenever the
  // fine grid tier (Shift) isn't active. Never touches rotation — Socket-
  // snap and rotate-snap are independent concerns.
  transformControls.addEventListener("objectChange", () => {
    if (transformControls.mode !== "translate" || shiftHeld || attachedIndex === undefined) return;
    const object = transformControls.object;
    if (!object) return;
    const snapped = snapPositionToNeighborSocket(track, modules, attachedIndex, {
      x: object.position.x,
      y: object.position.y,
      z: object.position.z,
    });
    object.position.set(snapped.x, snapped.y, snapped.z);
  });

  // Live overlap ghost-feedback (ticket 04) — runs after the Socket-snap
  // listener above so the ghost reflects the final, post-snap transform, on
  // both translate and rotate drags.
  transformControls.addEventListener("objectChange", () => {
    updateOverlapGhost();
  });

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
    setTrack(nextModules, nextTrack) {
      modules = nextModules;
      track = nextTrack;
      scene.remove(trackGroup);
      disposeGroup(trackGroup);
      trackGroup = new THREE.Group();
      nextTrack.forEach((segment, index) => {
        const module = nextModules[segment.moduleId];
        if (!module) return;
        const group = buildModuleGroup(module);
        applySegmentTransform(group, segment);
        group.userData.segmentIndex = index;
        trackGroup.add(group);
      });
      scene.add(trackGroup);
      if (nextTrack.length > 0) {
        const mid = nextTrack[Math.floor(nextTrack.length / 2)]!.position;
        orbitControls.target.set(mid.x, mid.y, mid.z);
      }
      selectionBox.visible = false;
    },
    retransformSegments(nextTrack) {
      track = nextTrack;
      for (const group of trackGroup.children) {
        const index = group.userData.segmentIndex as number | undefined;
        const segment = index !== undefined ? nextTrack[index] : undefined;
        if (segment) applySegmentTransform(group, segment);
      }
    },
    setSelected(index) {
      attachedIndex = index;
      if (index === undefined) {
        selectionBox.visible = false;
        transformControls.detach();
        return;
      }
      const group = trackGroup.children.find((c) => c.userData.segmentIndex === index);
      if (!group) {
        selectionBox.visible = false;
        transformControls.detach();
        return;
      }
      selectionBox.setFromObject(group);
      selectionBox.visible = true;
      transformControls.attach(group);
    },
    setGizmoMode(mode) {
      transformControls.setMode(mode);
    },
    isGizmoActive() {
      return transformControls.dragging || transformControls.axis !== null;
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
      orbitControls.update();
      renderer.render(scene, camera);
    },
    dispose() {
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", onShiftDown);
      window.removeEventListener("keyup", onShiftUp);
      disposeGroup(trackGroup);
      transformControls.dispose();
      orbitControls.dispose();
      overlapGhost.geometry.dispose();
      overlapGhostMaterial.dispose();
      renderer.dispose();
    },
  };
};
