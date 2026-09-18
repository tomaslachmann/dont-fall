import {
  BOUNCE_TEXTURE_FILE,
  ICE_TEXTURE_FILE,
  DEFAULT_ENVIRONMENT_ID,
  ENVIRONMENT_PRESETS,
  hasMotion,
  resolveEnvironmentId,
  moduleHasIceSurface,
  moduleHasBounceSurface,
  segmentScale,
  SURFACE_ATTACHMENTS,
  TICK_RATE_HZ,
  type AssetCategory,
  type Box,
  type DeckPlan,
  type EnvironmentId,
  type Module,
  type SegmentConveyor,
  type SegmentMotion,
  type SurfaceAttachmentKey,
  type Track,
  type TrackListing,
  type TrackRoundDefaults,
  type Vec3,
  launchHeightOf,
} from "@dont-fall/shared";
import type * as THREE from "three";
import {
  listTracks,
  loadTrack,
  publishPlaytestTrack,
  saveTrack,
} from "./api/api.js";
import {
  assetCategoryById,
  assetTabModuleIds,
  builderLibrary,
  loadAssetVisuals,
  loadAssetVisualsProgressive,
} from "./assets/assets.js";
import { loadDeckTexture } from "@dont-fall/render";
import { createMotionPanel, type MotionPanel } from "./motion/motionPanel.js";
import { PreviewScheduler, type PreviewSlot } from "./scene/previewScheduler.js";
import { templateParts } from "./scene/render.js";
import {
  deleteSegment,
  duplicateSegment,
  insertSegment,
  moveSegment,
  MOVE_STEP,
  MOVE_STEP_FINE,
  removeLast,
  ROTATE_STEP,
  ROTATE_STEP_FINE,
  rotateSegment,
  SCALE_STEP,
  SCALE_STEP_FINE,
  LAUNCH_HEIGHT_STEP,
  LAUNCH_HEIGHT_STEP_FINE,
  compactCheckpoints,
  setCheckpointRespawn,
  setSegmentAttachment,
  setSegmentCheckpoint,
  setSegmentLaunch,
  setSegmentStart,
  stepCheckpointOrder,
  worldToSegmentLocal,
  setSegmentScale,
  setSegmentTransforms,
  type RotateAxis,
  type SegmentTransform,
} from "./track/trackEdit.js";
import { TrackHistory } from "./track/trackHistory.js";
import { courseOf, motionLockReason, type CourseSummary } from "./lib/course.js";
import {
  createModulePreview,
  createTrackViewport,
  type TrackViewport,
} from "./scene/viewport.js";

export type { RotateAxis };
export type StatusKind = "ok" | "quiet" | "error";
export type BrowsePanelState = "ready" | "loading" | "empty" | "error";
export type GizmoMode = "translate" | "rotate" | "scale";

export interface EngineStatus {
  text: string;
  kind: StatusKind;
}

export interface LoadedTrackMeta {
  id: string;
  name: string;
  timeLimitMs: number;
  survivorTarget: number;
}

/**
 * The builder's framework-free core: everything `main.ts` used to own except
 * the DOM itself — history, selection, the viewport and motion-panel island
 * handles, palette previews, asset loading, the Motion clock, persistence.
 * React subscribes (structural changes and the 60 Hz clock separately) and
 * renders; the loop and the Three.js scene never run through React, the same
 * cut the client's `<GameCanvas>` makes (ADR 0008's own reasoning).
 *
 * Nothing here touches `document`/`window` at creation — islands attach
 * later, so tests drive the logic headless and attach stub islands.
 */
export interface BuilderEngine {
  readonly track: Track;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** Current selection in click order; the last is the primary every single-target action uses. */
  readonly selection: readonly number[];
  readonly primary: number | undefined;
  readonly gizmoMode: GizmoMode;
  readonly rotateAxis: RotateAxis;
  readonly status: EngineStatus;
  readonly assetsLoading: boolean;
  readonly assetsLoaded: boolean;
  readonly assetError: (moduleId: string) => string | undefined;
  readonly templateFor: (moduleId: string) => THREE.Group | undefined;
  readonly browseState: BrowsePanelState;
  readonly browseTracks: readonly TrackListing[];
  readonly loadedTrack: LoadedTrackMeta | null;
  readonly picking: boolean;
  readonly playing: boolean;
  readonly tintVisible: boolean;
  /**
   * The Environment the Draft is drawn inside once played (ADR 0074) — written
   * with every save and playtest, read back on load. A new Draft takes the default.
   */
  readonly environment: EnvironmentId;
  /**
   * Whether the viewport shows that Environment instead of the lavender
   * authoring canvas (ADR 0063, which stays the default).
   */
  readonly environmentPreview: boolean;
  /**
   * Whether the builder is framing the save's Thumbnail (ADR 0085) — the
   * viewport goes fullscreen with everything on (the authored Environment,
   * running Motions, Impact tints) and no authoring UI, and the only actions
   * are capture-and-save or cancel. The camera stays the author's: orbit,
   * zoom and pan keep working, picking does not.
   */
  readonly previewing: boolean;
  readonly clockSeconds: number;
  readonly apiUrl: string;
  readonly recentAssets: readonly string[];
  readonly library: Record<string, Module>;
  readonly assetCategoryById: Record<string, AssetCategory>;
  /** Bumped on every structural change — the `useSyncExternalStore` snapshot. */
  readonly version: number;

  subscribe: (listener: () => void) => () => void;
  subscribeClock: (listener: () => void) => () => void;

  attachViewport: (container: HTMLElement) => void;
  detachViewport: () => void;
  /**
   * Re-fits the viewport's renderer to its container — the shell calls this
   * after a layout swap (ADR 0085's capture mode) resizes the canvas box. A
   * no-op with no viewport attached.
   */
  resizeViewport: () => void;
  attachMotionPanel: (container: HTMLElement) => void;
  detachMotionPanel: () => void;
  /** Attaches a palette/tile preview; the returned cleanup unregisters it (StrictMode remounts). */
  attachPreview: (entry: Element, canvas: HTMLCanvasElement, moduleId: string) => () => void;
  setPreviewHovered: (canvas: HTMLCanvasElement, hovered: boolean) => void;

  placeModule: (moduleId: string) => void;
  select: (index: number | undefined) => void;
  toggleSelect: (index: number) => void;
  deleteSelected: () => void;
  duplicateSelected: () => void;
  removeLast: () => void;
  /** Start, Checkpoints in run order and finishes (ADR 0068) — recomputed off the current Track. */
  readonly course: CourseSummary;
  /** Whether the next viewport click picks a Checkpoint's respawn spot. */
  readonly pickingRespawn: boolean;
  /** Where Checkpoint `index`'s Respawn stands as the viewport draws it — `floor` absent when it has none. */
  respawnOf: (index: number) => { floor: Vec3 | undefined } | undefined;
  /** Make the primary Segment the Start (moving it from wherever it was), or take it away. */
  setSegmentStart: (start: boolean) => void;
  /** Switch the primary hoop or arch on as the next Checkpoint, or off (the rest renumbered). */
  setSegmentCheckpoint: (on: boolean) => void;
  /** Move the primary Checkpoint one number earlier or later, swapping with the one there. */
  stepCheckpointOrder: (direction: 1 | -1) => void;
  /** The next viewport click on a platform sets the primary Checkpoint's respawn spot; Esc cancels. */
  requestRespawnPick: () => void;
  cancelRespawnPick: () => void;
  /** The primary Checkpoint respawns on the floor under its gate again. */
  resetCheckpointRespawn: () => void;
  undo: () => void;
  redo: () => void;
  rotateSelected90: (direction: 1 | -1) => void;
  nudgeSelected: (direction: Vec3, fine: boolean) => void;
  rotateSelectedStep: (sign: 1 | -1, fine: boolean) => void;
  scaleSelected: (scale: number) => void;
  stepScale: (direction: 1 | -1, fine: boolean) => void;
  /** Attach (`conveyor` set) or detach (`undefined`) a belt on the primary Segment (ADR 0064). */
  setSegmentConveyor: (conveyor: SegmentConveyor | undefined) => void;
  /**
   * The primary Segment's deck Surface — one of them, or none. They are
   * mutually exclusive (one deck, one Surface: publish refuses a pair), so the
   * swap is one undoable edit rather than a detach the author could stop
   * halfway.
   */
  setSegmentSurface: (surface: SurfaceAttachmentKey | undefined) => void;
  /** Make the primary Segment a Prop, or leave its Asset where it stands (ADR 0095). */
  setSegmentProp: (prop: boolean) => void;
  /**
   * Set (or clear, `undefined`) how high the primary Spring Segment throws
   * (ADR 0069). Clearing returns it to its Asset's own default — a Spring is
   * never switched off, only retuned.
   */
  setSegmentLaunch: (height: number | undefined) => void;
  /** Step the primary Spring's height by one notch — no-op unless it is a Spring. */
  stepLaunchHeight: (direction: 1 | -1, fine: boolean) => void;
  /** Step the primary Segment's belt angle — no-op unless it runs a belt. */
  stepConveyorAngle: (direction: 1 | -1, fine: boolean) => void;
  setGizmoMode: (mode: GizmoMode) => void;
  setRotateAxis: (axis: RotateAxis) => void;

  requestPivotPick: (apply: (pivot: Vec3) => void) => void;
  cancelPivotPick: () => void;
  viewportPointerDown: (x: number, y: number) => void;
  viewportClick: (x: number, y: number, shiftKey: boolean) => void;

  setPlaying: (playing: boolean) => void;
  restartClock: () => void;
  setClockSeconds: (seconds: number) => void;
  setTintVisible: (visible: boolean) => void;
  /** Picks the Draft's Environment; a live preview follows without a reload. */
  setEnvironment: (environment: EnvironmentId) => void;
  setEnvironmentPreview: (on: boolean) => void;

  setApiUrl: (url: string) => void;
  saveTrack: (name: string, defaults: TrackRoundDefaults) => Promise<void>;
  /**
   * Enters Thumbnail capture for a save with `name`/`defaults` (ADR 0085) —
   * stashes them until the author confirms (capture-and-save) or cancels.
   * Forces the fullscreen view on; restoring it is confirm's and cancel's job.
   */
  startPreviewCapture: (name: string, defaults: TrackRoundDefaults) => void;
  /** Leaves capture mode without saving — the stashed save is dropped, the authoring view restored. */
  cancelPreviewCapture: () => void;
  /**
   * Captures the current view as the stashed save's Thumbnail and saves.
   * Stays in capture mode on any failure (no pixels, save refused), so the
   * author can reframe or retry instead of starting over.
   */
  confirmPreviewCapture: () => Promise<void>;
  loadTrackById: (id: string) => Promise<void>;
  fetchTrackList: () => Promise<void>;
  /** Publishes the Draft for playtest — the toolbar passes its own fields, the engine holds no text. */
  playtest: (defaults: TrackRoundDefaults) => Promise<void>;

  ensureAssetTemplates: () => void;
  retryAsset: (moduleId: string) => void;

  startLoop: () => void;
  stopLoop: () => void;
  /** One loop step — `startLoop` drives it via rAF; tests call it directly. */
  frame: (nowMs: number) => void;
  /** The builder's keyboard map; true when the key was consumed. */
  handleKeyDown: (event: { code: string; shiftKey: boolean; target: EventTarget | null }) => boolean;
  dispose: () => void;
}

const MOVE_DIRECTIONS: Record<string, Vec3> = {
  ArrowUp: { x: 0, y: 0, z: -1 },
  ArrowDown: { x: 0, y: 0, z: 1 },
  ArrowLeft: { x: -1, y: 0, z: 0 },
  ArrowRight: { x: 1, y: 0, z: 0 },
  PageUp: { x: 0, y: 1, z: 0 },
  PageDown: { x: 0, y: -1, z: 0 },
};

/** A click that ends further than this from its press is an orbit drag, never a pick. */
const DRAG_THRESHOLD_PX = 5;

const DEFAULT_API_URL = "http://localhost:8081";
const RECENT_ASSETS_CAP = 12;

export const createBuilderEngine = (opts?: {
  createViewport?: (container: HTMLElement, onCommit: (updates: { index: number; transform: SegmentTransform }[]) => void) => TrackViewport;
}): BuilderEngine => {
  const createViewport = opts?.createViewport ?? createTrackViewport;
  const library = builderLibrary();
  const categories = assetCategoryById();
  const history = new TrackHistory([]);
  const previews = new PreviewScheduler();
  const slotByCanvas = new Map<HTMLCanvasElement, PreviewSlot>();
  const slotByEntry = new Map<Element, PreviewSlot>();
  let observer: IntersectionObserver | undefined;

  let viewport: TrackViewport | undefined;
  let motionPanel: MotionPanel | undefined;
  let selected = new Set<number>();
  let gizmoMode: GizmoMode = "translate";
  let rotateAxis: RotateAxis = "yaw";
  let status: EngineStatus = { text: "READY", kind: "quiet" };
  let assetsLoading = false;
  let assetsLoaded = false;
  let templates: Record<string, THREE.Group> = {};
  /** One deck plan per settled asset file (ADR 0096) — cached beside its template, which settled from the same bytes. */
  let deckPlans: Record<string, DeckPlan | undefined> = {};
  const assetErrors = new Map<string, string>();
  let browseState: BrowsePanelState = "ready";
  let browseTracks: TrackListing[] = [];
  let loadedTrack: LoadedTrackMeta | null = null;
  let pivotPick: ((pivot: Vec3) => void) | undefined;
  let respawnPick = false;
  let pointerDownAt: { x: number; y: number } | undefined;
  let clockSeconds = 0;
  let playing = true;
  let tintVisible = true;
  let environment: EnvironmentId = DEFAULT_ENVIRONMENT_ID;
  let environmentPreview = false;
  /** The viewport draws the picked Environment while previewing it, the authoring canvas otherwise. */
  const syncEnvironmentView = (): void => {
    viewport?.setEnvironment(environmentPreview ? ENVIRONMENT_PRESETS[environment] : null);
  };
  /** The save waiting on its Thumbnail while `previewing`, dropped on cancel. */
  let pendingSave: { name: string; defaults: TrackRoundDefaults } | null = null;
  /** The authoring view as capture mode found it — restored on confirm and on cancel. */
  let savedView: { environmentPreview: boolean; playing: boolean; tintVisible: boolean } | null = null;
  /** Leaves capture mode: drops the stashed save and puts the authoring view back as it was. */
  const exitPreviewCapture = (): void => {
    pendingSave = null;
    if (savedView) {
      environmentPreview = savedView.environmentPreview;
      playing = savedView.playing;
      tintVisible = savedView.tintVisible;
      savedView = null;
    }
    syncEnvironmentView();
    viewport?.setImpactTintVisible(tintVisible);
    viewport?.setCourseVisible(true);
  };
  let apiUrl = DEFAULT_API_URL;
  let recentAssets: string[] = [];
  let lastFrameAt: number | undefined;
  let rafHandle = 0;

  const listeners = new Set<() => void>();
  const clockListeners = new Set<() => void>();
  let version = 0;
  const notify = (): void => {
    version += 1;
    for (const listener of listeners) listener();
  };
  const notifyClock = (): void => {
    for (const listener of clockListeners) listener();
  };

  const primary = (): number | undefined => [...selected].at(-1);

  /** A Module's separate parts, once per asset Module — templates never change in a session. */
  const partsByModule = new Map<string, Box[]>();
  const partsOf = (moduleId: string): Box[] => {
    const template = templates[moduleId];
    if (!template) return [];
    let parts = partsByModule.get(moduleId);
    if (!parts) partsByModule.set(moduleId, (parts = templateParts(template)));
    return parts;
  };

  const setStatus = (text: string, kind: StatusKind): void => {
    status = { text, kind };
  };

  /** Full viewport rebuild or the transform-only fast path (a move/rotate never re-chains). */
  const syncTrackView = (transformOnly: boolean): void => {
    if (!viewport) return;
    if (transformOnly) {
      viewport.retransformSegments(history.track);
      return;
    }
    ensureIceTexture();
    ensureBounceTexture();
    viewport.setTrack(
      library,
      history.track,
      templates,
      {
        ice: iceTexture ?? undefined,
        bounce: bounceTexture ?? undefined,
      },
      deckPlans,
    );
  };

  /**
   * The shared ice texture (ADR 0066), loaded lazily on the first sync
   * whose Track sheets a deck — an ice-free session never fetches it. One
   * in flight at most; landing re-syncs so the sheets appear, while a
   * failure warns and retries on the next full sync (edits are user-paced,
   * so no backoff is needed for a cosmetic).
   */
  let iceTexture: THREE.Texture | null = null;
  let iceLoading = false;
  const ensureIceTexture = (): void => {
    if (!viewport || iceTexture || iceLoading) return;
    if (
      !history.track.some((segment) => {
        if (segment.ice === true) return true;
        const module = library[segment.moduleId];
        return module !== undefined && moduleHasIceSurface(module);
      })
    ) {
      return;
    }
    iceLoading = true;
    void loadDeckTexture(fetchAssetBytes, `${apiUrl}/assets`, ICE_TEXTURE_FILE).then(
      (loaded) => {
        iceLoading = false;
        iceTexture = loaded;
        syncTrackView(false);
      },
      (err: unknown) => {
        iceLoading = false;
        console.warn(`DON'T FALL: ice overlay unavailable: ${(err as Error).message}`);
      },
    );
  };

  /**
   * The shared bounce texture (ADR 0070) — the same lazy contract again.
   */
  let bounceTexture: THREE.Texture | null = null;
  let bounceLoading = false;
  const ensureBounceTexture = (): void => {
    if (!viewport || bounceTexture || bounceLoading) return;
    if (
      !history.track.some((segment) => {
        if (segment.bounce === true) return true;
        const module = library[segment.moduleId];
        return module !== undefined && moduleHasBounceSurface(module);
      })
    ) {
      return;
    }
    bounceLoading = true;
    void loadDeckTexture(fetchAssetBytes, `${apiUrl}/assets`, BOUNCE_TEXTURE_FILE).then(
      (loaded) => {
        bounceLoading = false;
        bounceTexture = loaded;
        syncTrackView(false);
      },
      (err: unknown) => {
        bounceLoading = false;
        console.warn(`DON'T FALL: bounce sheet unavailable: ${(err as Error).message}`);
      },
    );
  };

  const fetchAssetBytes = async (url: string): Promise<Uint8Array> => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${url} answered ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  };

  /** Pushes the selection to the viewport (gizmo + highlight + motion guide) and the panel. */
  const syncSelectionView = (): void => {
    const list = [...selected];
    viewport?.setSelected(list);
    const first = primary();
    viewport?.showMotionGuide(first);
    viewport?.showLaunchArc(first);
    if (first === undefined) motionPanel?.show(undefined, undefined);
    else {
      const segment = history.track[first]!;
      // A Start, a Checkpoint and a finish sign stay still (ADR 0068): no Motion
      // editor for them — the Course panel says why.
      if (motionLockReason(segment, library) && !hasMotion(segment.motion)) motionPanel?.show(undefined, undefined);
      else motionPanel?.show(library[segment.moduleId], segment.motion, partsOf(segment.moduleId), segmentScale(segment), list.length);
    }
  };

  /** Applies an edit and re-selects in one step — the pattern every mutating action shares. */
  const applyEdit = (next: Track, nextSelected: number | undefined, transformOnly = false): void => {
    history.apply(next);
    syncTrackView(transformOnly);
    selected = nextSelected !== undefined && nextSelected >= 0 && nextSelected < history.track.length ? new Set([nextSelected]) : new Set();
    syncSelectionView();
    notify();
  };

  const commitSegmentTransforms = (updates: { index: number; transform: SegmentTransform }[]): void => {
    history.apply(setSegmentTransforms(history.track, library, updates));
    syncTrackView(true);
    selected = new Set(updates.map((u) => u.index));
    syncSelectionView();
    notify();
  };

  const rememberAsset = (moduleId: string): void => {
    if (!(moduleId in categories)) return;
    recentAssets = [moduleId, ...recentAssets.filter((id) => id !== moduleId)].slice(0, RECENT_ASSETS_CAP);
  };

  const engine: BuilderEngine = {
    get track() {
      return history.track;
    },
    get canUndo() {
      return history.canUndo;
    },
    get canRedo() {
      return history.canRedo;
    },
    get selection() {
      return [...selected];
    },
    get primary() {
      return primary();
    },
    get gizmoMode() {
      return gizmoMode;
    },
    get rotateAxis() {
      return rotateAxis;
    },
    get status() {
      return status;
    },
    get assetsLoading() {
      return assetsLoading;
    },
    get assetsLoaded() {
      return assetsLoaded;
    },
    assetError: (moduleId) => assetErrors.get(moduleId),
    templateFor: (moduleId) => templates[moduleId],
    get browseState() {
      return browseState;
    },
    get browseTracks() {
      return browseTracks;
    },
    get loadedTrack() {
      return loadedTrack;
    },
    get picking() {
      return pivotPick !== undefined || respawnPick;
    },
    get pickingRespawn() {
      return respawnPick;
    },
    get course() {
      return courseOf(history.track, library);
    },
    respawnOf: (index) => viewport?.respawnOf(index),
    get playing() {
      return playing;
    },
    get tintVisible() {
      return tintVisible;
    },
    get environment() {
      return environment;
    },
    get environmentPreview() {
      return environmentPreview;
    },
    get previewing() {
      return pendingSave !== null;
    },
    get clockSeconds() {
      return clockSeconds;
    },
    get apiUrl() {
      return apiUrl;
    },
    get recentAssets() {
      return recentAssets;
    },
    get library() {
      return library;
    },
    get assetCategoryById() {
      return categories;
    },
    get version() {
      return version;
    },

    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    subscribeClock: (listener) => {
      clockListeners.add(listener);
      return () => {
        clockListeners.delete(listener);
      };
    },

    attachViewport: (container) => {
      engine.detachViewport();
      viewport = createViewport(container, commitSegmentTransforms);
      viewport.setGizmoMode(gizmoMode);
      viewport.setImpactTintVisible(tintVisible);
      syncEnvironmentView();
      ensureIceTexture();
      ensureBounceTexture();
      viewport.setTrack(
        library,
        history.track,
        templates,
        {
          ice: iceTexture ?? undefined,
          bounce: bounceTexture ?? undefined,
        },
        deckPlans,
      );
      syncSelectionView();
    },
    detachViewport: () => {
      viewport?.dispose();
      viewport = undefined;
    },
    resizeViewport: () => {
      viewport?.resize();
    },

    attachMotionPanel: (container) => {
      engine.detachMotionPanel();
      motionPanel = createMotionPanel(
        container,
        (motion: SegmentMotion | undefined) => {
          const index = primary();
          if (index === undefined) return;
          const locked = motion ? motionLockReason(history.track[index]!, library) : undefined;
          if (locked) {
            setStatus(locked, "error");
            syncSelectionView();
            notify();
            return;
          }
          // Transform-only: a Motion poses a Segment around where it rests, never re-chains it.
          applyEdit(setSegmentAttachment(history.track, index, "motion", motion), index, true);
        },
        (apply) => {
          pivotPick = apply;
          setStatus("click the part of the selected Segment it should turn about · Esc cancels", "quiet");
          notify();
        },
        (seconds) => {
          playing = false;
          clockSeconds = seconds;
          notifyClock();
          notify();
        },
      );
      syncSelectionView();
    },
    detachMotionPanel: () => {
      motionPanel = undefined;
    },

    attachPreview: (entry, canvas, moduleId) => {
      const module = library[moduleId];
      const template = templates[moduleId];
      if (!module) return () => {};
      const slot = previews.add(createModulePreview(canvas, module, template));
      slotByCanvas.set(canvas, slot);
      slotByEntry.set(entry, slot);
      if (!observer && typeof IntersectionObserver !== "undefined") {
        observer = new IntersectionObserver((observed) => {
          for (const { target, isIntersecting } of observed) {
            const found = slotByEntry.get(target);
            if (found) found.visible = isIntersecting;
          }
        });
      }
      // No observer (a test without one) means assume visible — production browsers always have it.
      if (observer) observer.observe(entry);
      else slot.visible = true;
      return () => {
        observer?.unobserve(entry);
        slotByEntry.delete(entry);
        slotByCanvas.delete(canvas);
        previews.remove(slot);
      };
    },
    setPreviewHovered: (canvas, hovered) => {
      const slot = slotByCanvas.get(canvas);
      if (slot) slot.hovered = hovered;
    },

    placeModule: (moduleId) => {
      if (!library[moduleId]) return;
      const at = primary();
      const insertAt = at !== undefined ? at + 1 : history.track.length;
      rememberAsset(moduleId);
      applyEdit(insertSegment(history.track, library, insertAt, moduleId, categories), insertAt);
    },
    select: (index) => {
      selected = index !== undefined && index >= 0 && index < history.track.length ? new Set([index]) : new Set();
      syncSelectionView();
      notify();
    },
    toggleSelect: (index) => {
      if (index < 0 || index >= history.track.length) return;
      if (selected.has(index)) selected.delete(index);
      else selected.add(index);
      syncSelectionView();
      notify();
    },
    deleteSelected: () => {
      const index = primary();
      if (index === undefined) return;
      applyEdit(deleteSegment(history.track, library, index), undefined);
    },
    duplicateSelected: () => {
      const index = primary();
      if (index === undefined) return;
      applyEdit(duplicateSegment(history.track, library, index), index + 1);
    },
    removeLast: () => {
      if (history.track.length === 0) return;
      applyEdit(compactCheckpoints(removeLast(history.track)), undefined);
    },
    setSegmentStart: (start) => {
      const index = primary();
      if (index === undefined) return;
      if (start && hasMotion(history.track[index]!.motion)) {
        setStatus("a Start stays still — switch its Motion off first", "error");
        notify();
        return;
      }
      applyEdit(setSegmentStart(history.track, index, start), index);
    },
    setSegmentCheckpoint: (on) => {
      const index = primary();
      if (index === undefined) return;
      const segment = history.track[index]!;
      if (on && library[segment.moduleId]?.gate?.role !== "checkpoint") return;
      if (on && hasMotion(segment.motion)) {
        setStatus("a Checkpoint stays still — switch its Motion off first", "error");
        notify();
        return;
      }
      if (!on && respawnPick) respawnPick = false;
      applyEdit(setSegmentCheckpoint(history.track, index, on), index);
    },
    stepCheckpointOrder: (direction) => {
      const index = primary();
      if (index === undefined) return;
      applyEdit(stepCheckpointOrder(history.track, index, direction), index);
    },
    requestRespawnPick: () => {
      const index = primary();
      if (index === undefined || !history.track[index]!.checkpoint) return;
      pivotPick = undefined;
      respawnPick = true;
      setStatus("click the platform the Checkpoint's Respawn should stand on · Esc cancels", "quiet");
      notify();
    },
    cancelRespawnPick: () => {
      if (!respawnPick) return;
      respawnPick = false;
      setStatus(`${history.track.length} Segment(s)`, "quiet");
      notify();
    },
    resetCheckpointRespawn: () => {
      const index = primary();
      if (index === undefined) return;
      applyEdit(setCheckpointRespawn(history.track, index, undefined), index);
    },
    undo: () => {
      history.undo();
      syncTrackView(false);
      engine.select(undefined);
    },
    redo: () => {
      history.redo();
      syncTrackView(false);
      engine.select(undefined);
    },
    rotateSelected90: (direction) => {
      const index = primary();
      if (index === undefined) return;
      applyEdit(rotateSegment(history.track, library, index, direction * (Math.PI / 2)), index, true);
    },
    nudgeSelected: (direction, fine) => {
      const index = primary();
      if (index === undefined) return;
      const step = fine ? MOVE_STEP_FINE : MOVE_STEP;
      applyEdit(
        moveSegment(history.track, library, index, { x: direction.x * step, y: direction.y * step, z: direction.z * step }),
        index,
        true,
      );
    },
    rotateSelectedStep: (sign, fine) => {
      const index = primary();
      if (index === undefined) return;
      const step = fine ? ROTATE_STEP_FINE : ROTATE_STEP;
      applyEdit(rotateSegment(history.track, library, index, sign * step, rotateAxis), index, true);
    },
    scaleSelected: (scale) => {
      const index = primary();
      if (index === undefined) return;
      applyEdit(setSegmentScale(history.track, library, index, scale), index, true);
    },
    stepScale: (direction, fine) => {
      const index = primary();
      if (index === undefined) return;
      const step = fine ? SCALE_STEP_FINE : SCALE_STEP;
      engine.scaleSelected(segmentScale(history.track[index]!) + direction * step);
    },
    setSegmentConveyor: (conveyor) => {
      const index = primary();
      if (index === undefined) return;
      // Full rebuild (never the transform-only fast path): attaching a belt
      // adds the strip visual, detaching removes it.
      applyEdit(setSegmentAttachment(history.track, index, "conveyor", conveyor), index);
    },
    setSegmentSurface: (surface) => {
      const index = primary();
      if (index === undefined) return;
      // Every Surface Attachment in one edit, and a full rebuild (the sheet
      // visual comes and goes): picking ice off mud must not leave a Segment
      // carrying both, not even for one undo step.
      let next = history.track;
      for (const { key } of SURFACE_ATTACHMENTS) {
        next = setSegmentAttachment(next, index, key, surface === key ? true : undefined);
      }
      applyEdit(next, index);
    },
    setSegmentProp: (prop) => {
      const index = primary();
      if (index === undefined) return;
      // A Prop is a body physics owns, so it is not a deck: the deck and the
      // belt go in the same edit, never leaving a Segment carrying both, not
      // even for one undo step (the Surface picker's own rule).
      let next = setSegmentAttachment(history.track, index, "prop", prop ? true : undefined);
      if (prop) {
        for (const { key } of SURFACE_ATTACHMENTS) next = setSegmentAttachment(next, index, key, undefined);
        next = setSegmentAttachment(next, index, "conveyor", undefined);
      }
      applyEdit(next, index);
    },
    setSegmentLaunch: (height) => {
      const index = primary();
      if (index === undefined) return;
      // Transform-only would be wrong: the arc overlay is rebuilt from the
      // resolved launch pad, like a belt's strip.
      applyEdit(setSegmentLaunch(history.track, index, height), index);
    },
    stepLaunchHeight: (direction, fine) => {
      const index = primary();
      if (index === undefined) return;
      const module = library[history.track[index]!.moduleId];
      if (!module?.launch) return;
      const step = fine ? LAUNCH_HEIGHT_STEP_FINE : LAUNCH_HEIGHT_STEP;
      engine.setSegmentLaunch(launchHeightOf(history.track[index]!.launch, module.launch) + direction * step);
    },
    stepConveyorAngle: (direction, fine) => {
      const index = primary();
      if (index === undefined) return;
      const current = history.track[index]?.conveyor;
      if (!current) return;
      const step = fine ? ROTATE_STEP_FINE : ROTATE_STEP;
      // Radians, unnormalised — the angle is periodic, and wrapping here
      // would fight the stepper's own round-trips past ±180°.
      engine.setSegmentConveyor({ preset: current.preset, angle: current.angle + direction * step });
    },
    setGizmoMode: (mode) => {
      gizmoMode = mode;
      viewport?.setGizmoMode(mode);
      notify();
    },
    setRotateAxis: (axis) => {
      rotateAxis = axis;
      notify();
    },

    requestPivotPick: (apply) => {
      pivotPick = apply;
      setStatus("click the part of the selected Segment it should turn about · Esc cancels", "quiet");
      notify();
    },
    cancelPivotPick: () => {
      if (pivotPick === undefined) return;
      pivotPick = undefined;
      setStatus(`${history.track.length} Segment(s)`, "quiet");
      notify();
    },
    viewportPointerDown: (x, y) => {
      pointerDownAt = { x, y };
    },
    viewportClick: (x, y, shiftKey) => {
      // Capture mode frames, never picks — the orbit controls still eat the
      // drag itself, this only skips the selection that would follow it.
      if (pendingSave) return;
      if (respawnPick) {
        const index = primary();
        const hit = viewport?.pickFloor(x, y);
        if (index === undefined || !hit || hit.index === index) {
          setStatus(
            hit?.index === index ? "that's the gate itself — click the platform around it · Esc cancels" : "missed — click a platform · Esc cancels",
            "error",
          );
          notify();
          return;
        }
        respawnPick = false;
        setStatus(`${history.track.length} Segment(s)`, "quiet");
        applyEdit(setCheckpointRespawn(history.track, index, worldToSegmentLocal(history.track[index]!, hit.point)), index);
        return;
      }
      if (pivotPick) {
        const index = primary();
        const pivot = index !== undefined ? viewport?.pickPartPivot(x, y, index) : undefined;
        if (!pivot) {
          setStatus("missed the selected Segment — click one of its parts · Esc cancels", "error");
          notify();
          return;
        }
        const apply = pivotPick;
        pivotPick = undefined;
        setStatus(`${history.track.length} Segment(s)`, "quiet");
        notify();
        apply(pivot);
        return;
      }
      if (viewport?.isGizmoActive()) return;
      const moved = pointerDownAt ? Math.hypot(x - pointerDownAt.x, y - pointerDownAt.y) : 0;
      if (moved > DRAG_THRESHOLD_PX) return;
      const index = viewport?.pick(x, y);
      if (index !== undefined && shiftKey) engine.toggleSelect(index);
      else engine.select(index);
    },

    setPlaying: (next) => {
      playing = next;
      notify();
    },
    restartClock: () => {
      clockSeconds = 0;
      notifyClock();
    },
    setClockSeconds: (seconds) => {
      playing = false;
      clockSeconds = seconds;
      notifyClock();
      notify();
    },
    setTintVisible: (visible) => {
      tintVisible = visible;
      viewport?.setImpactTintVisible(visible);
      notify();
    },
    setEnvironment: (next) => {
      if (next === environment) return;
      environment = next;
      if (environmentPreview) syncEnvironmentView();
      notify();
    },
    setEnvironmentPreview: (on) => {
      if (on === environmentPreview) return;
      environmentPreview = on;
      syncEnvironmentView();
      notify();
    },

    setApiUrl: (url) => {
      apiUrl = url;
      notify();
    },
    saveTrack: async (name, defaults) => {
      setStatus("saving…", "quiet");
      notify();
      try {
        const { id } = await saveTrack(apiUrl, name.trim(), history.track, defaults, environment);
        loadedTrack = { id, name: name.trim(), timeLimitMs: defaults.timeLimitMs, survivorTarget: defaults.survivorTarget };
        setStatus(`saved as "${id}"`, "ok");
      } catch (err) {
        setStatus(`save failed: ${(err as Error).message}`, "error");
      }
      notify();
    },
    startPreviewCapture: (name, defaults) => {
      if (pendingSave) return;
      if (history.track.length === 0) {
        setStatus("cannot save an empty Track — place a Module first", "error");
        notify();
        return;
      }
      pendingSave = { name, defaults };
      savedView = { environmentPreview, playing, tintVisible };
      // The bare Track, everything on: no selection (no gizmo, no boxes), no
      // guides, no course markers, the authored Environment drawn, Motions
      // running, Impact tints lit — and the whole Track framed to start from.
      pivotPick = undefined;
      respawnPick = false;
      selected = new Set();
      syncSelectionView();
      viewport?.setCourseVisible(false);
      environmentPreview = true;
      syncEnvironmentView();
      playing = true;
      tintVisible = true;
      viewport?.setImpactTintVisible(true);
      viewport?.frameTrack();
      setStatus("frame the Track — orbit · zoom · pan — then Create Preview", "quiet");
      notify();
    },
    cancelPreviewCapture: () => {
      if (!pendingSave) return;
      exitPreviewCapture();
      setStatus(`${history.track.length} Segment(s)`, "quiet");
      notify();
    },
    confirmPreviewCapture: async () => {
      const save = pendingSave;
      if (!save) return;
      const thumbnail = viewport?.capturePreview();
      if (!thumbnail) {
        setStatus("capture failed — the canvas gave no pixels, reframe or Cancel", "error");
        notify();
        return;
      }
      setStatus("saving…", "quiet");
      notify();
      try {
        const { id } = await saveTrack(apiUrl, save.name.trim(), history.track, save.defaults, environment, thumbnail);
        loadedTrack = {
          id,
          name: save.name.trim(),
          timeLimitMs: save.defaults.timeLimitMs,
          survivorTarget: save.defaults.survivorTarget,
        };
        exitPreviewCapture();
        setStatus(`saved as "${id}"`, "ok");
      } catch (err) {
        // Still previewing: the framing survives, so the author retries
        // instead of starting over.
        setStatus(`save failed: ${(err as Error).message}`, "error");
      }
      notify();
    },
    loadTrackById: async (id) => {
      try {
        const stored = await loadTrack(apiUrl, id);
        // Warn, never block: a Module the builder doesn't know (a procedural
        // one, ADR 0078) is skipped by the viewport, so the status names it.
        // No resolve for warnings — the builder's Modules carry no geometry,
        // so every gate would read as floorless.
        const unknown = [...new Set(stored.track.map((segment) => segment.moduleId))].filter((moduleId) => !Object.hasOwn(library, moduleId));
        history.reset(stored.track);
        // A preset this build lacks (a newer API's) draws the default rather than failing the load.
        const loadedEnvironment = resolveEnvironmentId(stored.environment);
        if (loadedEnvironment.id !== environment) {
          environment = loadedEnvironment.id;
          if (environmentPreview) syncEnvironmentView();
        }
        loadedTrack = {
          id: stored.id,
          name: stored.name ?? "",
          timeLimitMs: stored.timeLimitMs,
          survivorTarget: stored.survivorTarget,
        };
        // A loaded Track may place asset Segments before the Assets tab was
        // ever opened — fetch their visuals in the background and re-render
        // when they land, rather than leaving them invisible.
        if (stored.track.some((segment) => segment.moduleId in categories)) engine.ensureAssetTemplates();
        syncTrackView(false);
        viewport?.frameTrack();
        selected = new Set();
        syncSelectionView();
        const loaded = `loaded "${stored.id}" (${history.track.length} Segment(s))`;
        if (unknown.length > 0) setStatus(`${loaded} — ${unknown.length} unknown Module(s), not drawn: ${unknown.join(", ")}`, "error");
        else if (loadedEnvironment.warning) setStatus(`${loaded} — ${loadedEnvironment.warning}`, "error");
        else setStatus(loaded, "ok");
      } catch (err) {
        setStatus(`load failed: ${(err as Error).message}`, "error");
      }
      notify();
    },
    fetchTrackList: async () => {
      browseState = "loading";
      notify();
      try {
        browseTracks = await listTracks(apiUrl);
        browseState = browseTracks.length === 0 ? "empty" : "ready";
      } catch (err) {
        browseState = "error";
        setStatus(`browse failed: ${(err as Error).message}`, "error");
      }
      notify();
    },
    playtest: async (defaults) => {
      if (history.track.length === 0) {
        setStatus("cannot playtest an empty Track — place a Module first", "error");
        notify();
        return;
      }
      setStatus("publishing for playtest…", "quiet");
      notify();
      try {
        const { id } = await publishPlaytestTrack(apiUrl, history.track, defaults, environment);
        // 5173 is apps/client's own fixed dev port — a local-dev-only detail.
        // `/play?track=&freeroam=1`: straight into a free-roam session, no Lobby.
        const host = globalThis.location?.hostname ?? "localhost";
        globalThis.window?.open(`http://${host}:5173/play?track=${encodeURIComponent(id)}&freeroam=1`, "_blank");
        setStatus(`free-roam opened in a new tab (Track "${id}")`, "ok");
      } catch (err) {
        setStatus(`playtest failed: ${(err as Error).message}`, "error");
      }
      notify();
    },

    ensureAssetTemplates: () => {
      if (assetsLoading || assetsLoaded) return;
      assetsLoading = true;
      setStatus("loading asset visuals…", "quiet");
      notify();
      const fetchBytes = async (url: string): Promise<Uint8Array> => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`GET ${url} answered ${res.status}`);
        return new Uint8Array(await res.arrayBuffer());
      };
      void loadAssetVisualsProgressive(fetchBytes, `${apiUrl}/assets`, assetTabModuleIds(), (moduleId, result) => {
        if (result.ok) {
          templates = { ...templates, [moduleId]: result.template };
          deckPlans = { ...deckPlans, [moduleId]: result.plan };
          assetErrors.delete(moduleId);
        } else {
          assetErrors.set(moduleId, result.error.message);
        }
        notify();
      }).then(
        () => {
          assetsLoading = false;
          assetsLoaded = true;
          const failed = assetErrors.size;
          setStatus(
            failed === 0 ? `${history.track.length} Segment(s)` : `${failed} asset visual(s) failed — click a tile to retry`,
            failed === 0 ? "quiet" : "error",
          );
          syncTrackView(false);
          syncSelectionView();
          notify();
        },
        (err: unknown) => {
          // Unreachable in practice (`loadAssetVisualsProgressive` settles
          // per-file and never rejects), kept so a future throw still lands
          // visibly instead of as an unhandled rejection.
          assetsLoading = false;
          setStatus(`assets failed: ${(err as Error).message}`, "error");
          notify();
        },
      );
    },
    retryAsset: (moduleId) => {
      if (!assetsLoaded) return;
      assetErrors.delete(moduleId);
      notify();
      const fetchBytes = async (url: string): Promise<Uint8Array> => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`GET ${url} answered ${res.status}`);
        return new Uint8Array(await res.arrayBuffer());
      };
      void loadAssetVisuals(fetchBytes, `${apiUrl}/assets`, [moduleId]).then(
        (loaded) => {
          templates = { ...templates, [moduleId]: loaded[moduleId]!.template };
          deckPlans = { ...deckPlans, [moduleId]: loaded[moduleId]!.plan };
          syncTrackView(false);
          syncSelectionView();
          notify();
        },
        (err: unknown) => {
          assetErrors.set(moduleId, (err as Error).message);
          notify();
        },
      );
    },

    startLoop: () => {
      engine.stopLoop();
      lastFrameAt = undefined;
      if (typeof requestAnimationFrame === "undefined") return;
      const tick = (now: number): void => {
        engine.frame(now);
        rafHandle = requestAnimationFrame(tick);
      };
      rafHandle = requestAnimationFrame(tick);
    },
    stopLoop: () => {
      if (rafHandle !== 0 && typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(rafHandle);
      rafHandle = 0;
    },
    frame: (nowMs) => {
      // Capped so a backgrounded tab resumes where it paused rather than leaping.
      const dt = lastFrameAt === undefined ? 0 : Math.min(0.1, (nowMs - lastFrameAt) / 1000);
      lastFrameAt = nowMs;
      if (playing) {
        clockSeconds += dt;
        notifyClock();
      }
      motionPanel?.setClock(clockSeconds);
      viewport?.setMotionTime(clockSeconds * TICK_RATE_HZ);
      previews.frame();
      viewport?.render();
    },

    handleKeyDown: (event) => {
      if (event.code === "Escape" && pendingSave) {
        engine.cancelPreviewCapture();
        return true;
      }
      if (event.code === "Escape" && pivotPick) {
        engine.cancelPivotPick();
        return true;
      }
      if (event.code === "Escape" && respawnPick) {
        engine.cancelRespawnPick();
        return true;
      }
      const index = primary();
      const typing = event.target instanceof HTMLElement && (event.target.tagName === "INPUT" || event.target.tagName === "TEXTAREA");
      if (index === undefined || typing) return false;

      const direction = MOVE_DIRECTIONS[event.code];
      if (direction) {
        engine.nudgeSelected(direction, event.shiftKey);
        return true;
      }
      if (event.code === "Minus" || event.code === "NumpadSubtract" || event.code === "Equal" || event.code === "NumpadAdd") {
        engine.stepScale(event.code === "Minus" || event.code === "NumpadSubtract" ? -1 : 1, event.shiftKey);
        return true;
      }
      if (event.code === "BracketLeft" || event.code === "BracketRight") {
        engine.rotateSelectedStep(event.code === "BracketRight" ? 1 : -1, event.shiftKey);
        return true;
      }
      return false;
    },

    dispose: () => {
      engine.stopLoop();
      engine.detachViewport();
      engine.detachMotionPanel();
      observer?.disconnect();
      listeners.clear();
      clockListeners.clear();
      slotByCanvas.clear();
      slotByEntry.clear();
    },
  };
  return engine;
};
