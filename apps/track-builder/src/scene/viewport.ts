import { createEnvironment, findSpinningParts, glintIce, simmerMud, spinParts, type Environment, type MudDeckPlacement } from "@dont-fall/render";
import {
  cloudFloorY,
  DEFAULT_KILL_PLANE_Y,
  motionPose,
  orientBox,
  scaleBox,
  segmentMotionOf,
  segmentScale,
  quatToEuler,
  TICK_DT,
  TICK_RATE_HZ,
  TRACK_THUMBNAIL_HEIGHT,
  TRACK_THUMBNAIL_WIDTH,
  type DeckPlan,
  type EnvironmentPreset,
  type Module,
  type MotionPose,
  type SegmentMotion,
  type Track,
  type Vec3,
} from "@dont-fall/shared";
import { footprintCorners, motionPath, OUTCOME_COLOURS } from "../motion/motionPreview.js";
import * as THREE from "three";
import { getNavMeshPositionsAndIndices } from "recast-navigation";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { addImpactTint, type ImpactTint } from "./impactTint.js";
import type { BotNavOverlay } from "../bot/buildBotNav.js";
import { createCourseOverlay } from "./courseOverlay.js";
import { COURSE } from "../lib/course.js";
import { lowestSegmentY } from "./environmentPreview.js";
import { launchArcOf } from "./launchArc.js";
import type { SchedulablePreview } from "./previewScheduler.js";
import {
  MOTION_NODE,
  SHARES_TEMPLATE_RESOURCES,
  meshBoundsIn,
  addConveyorBelt,
  addBounceOverlay,
  addIceOverlay,
  addMudOverlay,
  icePlacementOf,
  mudPlacementOf,
  applyMotionAt,
  beltSlatsOf,
  applySegmentTransform,
  refreshPartPlans,
  boundingRadius,
  buildSegmentGroup,
  disposeGroup,
} from "./render.js";
import {
  MOVE_STEP_FINE,
  ROTATE_STEP,
  ROTATE_STEP_FINE,
  SCALE_STEP,
  SCALE_STEP_FINE,
  segmentOverlapsAnyOther,
  snapScale,
  snapDragPosition,
  type SegmentTransform,
} from "../track/trackEdit.js";

export type { SegmentTransform };

/**
 * Lazily loaded deck-sheet textures (ADR 0066/0070) — each present once the
 * engine's load for it lands, absent before (or when its Surface never
 * appears on the Track, in which case it is never fetched at all).
 */
export interface SurfaceTextures {
  bounce?: THREE.Texture | undefined;
}

/**
 * The game's tone-mapping operator (ADR 0074; set in the client's
 * `createStage`). Both builder renderers draw straight to a canvas, so each
 * material tone-maps itself with it; a flat-colour `scene.background` is a
 * clear colour and is left as authored.
 */
const GAME_TONE_MAPPING = THREE.NeutralToneMapping;

/**
 * Shared offscreen thumbnail renderer — every palette preview rasterizes
 * through this ONE renderer instead of owning one each. Fifteen palette
 * entries plus four asset entries plus the main viewport needed 20 live
 * WebGL contexts against the browser's 16-context ceiling; past it the
 * browser kills contexts, which blanked the viewport canvas entirely (grid
 * included) the moment the Assets tab opened. One viewport plus one
 * thumbnail renderer is two contexts, forever.
 */
let thumbnailRenderer: THREE.WebGLRenderer | null = null;
let thumbnailCanvas: HTMLCanvasElement | null = null;

/**
 * A small, self-contained preview of one Module — the palette's "visual
 * preview of every Module" requirement (ticket 04). Framed automatically from
 * the Module's own bounding box, from a 3/4 camera so the shape reads as 3D
 * even from a single still frame; `spin` adds the slow auto-rotate.
 *
 * Implementation: a single WebGLRenderer can only ever draw into its own
 * canvas, so the shared renderer draws offscreen and each entry keeps a
 * plain 2D still. Nothing here decides when to draw — `PreviewScheduler`
 * does, because drawing every preview every frame is what made a large
 * asset set lag the whole builder.
 */
export const createModulePreview = (canvas: HTMLCanvasElement, module: Module, template?: THREE.Group): SchedulablePreview => {
  const target = canvas.getContext("2d");
  if (!target) throw new Error("module preview needs a fresh canvas (one already bound to WebGL cannot take a 2D copy)");
  if (!thumbnailRenderer || !thumbnailCanvas) {
    thumbnailCanvas = document.createElement("canvas");
    thumbnailCanvas.width = 96;
    thumbnailCanvas.height = 96;
    thumbnailRenderer = new THREE.WebGLRenderer({ canvas: thumbnailCanvas, antialias: true, alpha: true });
    thumbnailRenderer.toneMapping = GAME_TONE_MAPPING;
  }
  const renderer = thumbnailRenderer;
  const offscreen = thumbnailCanvas;
  const width = canvas.width || canvas.clientWidth || 96;
  const height = canvas.height || canvas.clientHeight || 96;

  const scene = new THREE.Scene();
  // An asset Module previews its authored visual (M8 ticket 05) — what the
  // author places is what the game plays — and nothing until its bytes land.
  const group = template ? template.clone(true) : new THREE.Group();
  scene.add(group);
  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const dir = new THREE.DirectionalLight(0xffffff, 0.9);
  dir.position.set(3, 6, 4);
  scene.add(dir);

  // Aimed at the shape's own centre, from far enough that its bounding
  // sphere fits the 40° view — a tall piece seated on y = 0 used to crop.
  const radius = boundingRadius(group);
  const center = new THREE.Box3().setFromObject(group).getCenter(new THREE.Vector3());
  if (!Number.isFinite(center.y)) center.set(0, 0, 0);
  const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, radius * 20 + 200);
  const distance = radius / Math.sin(THREE.MathUtils.degToRad(20));
  camera.position.copy(center).addScaledVector(new THREE.Vector3(1.4, 1.1, 1.4).normalize(), distance);
  camera.lookAt(center);

  const draw = (): void => {
    // `setSize` reassigns the canvas's width/height, which reallocates its
    // drawing buffer even at an unchanged size — only resize on a change.
    if (offscreen.width !== width || offscreen.height !== height) renderer.setSize(width, height, false);
    renderer.render(scene, camera);
    // The offscreen render has a transparent background, so drawing it over
    // the last frame without clearing smeared a spinning preview into a disc.
    target.clearRect(0, 0, width, height);
    target.drawImage(offscreen, 0, 0, width, height);
  };
  return {
    draw,
    spin() {
      group.rotation.y += 0.008;
      draw();
    },
  };
};

const SELECTION_COLOR = 0x7b3fe4;

/**
 * The NAVMESH overlay's own palette (M17 ticket 02) — the walkable mesh in a
 * cyan no other guide here uses, the route in white, and each leg's end
 * reusing the Course markers' own go/problem colours: green where a Bot's
 * path actually reaches its target, the same pink `COURSE.problem` already
 * means "nowhere to respawn" where it stops short.
 */
const BOT_NAV_MESH_COLOR = 0x22d3ee;
const BOT_NAV_PATH_COLOR = 0xffffff;
/** A proven link's arc (ticket 05): the mesh's cyan's opposite, so a jump reads as not-floor at a glance. */
const BOT_NAV_LINK_COLOR = 0xfacc15;
/** How far above a path's own corners its line and end marker float — clear of the floor's z-fighting, like the Course markers' `top + 0.03`. */
const BOT_NAV_LIFT = 0.05;

/**
 * The Thumbnail capture's JPEG quality (ADR 0085) — high enough that a
 * 1280×720 scene stays crisp as a Discover card and a full-page loader,
 * low enough to sit far under the API's size cap.
 */
const PREVIEW_JPEG_QUALITY = 0.85;

export interface TrackViewport {
  /**
   * Rebuilds the whole-Track overview. `assetTemplates` (M8 ticket 05) holds
   * the loaded visual template per asset Module id — placed asset Segments
   * render a clone each, everything else its boxes-and-markers group.
   * Optional and default-empty, so procedural-only callers pass nothing.
   * `surfaceTextures` (ADR 0066/0070) sheets icy/bouncy decks; each absent
   * until the engine's lazy load lands, in which case those decks render
   * unsheeted this sync. Mud needs no texture (ADR 0103). `deckPlans` (ADR
   * 0096) cuts sheets and mud to the asset's own shape; a missing plan keeps
   * the footprint rectangle.
   */
  setTrack: (
    modules: Record<string, Module>,
    track: Track,
    assetTemplates?: Record<string, THREE.Group>,
    surfaceTextures?: SurfaceTextures,
    deckPlans?: Record<string, DeckPlan | undefined>,
  ) => void;
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
  /**
   * Pose every Segment's Motion (ADR 0061) at simulation tick `tick`
   * (fractional) — the builder's clock, through the same `motionPose` the
   * simulation uses. The rest placement the gizmo edits never moves.
   */
  setMotionTime: (tick: number) => void;
  /**
   * Mark where Segment `index`'s Motion turns and slides (M11 ticket 06
   * follow-up): a dot at each pivot with a line along its axis (Spin orange,
   * Swing purple) and an arrow along a Slide. Drawn through geometry, riding
   * the Segment's rest placement. `undefined`, or a Segment with no Motion,
   * clears it.
   */
  showMotionGuide: (index: number | undefined) => void;
  /**
   * Draw where the selected Spring throws (ADR 0069) — its ballistic arc and
   * the apex it reaches, in world space — or clear it (`undefined`, or a
   * Segment that is not a Spring). Rebuilt on selection and on every height
   * edit, like the Motion guide.
   */
  showLaunchArc: (index: number | undefined) => void;
  /**
   * Draws the NAVMESH overlay (M17 ticket 02, ADR 0129): a translucent film
   * over the walkable mesh `recast-navigation` built, plus one line per leg
   * of the route a Bot would run — spawn → each Checkpoint's Respawn → the
   * Finish Zone — its end coloured by whether the leg actually reaches its
   * target. `null` clears it. `overlay` is built by the caller, from the
   * same `packages/shared` code the server runs — nothing here decides where
   * a Bot can walk, only how it's drawn.
   */
  setBotNav: (overlay: BotNavOverlay | null) => void;
  /** Show or hide the Impact tint on moving and Spiked Segments (M11 ticket 07). */
  setImpactTintVisible: (visible: boolean) => void;
  /**
   * Draws the Track inside `preset` (ADR 0074) in place of the lavender
   * authoring canvas, grid and lights, or `null` to put those back. The
   * Environment is the game's own, with its fog off (the orbit camera frames
   * whole Tracks from far outside the fog's distances) and no shadows.
   */
  setEnvironment: (preset: EnvironmentPreset | null) => void;
  /**
   * Aims the orbit camera at the middle of the current Track. `setTrack` does
   * this by itself only for a Track's first Segment — re-aiming on every
   * add/delete swung the whole view, which read as everything placed moving.
   */
  frameTrack: () => void;
  /**
   * Puts the orbit camera at `position`, looking at `target` — a framing written
   * down rather than dragged into place: an authored Track's Thumbnail
   * (ADR 0107, `thumbnail.html`). The orbit controls keep working from there.
   */
  setView: (view: { position: Vec3; target: Vec3; fov?: number }) => void;
  /**
   * Highlights every Segment in `indices` (or clears all highlights if
   * empty) — also attaches/detaches the drag gizmo (ticket 03). A single
   * index attaches the gizmo directly to that Segment; more than one
   * attaches it to a synthetic pivot so a drag/rotate moves the whole
   * selection together as a rigid group (ticket 05).
   */
  setSelected: (indices: number[]) => void;
  /** Switches the gizmo between moving and rotating the selected Segment (ticket 03). No-op if nothing is selected. */
  setGizmoMode: (mode: "translate" | "rotate" | "scale") => void;
  /**
   * Whether the pointer is currently over, or dragging, a gizmo handle
   * (ticket 03) — callers doing their own click-to-pick/deselect on the
   * canvas must skip it while this is true, or a click that starts/ends on
   * a gizmo handle would also be misread as "clicked empty space."
   */
  isGizmoActive: () => boolean;
  /**
   * The centre of the part of Segment `index` under the pointer, in that
   * Segment's own rest frame — where a Spin or Swing picked "on the model"
   * turns about (M11 ticket 06 follow-up). `undefined` when the click misses it.
   */
  pickPartPivot: (clientX: number, clientY: number, index: number) => { x: number; y: number; z: number } | undefined;
  /** Raycasts from a mouse event's client coordinates; returns the Segment index hit, if any. */
  pick: (clientX: number, clientY: number) => number | undefined;
  /**
   * The spot on a still Segment's surface under the pointer (world) — where a
   * Checkpoint's Respawn is being picked to stand (ADR 0068).
   */
  pickFloor: (clientX: number, clientY: number) => { index: number; point: { x: number; y: number; z: number } } | undefined;
  /**
   * Where Checkpoint `index`'s Respawn stands as drawn (world) — its picked
   * spot, or the floor found under its opening; `floor` absent when there is
   * none. `undefined` off a Checkpoint.
   */
  respawnOf: (index: number) => { floor: { x: number; y: number; z: number } | undefined } | undefined;
  /** Shows or hides the course markers (ADR 0068) — hidden while the Thumbnail capture frames the bare Track. */
  setCourseVisible: (visible: boolean) => void;
  /**
   * Captures the current view as this Track's Thumbnail (ADR 0085) — a
   * 1280×720 JPEG data URL at the shared frame, whatever the window's own
   * size. Renders synchronously and reads the canvas back in the same task
   * (no `preserveDrawingBuffer` needed that way), then restores the
   * container's own size. `undefined` when the canvas won't give its pixels
   * up (a tainted canvas throws) — the caller stays in capture mode and says
   * so, rather than saving a Revision with no screenshot.
   *
   * Captures exactly what's drawn: the engine's capture mode clears the
   * selection, the guides and the course markers before this ever runs, so
   * this hides nothing itself.
   */
  capturePreview: () => string | undefined;
  /**
   * Re-fits the renderer to its container — the capture-mode swap (ADR 0085)
   * resizes the canvas box with no window resize, so the shell asks for this
   * after the layout lands (the window listener never fires for it).
   */
  resize: () => void;
  render: () => void;
  dispose: () => void;
}

/** The whole-assembled-Track overview (ticket 04's second visual-preview requirement) — an orbit camera over every placed Segment, distinct from first-person placement. */
export const createTrackViewport = (
  container: HTMLElement,
  onSegmentTransformCommit: (updates: { index: number; transform: SegmentTransform }[]) => void,
): TrackViewport => {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.toneMapping = GAME_TONE_MAPPING;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  // The authoring view (ADR 0063): the default, and what an Environment preview hides.
  const authoringBackground = new THREE.Color(0xefe9fa);
  scene.background = authoringBackground;
  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambient);
  const dir = new THREE.DirectionalLight(0xffffff, 0.9);
  dir.position.set(10, 20, 10);
  scene.add(dir);
  const grid = new THREE.GridHelper(200, 40, 0xb79ced, 0xd9cff2);
  scene.add(grid);

  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2000);
  camera.position.set(10, 12, 20);

  const orbitControls = new OrbitControls(camera, renderer.domElement);
  orbitControls.enableDamping = true;

  let trackGroup = new THREE.Group();
  scene.add(trackGroup);

  // The Environment preview (ADR 0074). Its cloud floor is placed once, under
  // the Track as it stood; an edit that moves the Track's lowest point far
  // enough to move the floor rebuilds it (a bake and a few buffers — rare,
  // since the floor only follows a Track reaching down near the kill height).
  let environmentPreset: EnvironmentPreset | null = null;
  let environment: { drawn: Environment; floorY: number } | undefined;
  const showEnvironment = (): void => {
    environment?.drawn.dispose();
    environment = undefined;
    const authoring = environmentPreset === null;
    scene.background = authoring ? authoringBackground : null;
    ambient.visible = authoring;
    dir.visible = authoring;
    grid.visible = authoring;
    if (!environmentPreset) return;
    const lowest = lowestSegmentY(trackGroup.children, track);
    environment = {
      drawn: createEnvironment(scene, renderer, environmentPreset, {
        killPlaneY: DEFAULT_KILL_PLANE_Y,
        lowestSegmentY: lowest,
        fog: false,
        detail: "full",
        // The shadow box covers 70 units around one focus, a fraction of a
        // Track framed whole, so shadows would end mid-Track; the playtest
        // shows the real ones.
        shadows: false,
      }),
      floorY: cloudFloorY(environmentPreset, DEFAULT_KILL_PLANE_Y, lowest),
    };
  };
  const followTrackWithEnvironment = (): void => {
    if (!environmentPreset || !environment) return;
    const floorY = cloudFloorY(environmentPreset, DEFAULT_KILL_PLANE_Y, lowestSegmentY(trackGroup.children, track));
    if (floorY !== environment.floorY) showEnvironment();
  };

  // One BoxHelper per selected Segment (ticket 05 — a single-Segment
  // selection is just the length-1 case of this).
  let selectionBoxes: THREE.BoxHelper[] = [];
  const clearSelectionBoxes = (): void => {
    for (const box of selectionBoxes) {
      scene.remove(box);
      box.dispose();
    }
    selectionBoxes = [];
  };

  // A synthetic, invisible pivot the gizmo attaches to for a multi-Segment
  // selection (ticket 05) — TransformControls can only ever drive one
  // Object3D, so a rigid-group drag/rotate needs something to drive that
  // isn't any one of the selected Segments themselves. Positioned at
  // whichever Segment is first in the selection each time `setSelected` is
  // called; every selected Segment's transform *relative* to the pivot is
  // recorded in `multiOffsets` at that moment, then reproduced live as the
  // pivot moves.
  const pivotObject = new THREE.Object3D();
  scene.add(pivotObject);
  const multiOffsets = new Map<number, { position: THREE.Vector3; quaternion: THREE.Quaternion }>();

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

  // On-canvas drag gizmo (ticket 03). `modules`/`track`/`attachedIndices` are
  // kept up to date by `setTrack`/`setSelected` so the live-drag Socket-snap
  // and the drag-end commit both have what they need without the caller
  // threading them through every call.
  const transformControls = new TransformControls(camera, renderer.domElement);
  scene.add(transformControls.getHelper());
  let modules: Record<string, Module> = {};
  let track: Track = [];
  let attachedIndices: number[] = [];
  let motionTick = 0;
  let impactTintVisible = true;
  // One per moving or Spiked Segment, rebuilt with the Track; index-keyed so a
  // transform-only edit (which swaps `track` but keeps the groups) still
  // reads the Segment's current Motion.
  let tints: { index: number; tint: ImpactTint; motion?: SegmentMotion }[] = [];
  /** Conveyor march drivers (ADR 0064) — rebuilt with the Track, ticked with the motion clock. */
  let belts: ((tick: number) => void)[] = [];

  // The Motion guide lives in the scene, not under the Segment's group — a
  // child there would stretch the selection box — and follows the group's
  // world matrix every frame instead.
  let motionGuide: { object: THREE.Group; index: number; ownMaterials: THREE.Material[] } | undefined;
  // The launch arc is world-space from the start (it is where a Character
  // flies, not part of the piece), so unlike the Motion guide it follows no
  // group matrix — it is rebuilt whenever the Spring moves or is retuned.
  let launchArcObject: { object: THREE.Group; ownMaterials: THREE.Material[] } | undefined;
  const clearLaunchArc = (): void => {
    if (!launchArcObject) return;
    scene.remove(launchArcObject.object);
    disposeGroup(launchArcObject.object);
    for (const material of launchArcObject.ownMaterials) material.dispose();
    launchArcObject = undefined;
  };
  const clearMotionGuide = (): void => {
    if (!motionGuide) return;
    scene.remove(motionGuide.object);
    disposeGroup(motionGuide.object);
    for (const material of motionGuide.ownMaterials) material.dispose();
    motionGuide = undefined;
  };
  // The NAVMESH overlay (M17 ticket 02) — world-space from the start, like
  // the launch arc, and rebuilt whole on every `setBotNav` (the engine
  // debounces the navmesh regeneration behind it; this side just redraws).
  let botNavObject: { object: THREE.Group; ownMaterials: THREE.Material[] } | undefined;
  const clearBotNav = (): void => {
    if (!botNavObject) return;
    scene.remove(botNavObject.object);
    disposeGroup(botNavObject.object);
    for (const material of botNavObject.ownMaterials) material.dispose();
    botNavObject = undefined;
  };

  /**
   * A see-through copy of the Segment's piece posed at `pose` (its rest frame)
   * — where a Swing or Slide reaches at its ends. Shares every geometry with
   * the live piece, so it is flagged like an asset clone and only its one
   * material is its own to free.
   */
  const ghostOf = (index: number, pose: MotionPose, material: THREE.Material): THREE.Object3D | undefined => {
    const motionNode = findGroup(index)?.userData[MOTION_NODE] as THREE.Object3D | undefined;
    if (!motionNode) return undefined;
    const ghost = motionNode.clone(true);
    const overlays: THREE.Object3D[] = [];
    ghost.traverse((node) => {
      if (node.userData.impactTint) overlays.push(node);
      else if ((node as THREE.Mesh).isMesh) (node as THREE.Mesh).material = material;
    });
    for (const overlay of overlays) overlay.parent?.remove(overlay);
    ghost.userData[SHARES_TEMPLATE_RESOURCES] = true;
    ghost.position.set(pose.position.x, pose.position.y, pose.position.z);
    ghost.quaternion.set(pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.w);
    return ghost;
  };
  const guideMaterial = (color: number): THREE.MeshBasicMaterial =>
    new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 });
  const followMotionGuide = (): void => {
    if (!motionGuide) return;
    const group = findGroup(motionGuide.index);
    if (!group) return;
    group.updateWorldMatrix(true, false);
    motionGuide.object.matrix.copy(group.matrixWorld);
  };
  let shiftHeld = false;

  // Rebuilt by `setTrack` alongside `trackGroup` — an O(1) lookup for the
  // gizmo/selection code below, which (since ticket 05's multi-select) can
  // call this once per selected Segment on every drag-update frame.
  let groupByIndex = new Map<number, THREE.Object3D>();
  const findGroup = (index: number): THREE.Object3D | undefined => groupByIndex.get(index);

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

  /**
   * Moves/recolors `overlapGhost` to match the Segment currently attached to
   * the gizmo, or hides it if there's nothing to show. Single-Segment only
   * (ticket 05 doesn't ask for group-wide overlap feedback, and
   * `segmentOverlapsAnyOther` is itself a single-Segment primitive) — hidden
   * whenever more than one Segment is selected.
   */
  const updateOverlapGhost = (): void => {
    if (attachedIndices.length !== 1) {
      overlapGhost.visible = false;
      return;
    }
    const index = attachedIndices[0]!;
    const object = transformControls.object;
    const segment = track[index];
    const module = segment && modules[segment.moduleId];
    if (!object || !module) {
      overlapGhost.visible = false;
      return;
    }
    const position = { x: object.position.x, y: object.position.y, z: object.position.z };
    const q = object.quaternion;
    const orientation = { x: q.x, y: q.y, z: q.z, w: q.w };
    const scale = object.scale.x;
    const box = orientBox(scaleBox(module.footprint.bounds, scale), position, orientation);
    overlapGhost.position.set(box.center.x, box.center.y, box.center.z);
    overlapGhost.quaternion.set(q.x, q.y, q.z, q.w);
    overlapGhost.scale.set(box.halfExtents.x * 2, box.halfExtents.y * 2, box.halfExtents.z * 2);
    const overlapping = segmentOverlapsAnyOther(track, modules, index, position, orientation, scale);
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

    // Drag ended — commit once per selected Segment (still a single undo
    // step, via one `history.apply` in main.ts), reading back whatever the
    // gizmo/pivot propagation left each one at (already Socket-/grid-snapped
    // live for a single-Segment drag; the multi-select path below keeps
    // every Segment's own group already up to date on every `objectChange`,
    // so reading them here is exactly the same shape either way).
    overlapGhost.visible = false;
    if (attachedIndices.length === 0) return;
    const updates: { index: number; transform: SegmentTransform }[] = [];
    for (const index of attachedIndices) {
      const group = findGroup(index);
      if (!group) continue;
      const q = group.quaternion;
      const { yaw, pitch, roll } = quatToEuler({ x: q.x, y: q.y, z: q.z, w: q.w });
      updates.push({
        index,
        transform: {
          position: { x: group.position.x, y: group.position.y, z: group.position.z },
          rotation: yaw,
          pitch,
          roll,
          scale: group.scale.x,
        },
      });
    }
    if (updates.length > 0) onSegmentTransformCommit(updates);
  });

  // Live snap while translating (ticket 03) — Socket-snap, then flush
  // against other Segments' faces, then the grid (`snapDragPosition`).
  // TransformControls only knows uniform grids, so this overrides the
  // object's position on every drag update whenever the fine grid tier
  // (Shift) isn't active; it recomputes from the drag start each time, so
  // nothing accumulates. Only the dragged handle's axes are snapped. Never
  // touches rotation. Single-Segment only — a multi-select would have to
  // pick which selected Segment to snap, which no ticket asks for.
  transformControls.addEventListener("objectChange", () => {
    if (transformControls.mode !== "translate" || shiftHeld || attachedIndices.length !== 1) return;
    const object = transformControls.object;
    if (!object) return;
    const handle = transformControls.axis ?? "";
    const snapped = snapDragPosition(
      track,
      modules,
      attachedIndices[0]!,
      { x: object.position.x, y: object.position.y, z: object.position.z },
      { x: handle.includes("X"), y: handle.includes("Y"), z: handle.includes("Z") },
    );
    object.position.set(snapped.x, snapped.y, snapped.z);
  });

  // Rigid-group propagation for a multi-Segment selection (ticket 05) — the
  // gizmo drives `pivotObject` only; every other selected Segment's group is
  // repositioned/reoriented here on each drag update, from its transform
  // *relative* to the pivot recorded by `setSelected` when the selection was
  // made, so the whole group moves/rotates together preserving offsets.
  transformControls.addEventListener("objectChange", () => {
    if (transformControls.object !== pivotObject) return;
    for (const [index, offset] of multiOffsets) {
      const group = findGroup(index);
      if (!group) continue;
      group.quaternion.copy(pivotObject.quaternion).multiply(offset.quaternion);
      group.position.copy(offset.position).applyQuaternion(pivotObject.quaternion).add(pivotObject.position);
    }
  });

  // Scale gizmo (ADR 0062): whichever handle is dragged, the piece scales
  // uniformly — the dragged axis (or the centre handle's average) decides —
  // snapped to SCALE_STEP (Shift: SCALE_STEP_FINE) and held inside the stored
  // bounds. Registered before the overlap ghost below, so the ghost reads the
  // snapped scale. A multi-selection's pivot never scales: a rigid group has
  // no single scale to commit.
  transformControls.addEventListener("objectChange", () => {
    if (transformControls.mode !== "scale") return;
    const object = transformControls.object;
    if (!object) return;
    if (object === pivotObject) {
      object.scale.setScalar(1);
      return;
    }
    const handle = transformControls.axis ?? "XYZ";
    const s = object.scale;
    const raw = handle === "X" ? s.x : handle === "Y" ? s.y : handle === "Z" ? s.z : (s.x + s.y + s.z) / 3;
    object.scale.setScalar(snapScale(raw, shiftHeld ? SCALE_STEP_FINE : SCALE_STEP));
  });

  // Live overlap ghost-feedback (ticket 04) — runs after the Socket-snap/
  // multi-select propagation listeners above so the ghost reflects the
  // final, post-snap transform, on both translate and rotate drags.
  transformControls.addEventListener("objectChange", () => {
    updateOverlapGhost();
  });

  const raycaster = new THREE.Raycaster();
  /** Start, Checkpoints and finishes, drawn over the Track (ADR 0068). */
  const course = createCourseOverlay(scene);
  const rayFrom = (clientX: number, clientY: number): THREE.Raycaster => {
    const rect = renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(
      new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1),
      camera,
    );
    return raycaster;
  };

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
    setTrack(nextModules, nextTrack, assetTemplates = {}, surfaceTextures = {}, deckPlans = {}) {
      const wasEmpty = track.length === 0;
      modules = nextModules;
      track = nextTrack;
      scene.remove(trackGroup);
      disposeGroup(trackGroup);
      for (const { tint } of tints) tint.dispose();
      tints = [];
      belts = [];
      trackGroup = new THREE.Group();
      groupByIndex = new Map();
      // Every mud deck first: a deck's mud runs on across a seam into a
      // neighbour, so each one is built knowing all the others (ADR 0103).
      const mudPlacements = new Map<number, MudDeckPlacement>();
      const icePlacements = new Map<number, MudDeckPlacement>();
      nextTrack.forEach((segment, index) => {
        const module = nextModules[segment.moduleId];
        const placement = module && mudPlacementOf(segment, module, assetTemplates[segment.moduleId], deckPlans[segment.moduleId]);
        if (placement) mudPlacements.set(index, placement);
        const ice = module && icePlacementOf(segment, module, assetTemplates[segment.moduleId], deckPlans[segment.moduleId]);
        if (ice) icePlacements.set(index, ice);
      });
      const allMud = [...mudPlacements.values()];
      const allIce = [...icePlacements.values()];
      nextTrack.forEach((segment, index) => {
        const group = buildSegmentGroup(nextModules, segment, assetTemplates);
        if (!group) return;
        group.userData.segmentIndex = index;
        const module = nextModules[segment.moduleId];
        // What actually moves (ADR 0116): the Segment's own Motion, or the one
        // its Asset's Part runs. An Asset that moves only a Part of itself is
        // tinted on that Part alone — its base hits nobody.
        const motion = module ? segmentMotionOf(segment, module) : undefined;
        if (motion !== undefined || module?.hazard === "spiked") {
          const tinted = segment.motion === undefined && motion !== undefined ? (group.userData[MOTION_NODE] as THREE.Object3D) : group;
          const tint = addImpactTint(tinted, module?.hazard === "spiked");
          tint.update(segment, motionTick, motion);
          tints.push({ index, tint, ...(motion === undefined ? {} : { motion }) });
        }
        if (module) {
          // A belt's strip parents under the Motion node (ADR 0064) so it
          // follows its carrier; its march driver runs off the same
          // motion-preview clock as the tint updates below.
          const motionNode = group.userData[MOTION_NODE] as THREE.Group;
          const belt = addConveyorBelt(motionNode, segment, module, assetTemplates[segment.moduleId]);
          if (belt) {
            belt(motionTick);
            belts.push(belt);
          }
          // A conveyor Asset runs its own slats instead (ADR 0120), on the
          // same preview clock the chevrons march on.
          const slats = beltSlatsOf(group, segment, module);
          if (slats) {
            slats.update(motionTick * TICK_DT);
            belts.push((tick) => slats.update(tick * TICK_DT));
          }
          // An icy deck's slab (ADR 0066, drawn per ADR 0107) — same
          // Motion-node parenting as the belt, so it follows a carrier too.
          addIceOverlay(motionNode, segment, module, assetTemplates[segment.moduleId], icePlacements.get(index), allIce);
          // A muddy deck's mass (ADR 0067/0103) — same parenting as the ice
          // sheet above; still, since nobody wades through the preview.
          addMudOverlay(motionNode, segment, module, assetTemplates[segment.moduleId], mudPlacements.get(index), allMud);
          // A bouncy deck's inflatable sheet (ADR 0070), at rest — the
          // builder has nobody standing on it to dent it.
          addBounceOverlay(
            motionNode,
            segment,
            module,
            assetTemplates[segment.moduleId],
            surfaceTextures.bounce,
            renderer.capabilities.getMaxAnisotropy(),
            deckPlans[segment.moduleId],
          );
        }
        applyMotionAt(group, segment, motionTick);
        trackGroup.add(group);
        groupByIndex.set(index, group);
      });
      scene.add(trackGroup);
      followTrackWithEnvironment();
      if (!impactTintVisible) this.setImpactTintVisible(false);
      if (wasEmpty) this.frameTrack();
      clearSelectionBoxes();
      course.rebuild(nextTrack, nextModules, groupByIndex);
    },
    showMotionGuide(index) {
      clearMotionGuide();
      const segment = index !== undefined ? track[index] : undefined;
      const module = segment ? modules[segment.moduleId] : undefined;
      if (index === undefined || !segment?.motion || !module || !findGroup(index)) return;
      const h = module.footprint.bounds.halfExtents;
      const reach = Math.max(h.x, h.y, h.z) + 1;
      const object = new THREE.Group();
      object.matrixAutoUpdate = false;
      object.renderOrder = 999;
      const ownMaterials: THREE.Material[] = [];

      // Where it goes (research: Dreams' animation path): the fastest corner's
      // track over one cycle, coloured by the Impact it would deal there.
      const path = motionPath(segment.motion, footprintCorners(module), 120, segmentScale(segment));
      const pathGeometry = new THREE.BufferGeometry().setFromPoints(path.points.map((p) => new THREE.Vector3(p.x, p.y, p.z)));
      const colours = new Float32Array(path.outcomes.length * 3);
      path.outcomes.forEach((outcome, i) => new THREE.Color(OUTCOME_COLOURS[outcome]).toArray(colours, i * 3));
      pathGeometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
      const pathLine = new THREE.Line(
        pathGeometry,
        new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.95 }),
      );
      pathLine.renderOrder = 999;
      object.add(pathLine);

      // How far it goes: see-through copies at a Swing's two extremes and a Slide's far end.
      // Brand purple, not white — the canvas is light now, white ghosts would vanish into it.
      const ghostMaterial = new THREE.MeshBasicMaterial({ color: 0x7b3fe4, transparent: true, opacity: 0.18, depthWrite: false });
      ownMaterials.push(ghostMaterial);
      const ends: MotionPose[] = [];
      const swing = segment.motion.swing;
      if (swing) {
        const travelTicks = ((swing.period - 2 * (swing.pause ?? 0)) / 2) * TICK_RATE_HZ;
        const alone = { swing: { ...swing, phase: 0 } };
        ends.push(motionPose(alone, 0), motionPose(alone, travelTicks));
      }
      const slideEnd = segment.motion.slide;
      if (slideEnd) ends.push({ position: { ...slideEnd.offset }, rotation: { x: 0, y: 0, z: 0, w: 1 } });
      for (const end of ends) {
        const ghost = ghostOf(index, end, ghostMaterial);
        if (ghost) object.add(ghost);
      }
      const pivotAndAxis = (pivot: { x: number; y: number; z: number }, axis: { x: number; y: number; z: number }, color: number): void => {
        const dot = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 12), guideMaterial(color));
        dot.position.set(pivot.x, pivot.y, pivot.z);
        dot.renderOrder = 999;
        object.add(dot);
        const direction = new THREE.Vector3(axis.x, axis.y, axis.z).normalize();
        const line = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, reach * 2, 8), guideMaterial(color));
        line.position.set(pivot.x, pivot.y, pivot.z);
        line.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
        line.renderOrder = 999;
        object.add(line);
      };
      if (segment.motion.spin) pivotAndAxis(segment.motion.spin.pivot, segment.motion.spin.axis, 0xf97316);
      if (segment.motion.swing) pivotAndAxis(segment.motion.swing.pivot, segment.motion.swing.axis, 0xa855f7);
      const slide = segment.motion.slide;
      const length = slide ? Math.hypot(slide.offset.x, slide.offset.y, slide.offset.z) : 0;
      if (slide && length > 0) {
        const c = module.footprint.bounds.center;
        const arrow = new THREE.ArrowHelper(
          new THREE.Vector3(slide.offset.x, slide.offset.y, slide.offset.z).normalize(),
          new THREE.Vector3(c.x, c.y, c.z),
          length,
          0x38bdf8,
          Math.min(0.6, length * 0.3),
          Math.min(0.35, length * 0.2),
        );
        arrow.traverse((node) => {
          const drawable = node as THREE.Mesh;
          if (drawable.material) (drawable.material as THREE.Material).depthTest = false;
          node.renderOrder = 999;
        });
        object.add(arrow);
      }
      scene.add(object);
      motionGuide = { object, index, ownMaterials };
      followMotionGuide();
    },
    showLaunchArc(index) {
      clearLaunchArc();
      const segment = index !== undefined ? track[index] : undefined;
      const def = segment ? modules[segment.moduleId]?.launch : undefined;
      if (!segment || !def) return;

      const arc = launchArcOf(segment, def);
      const object = new THREE.Group();
      object.renderOrder = 999;
      const material = new THREE.LineDashedMaterial({
        color: 0x38bdf8,
        dashSize: 0.5,
        gapSize: 0.3,
        depthTest: false,
        transparent: true,
        opacity: 0.95,
      });
      const geometry = new THREE.BufferGeometry().setFromPoints(
        arc.points.map((p) => new THREE.Vector3(p.x, p.y, p.z)),
      );
      const line = new THREE.Line(geometry, material);
      line.computeLineDistances(); // dashes need them, and they are never free
      line.renderOrder = 999;
      object.add(line);

      // The apex: the one number the author is judging, marked where it lands.
      const apexMaterial = new THREE.MeshBasicMaterial({ color: 0x38bdf8, depthTest: false, transparent: true, opacity: 0.9 });
      const apex = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), apexMaterial);
      apex.position.set(arc.apex.x, arc.apex.y, arc.apex.z);
      apex.renderOrder = 999;
      object.add(apex);

      scene.add(object);
      launchArcObject = { object, ownMaterials: [material, apexMaterial] };
    },
    setBotNav(overlay) {
      clearBotNav();
      if (!overlay) return;
      const object = new THREE.Group();
      const ownMaterials: THREE.Material[] = [];

      // The walkable mesh itself — Recast's own triangulation, straight from
      // the library (ticket 01), so this draws exactly what a Bot can stand
      // on rather than a builder-only guess at it.
      const [positions, indices] = getNavMeshPositionsAndIndices(overlay.navMesh);
      if (indices.length > 0) {
        const meshGeometry = new THREE.BufferGeometry();
        meshGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        meshGeometry.setIndex(indices);
        const meshMaterial = new THREE.MeshBasicMaterial({
          color: BOT_NAV_MESH_COLOR,
          transparent: true,
          opacity: 0.32,
          depthWrite: false,
          side: THREE.DoubleSide,
          // The mesh sits coplanar with the Track's own decks — offset its
          // depth, not its position (a ramp's mesh isn't flat), so it never
          // flickers against the floor it's drawn over.
          polygonOffset: true,
          polygonOffsetFactor: -4,
          polygonOffsetUnits: -4,
        });
        ownMaterials.push(meshMaterial);
        const mesh = new THREE.Mesh(meshGeometry, meshMaterial);
        mesh.renderOrder = 900;
        object.add(mesh);
      }

      // One line per leg of the route a Bot would run, its end a dot: go-green
      // where the path reaches its target, the Course markers' own "problem"
      // pink where it stops short (a gap no proven link crosses).
      const lineMaterial = new THREE.LineBasicMaterial({ color: BOT_NAV_PATH_COLOR, depthTest: false, transparent: true, opacity: 0.9 });
      const reachedMaterial = new THREE.MeshBasicMaterial({ color: COURSE.start.hex, depthTest: false, transparent: true, opacity: 0.95 });
      const shortMaterial = new THREE.MeshBasicMaterial({ color: COURSE.problem.hex, depthTest: false, transparent: true, opacity: 0.95 });
      ownMaterials.push(lineMaterial, reachedMaterial, shortMaterial);
      for (const leg of overlay.legs) {
        const lifted = leg.points.map((p) => new THREE.Vector3(p.x, p.y + BOT_NAV_LIFT, p.z));
        if (lifted.length >= 2) {
          const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(lifted), lineMaterial);
          line.renderOrder = 999;
          object.add(line);
        }
        // Marked even with no path at all (`points` is just `from`) — a
        // query that joins nothing is the shortest possible "stops short".
        const marker = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), leg.complete ? reachedMaterial : shortMaterial);
        marker.position.copy(lifted[lifted.length - 1]!);
        marker.renderOrder = 999;
        object.add(marker);
      }

      // Each proven link (ticket 05) as an arc from where its run-up starts to
      // where its proof landed, raised over the higher end so a drop and a
      // climb both read as a jump. Only the ends are real: the arc is a sketch.
      const linkMaterial = new THREE.LineBasicMaterial({ color: BOT_NAV_LINK_COLOR, depthTest: false, transparent: true, opacity: 0.9 });
      ownMaterials.push(linkMaterial);
      for (const link of overlay.links) {
        const from = new THREE.Vector3(link.from.x, link.from.y + BOT_NAV_LIFT, link.from.z);
        const to = new THREE.Vector3(link.to.x, link.to.y + BOT_NAV_LIFT, link.to.z);
        const control = from.clone().add(to).multiplyScalar(0.5);
        control.y = Math.max(from.y, to.y) + Math.max(1, 0.25 * Math.hypot(to.x - from.x, to.z - from.z));
        const arc = new THREE.Line(new THREE.BufferGeometry().setFromPoints(new THREE.QuadraticBezierCurve3(from, control, to).getPoints(16)), linkMaterial);
        arc.renderOrder = 999;
        object.add(arc);
      }

      scene.add(object);
      botNavObject = { object, ownMaterials };
    },
    setEnvironment(preset) {
      environmentPreset = preset;
      showEnvironment();
    },
    setImpactTintVisible(visible) {
      impactTintVisible = visible;
      trackGroup.traverse((object) => {
        if (object.userData.impactTint) object.visible = visible;
      });
    },
    setMotionTime(tick) {
      motionTick = tick;
      for (const belt of belts) belt(tick);
      if (impactTintVisible) {
        for (const { index, tint, motion } of tints) {
          const segment = track[index];
          if (segment) tint.update(segment, tick, motion);
        }
      }
      for (const group of trackGroup.children) {
        const index = group.userData.segmentIndex as number | undefined;
        const segment = index !== undefined ? track[index] : undefined;
        if (segment) applyMotionAt(group, segment, tick);
      }
      for (const box of selectionBoxes) box.update();
      followMotionGuide();
    },
    setView({ position, target, fov }) {
      camera.position.set(position.x, position.y, position.z);
      orbitControls.target.set(target.x, target.y, target.z);
      if (fov !== undefined) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
      orbitControls.update();
    },
    frameTrack() {
      if (track.length === 0) return;
      const mid = track[Math.floor(track.length / 2)]!.position;
      orbitControls.target.set(mid.x, mid.y, mid.z);
    },
    retransformSegments(nextTrack) {
      track = nextTrack;
      for (const group of trackGroup.children) {
        const index = group.userData.segmentIndex as number | undefined;
        const segment = index !== undefined ? nextTrack[index] : undefined;
        if (!segment) continue;
        applySegmentTransform(group, segment);
        // A Motion edit arrives here too: what poses each Part, and the Motion
        // its Impact tint reads, follow it without a rebuild.
        const module = modules[segment.moduleId];
        if (!module) continue;
        refreshPartPlans(group, segment, module);
        const tint = tints.find((entry) => entry.index === index);
        if (tint) {
          const motion = segmentMotionOf(segment, module);
          if (motion === undefined) delete tint.motion;
          else tint.motion = motion;
        }
      }
      // Respawn floors are found under where the gates now stand.
      course.rebuild(nextTrack, modules, groupByIndex);
      followTrackWithEnvironment();
    },
    setSelected(indices) {
      attachedIndices = [...indices];

      clearSelectionBoxes();
      selectionBoxes = attachedIndices
        .map((index) => findGroup(index))
        .filter((group): group is THREE.Object3D => group !== undefined)
        .map((group) => {
          const box = new THREE.BoxHelper(group, SELECTION_COLOR);
          scene.add(box);
          return box;
        });

      if (attachedIndices.length === 0) {
        transformControls.detach();
        return;
      }

      if (attachedIndices.length === 1) {
        const group = findGroup(attachedIndices[0]!);
        if (group) transformControls.attach(group);
        else transformControls.detach();
        return;
      }

      // Multi-select: anchor the pivot at the first selected Segment's
      // current transform, and record every selected Segment's transform
      // relative to it — the rigid-group offsets the `objectChange`
      // propagation listener above reproduces on every drag update.
      const anchorGroup = findGroup(attachedIndices[0]!);
      if (!anchorGroup) {
        transformControls.detach();
        return;
      }
      pivotObject.position.copy(anchorGroup.position);
      pivotObject.quaternion.copy(anchorGroup.quaternion);
      const invPivotQuat = pivotObject.quaternion.clone().invert();
      multiOffsets.clear();
      for (const index of attachedIndices) {
        const group = findGroup(index);
        if (!group) continue;
        multiOffsets.set(index, {
          position: group.position.clone().sub(pivotObject.position).applyQuaternion(invPivotQuat),
          quaternion: invPivotQuat.clone().multiply(group.quaternion),
        });
      }
      transformControls.attach(pivotObject);
    },
    setGizmoMode(mode) {
      transformControls.setMode(mode);
    },
    isGizmoActive() {
      return transformControls.dragging || transformControls.axis !== null;
    },
    pickPartPivot(clientX, clientY, index) {
      const group = findGroup(index);
      const frame = group?.userData[MOTION_NODE] as THREE.Object3D | undefined;
      if (!group || !frame) return undefined;
      const rect = renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(
        new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1),
        camera,
      );
      const hit = raycaster.intersectObject(group, true).find((h) => (h.object as THREE.Mesh).isMesh);
      return hit ? meshBoundsIn(hit.object as THREE.Mesh, frame).center : undefined;
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
    pickFloor(clientX, clientY) {
      return course.pickFloor(rayFrom(clientX, clientY));
    },
    respawnOf: (index) => course.respawnOf(index),
    setCourseVisible(visible) {
      course.setVisible(visible);
    },
    resize,
    capturePreview() {
      const prevPixelRatio = renderer.getPixelRatio();
      const prevSize = new THREE.Vector2();
      renderer.getSize(prevSize);
      const prevAspect = camera.aspect;
      // A fixed bitmap whatever the window (shared's frame), at pixel ratio
      // 1 so it is exactly that many pixels — `updateStyle: false` keeps the
      // element's own layout untouched throughout.
      renderer.setPixelRatio(1);
      renderer.setSize(TRACK_THUMBNAIL_WIDTH, TRACK_THUMBNAIL_HEIGHT, false);
      camera.aspect = TRACK_THUMBNAIL_WIDTH / TRACK_THUMBNAIL_HEIGHT;
      camera.updateProjectionMatrix();
      this.render();
      let url: string | undefined;
      try {
        url = renderer.domElement.toDataURL("image/jpeg", PREVIEW_JPEG_QUALITY);
      } catch {
        url = undefined;
      }
      renderer.setPixelRatio(prevPixelRatio);
      renderer.setSize(prevSize.x, prevSize.y);
      camera.aspect = prevAspect;
      camera.updateProjectionMatrix();
      this.render();
      return url;
    },
    render() {
      orbitControls.update();
      course.follow();
      const now = performance.now();
      // A fan's rotor turns in the preview too (ADR 0075). Found every frame:
      // the Track is being edited, and a few hundred nodes is nothing to walk.
      spinParts(findSpinningParts(trackGroup), now);
      // And the mud bubbles (ADR 0103), on the same wall clock.
      simmerMud(trackGroup, now / 1000);
      glintIce(trackGroup, now / 1000);
      environment?.drawn.update(camera, now, orbitControls.target);
      renderer.render(scene, camera);
    },
    dispose() {
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", onShiftDown);
      window.removeEventListener("keyup", onShiftUp);
      environment?.drawn.dispose();
      disposeGroup(trackGroup);
      course.dispose();
      transformControls.dispose();
      orbitControls.dispose();
      clearSelectionBoxes();
      clearBotNav();
      overlapGhost.geometry.dispose();
      overlapGhostMaterial.dispose();
      renderer.dispose();
      // The canvas is ours (appended at creation) — a remount into the same
      // container (StrictMode) must not pile a second canvas under the new one.
      renderer.domElement.remove();
    },
  };
};
