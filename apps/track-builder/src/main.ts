import { MODULE_LIBRARY, type Track, type Vec3 } from "@dont-fall/shared";
import { listTracks, loadTrack, saveTrack } from "./api.js";
import { startPlaytest, type Playtest } from "./playtest.js";
import {
  deleteSegment,
  duplicateSegment,
  insertSegment,
  moveSegment,
  removeLast,
  rotateSegment,
  type RotateAxis,
} from "./trackEdit.js";
import { TrackHistory } from "./trackHistory.js";
import { createModulePreview, createTrackViewport } from "./viewport.js";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const paletteList = $("palette-list");
const serviceUrlInput = $<HTMLInputElement>("service-url");
const trackNameInput = $<HTMLInputElement>("track-name");
const trackIdInput = $<HTMLInputElement>("track-id");
const statusEl = $("status");
const playtestButton = $("playtest");
const viewportContainer = $("viewport");
const undoButton = $<HTMLButtonElement>("undo");
const redoButton = $<HTMLButtonElement>("redo");
const inspector = $("inspector");
const inspectorLabel = $("inspector-label");
const browsePanel = $("browse");
const browseList = $("browse-list");
const axisButtons: Record<RotateAxis, HTMLButtonElement> = {
  yaw: $("axis-yaw"),
  pitch: $("axis-pitch"),
  roll: $("axis-roll"),
};

const history = new TrackHistory([]);
let selectedIndex: number | undefined;
const previewRenders: (() => void)[] = [];

const viewport = createTrackViewport(viewportContainer);
const editCanvas = viewportContainer.querySelector("canvas")!;

let mode: "edit" | "playtest" = "edit";
let playtest: Playtest | undefined;

const setStatus = (text: string): void => {
  statusEl.textContent = text;
};

const select = (index: number | undefined): void => {
  selectedIndex = index !== undefined && index >= 0 && index < history.track.length ? index : undefined;
  viewport.setSelected(selectedIndex);
  if (selectedIndex === undefined) {
    inspector.hidden = true;
  } else {
    inspector.hidden = false;
    const segment = history.track[selectedIndex]!;
    const manualHint = segment.manuallyPlaced ? " (manually placed)" : "";
    inspectorLabel.textContent = `#${selectedIndex} ${segment.moduleId}${manualHint}`;
  }
};

// `setTrack` rebuilds the whole Three.js Group (fresh `segmentIndex` tags), so
// it never preserves a selection highlight itself — every caller re-asserts
// the correct highlight afterward via `select(...)`, which is also the only
// thing that ever calls `viewport.setSelected` (previously `rerender` did
// too, with a stale pre-edit index a following `select` immediately
// overwrote — code review, ticket 08).
//
// `transformOnly` (code review, ticket 02) skips the full dispose+rebuild for
// a move/rotate — neither ever adds, removes, or reassigns the `moduleId` of
// any Segment, so the existing Three.js groups are still valid and only need
// their transform refreshed. Matters for the keyboard nudge's "held for
// repeat": OS key-repeat can fire many times a second, and a full Group
// teardown/rebuild per Segment on every one of those was visible jank on
// anything but a tiny Track.
const rerender = (transformOnly = false): void => {
  if (transformOnly) viewport.retransformSegments(history.track);
  else viewport.setTrack(MODULE_LIBRARY, history.track);
  undoButton.disabled = !history.canUndo;
  redoButton.disabled = !history.canRedo;
  setStatus(`${history.track.length} Segment(s)`);
};

/** Applies an edit and selects the resulting Segment in one step — the pattern every mutating action (insert/rotate/duplicate/delete/move) shares. */
const applyEdit = (next: Track, nextSelected: number | undefined, transformOnly = false): void => {
  history.apply(next);
  rerender(transformOnly);
  select(nextSelected);
};

// Module palette — one entry per Module in the library, each with its own
// live visual preview (ticket 04). Clicking inserts it right after the
// selected Segment, or appends at the end if nothing is selected.
for (const [moduleId, module] of Object.entries(MODULE_LIBRARY)) {
  const entry = document.createElement("div");
  entry.className = "module-entry";

  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 96;
  entry.appendChild(canvas);

  const label = document.createElement("span");
  label.textContent = moduleId;
  entry.appendChild(label);

  entry.addEventListener("click", () => {
    if (mode !== "edit") return;
    const insertAt = selectedIndex !== undefined ? selectedIndex + 1 : history.track.length;
    applyEdit(insertSegment(history.track, MODULE_LIBRARY, insertAt, moduleId), insertAt);
  });

  paletteList.appendChild(entry);
  previewRenders.push(createModulePreview(canvas, module));
}

// The inspector/browse overlays are DOM children of #viewport (positioned
// over the canvas) — stop their own clicks from reaching the viewport's
// click-to-pick listener below, rather than that listener trying to
// allowlist every overlay by identity (code review, ticket 08: a fragile
// `e.target !== editCanvas` check that a future new overlay could silently
// bypass).
inspector.addEventListener("click", (e) => e.stopPropagation());
browsePanel.addEventListener("click", (e) => e.stopPropagation());

// Click a placed Segment in the overview to select it; click empty space to
// deselect. A drag-to-orbit (OrbitControls) still fires a native `click` on
// mouseup at the drag's end point — only treat it as a pick if the pointer
// barely moved between press and release (code review, ticket 08).
const DRAG_THRESHOLD_PX = 5;
let pointerDownAt: { x: number; y: number } | undefined;
viewportContainer.addEventListener("pointerdown", (e) => {
  pointerDownAt = { x: e.clientX, y: e.clientY };
});
viewportContainer.addEventListener("click", (e) => {
  if (mode !== "edit") return;
  const moved = pointerDownAt ? Math.hypot(e.clientX - pointerDownAt.x, e.clientY - pointerDownAt.y) : 0;
  if (moved > DRAG_THRESHOLD_PX) return;
  const index = viewport.pick(e.clientX, e.clientY);
  select(index);
});

$("rotate-left").addEventListener("click", () => {
  if (selectedIndex === undefined) return;
  applyEdit(rotateSegment(history.track, MODULE_LIBRARY, selectedIndex, Math.PI / 2), selectedIndex, true);
});

$("rotate-right").addEventListener("click", () => {
  if (selectedIndex === undefined) return;
  applyEdit(rotateSegment(history.track, MODULE_LIBRARY, selectedIndex, -Math.PI / 2), selectedIndex, true);
});

// Which axis the keyboard rotate step (below) turns — the toolbar's ±90°
// buttons above stay yaw-only regardless, matching their established meaning.
let activeRotateAxis: RotateAxis = "yaw";
const setActiveAxis = (axis: RotateAxis): void => {
  activeRotateAxis = axis;
  for (const [a, button] of Object.entries(axisButtons)) button.classList.toggle("active", a === axis);
};
axisButtons.yaw.addEventListener("click", () => setActiveAxis("yaw"));
axisButtons.pitch.addEventListener("click", () => setActiveAxis("pitch"));
axisButtons.roll.addEventListener("click", () => setActiveAxis("roll"));

// Keyboard move/rotate (ticket 02): arrows + PageUp/PageDown nudge the
// selected Segment's position, [ ] rotate it on the active axis. Both use a
// two-tier step (ADR 0034) — Shift switches to the finer tier, never to a
// fully unconstrained value. Ignored while a toolbar text field has focus,
// so typing an id/name/URL doesn't hijack arrow keys.
const MOVE_STEP = 0.5;
const MOVE_STEP_FINE = 0.1;
const ROTATE_STEP = (15 * Math.PI) / 180;
const ROTATE_STEP_FINE = (5 * Math.PI) / 180;

const MOVE_DIRECTIONS: Record<string, Vec3> = {
  ArrowUp: { x: 0, y: 0, z: -1 },
  ArrowDown: { x: 0, y: 0, z: 1 },
  ArrowLeft: { x: -1, y: 0, z: 0 },
  ArrowRight: { x: 1, y: 0, z: 0 },
  PageUp: { x: 0, y: 1, z: 0 },
  PageDown: { x: 0, y: -1, z: 0 },
};

const isTypingTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");

window.addEventListener("keydown", (e) => {
  if (mode !== "edit" || selectedIndex === undefined || isTypingTarget(e.target)) return;

  const direction = MOVE_DIRECTIONS[e.code];
  if (direction) {
    e.preventDefault();
    const step = e.shiftKey ? MOVE_STEP_FINE : MOVE_STEP;
    const delta: Vec3 = { x: direction.x * step, y: direction.y * step, z: direction.z * step };
    applyEdit(moveSegment(history.track, MODULE_LIBRARY, selectedIndex, delta), selectedIndex, true);
    return;
  }

  if (e.code === "BracketLeft" || e.code === "BracketRight") {
    e.preventDefault();
    const step = e.shiftKey ? ROTATE_STEP_FINE : ROTATE_STEP;
    const signedStep = e.code === "BracketRight" ? step : -step;
    applyEdit(
      rotateSegment(history.track, MODULE_LIBRARY, selectedIndex, signedStep, activeRotateAxis),
      selectedIndex,
      true,
    );
  }
});

$("duplicate").addEventListener("click", () => {
  if (selectedIndex === undefined) return;
  applyEdit(duplicateSegment(history.track, MODULE_LIBRARY, selectedIndex), selectedIndex + 1);
});

$("delete").addEventListener("click", () => {
  if (selectedIndex === undefined) return;
  applyEdit(deleteSegment(history.track, MODULE_LIBRARY, selectedIndex), undefined);
});

$("remove-last").addEventListener("click", () => {
  if (history.track.length === 0) return;
  applyEdit(removeLast(history.track), undefined);
});

undoButton.addEventListener("click", () => {
  history.undo();
  rerender();
  select(undefined);
});

redoButton.addEventListener("click", () => {
  history.redo();
  rerender();
  select(undefined);
});

$("save").addEventListener("click", () => {
  void (async () => {
    try {
      const { id } = await saveTrack(serviceUrlInput.value, trackNameInput.value.trim(), history.track);
      trackIdInput.value = id;
      setStatus(`saved as "${id}"`);
    } catch (err) {
      setStatus(`save failed: ${(err as Error).message}`);
    }
  })();
});

const loadById = async (id: string): Promise<void> => {
  try {
    const stored = await loadTrack(serviceUrlInput.value, id);
    history.reset(stored.track);
    trackNameInput.value = stored.name ?? "";
    trackIdInput.value = stored.id;
    rerender();
    select(undefined);
    setStatus(`loaded "${stored.id}" (${history.track.length} Segment(s))`);
  } catch (err) {
    setStatus(`load failed: ${(err as Error).message}`);
  }
};

$("load").addEventListener("click", () => {
  void loadById(trackIdInput.value.trim() || "m1-playground");
});

// Browse (ticket 09) — fetch-by-known-id-only isn't a real "share" mechanism
// once there are multiple user-created Tracks; this lists what track-service
// actually has instead of requiring a typed-in id.
$("browse-toggle").addEventListener("click", () => {
  if (!browsePanel.hidden) {
    browsePanel.hidden = true;
    return;
  }
  void (async () => {
    try {
      const tracks = await listTracks(serviceUrlInput.value);
      // A pending fetch can resolve after Playtest started (and force-closed
      // this panel) — don't let a stale response reopen it over a running
      // playtest (code review, ticket 09).
      if (mode !== "edit") return;
      browseList.replaceChildren();
      for (const t of tracks) {
        const row = document.createElement("div");
        row.className = "track-entry";

        const name = document.createElement("span");
        name.className = "name";
        name.textContent = t.name ?? "(untitled)";
        row.appendChild(name);

        const id = document.createElement("span");
        id.className = "id";
        id.textContent = t.id;
        row.appendChild(id);

        row.addEventListener("click", () => {
          browsePanel.hidden = true;
          void loadById(t.id);
        });
        browseList.appendChild(row);
      }
      browsePanel.hidden = false;
    } catch (err) {
      setStatus(`browse failed: ${(err as Error).message}`);
    }
  })();
});

// Local single-player playtest (ticket 05) — the same shared Rapier sim the
// live game runs, no networking, no auth. Toggles the viewport between the
// edit overview and a walkable version of the in-progress Track.
playtestButton.addEventListener("click", () => {
  if (mode === "edit") {
    if (history.track.length === 0) {
      setStatus("cannot playtest an empty Track — place a Module first");
      return;
    }
    void (async () => {
      editCanvas.style.display = "none";
      inspector.hidden = true;
      browsePanel.hidden = true;
      mode = "playtest";
      playtestButton.textContent = "Stop playtest";
      setStatus("playtest — WASD move · Space jump · Shift dash");
      playtest = await startPlaytest(viewportContainer, MODULE_LIBRARY, history.track);
    })();
  } else {
    playtest?.dispose();
    playtest = undefined;
    editCanvas.style.display = "";
    mode = "edit";
    playtestButton.textContent = "Playtest";
    rerender();
  }
});

rerender();

const frame = (nowMs: number): void => {
  if (mode === "edit") {
    for (const render of previewRenders) render();
    viewport.render();
  } else {
    playtest?.frame(nowMs);
  }
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
