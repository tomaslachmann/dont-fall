import { MODULE_LIBRARY, type Track } from "@dont-fall/shared";
import { listTracks, loadTrack, saveTrack } from "./api.js";
import { startPlaytest, type Playtest } from "./playtest.js";
import { deleteSegment, duplicateSegment, insertSegment, rotateSegment } from "./trackEdit.js";
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
    inspectorLabel.textContent = `#${selectedIndex} ${history.track[selectedIndex]!.moduleId}`;
  }
};

const rerender = (): void => {
  viewport.setTrack(MODULE_LIBRARY, history.track);
  viewport.setSelected(selectedIndex);
  undoButton.disabled = !history.canUndo;
  redoButton.disabled = !history.canRedo;
  setStatus(`${history.track.length} Segment(s)`);
};

const applyEdit = (next: Track): void => {
  history.apply(next);
  rerender();
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
    applyEdit(insertSegment(history.track, MODULE_LIBRARY, insertAt, moduleId));
    select(insertAt);
  });

  paletteList.appendChild(entry);
  previewRenders.push(createModulePreview(canvas, module));
}

// Click a placed Segment in the overview to select it; click empty space to
// deselect. The inspector panel is a DOM child of #viewport (positioned over
// the canvas) — its own button clicks bubble up here too, so ignore anything
// that didn't land on the canvas itself.
viewportContainer.addEventListener("click", (e) => {
  if (mode !== "edit") return;
  if (e.target !== editCanvas) return;
  const index = viewport.pick(e.clientX, e.clientY);
  select(index);
});

$("rotate-left").addEventListener("click", () => {
  if (selectedIndex === undefined) return;
  applyEdit(rotateSegment(history.track, MODULE_LIBRARY, selectedIndex, Math.PI / 2));
  select(selectedIndex);
});

$("rotate-right").addEventListener("click", () => {
  if (selectedIndex === undefined) return;
  applyEdit(rotateSegment(history.track, MODULE_LIBRARY, selectedIndex, -Math.PI / 2));
  select(selectedIndex);
});

$("duplicate").addEventListener("click", () => {
  if (selectedIndex === undefined) return;
  const duplicatedAt = selectedIndex + 1;
  applyEdit(duplicateSegment(history.track, MODULE_LIBRARY, selectedIndex));
  select(duplicatedAt);
});

$("delete").addEventListener("click", () => {
  if (selectedIndex === undefined) return;
  applyEdit(deleteSegment(history.track, MODULE_LIBRARY, selectedIndex));
  select(undefined);
});

undoButton.addEventListener("click", () => {
  history.undo();
  select(undefined);
  rerender();
});

redoButton.addEventListener("click", () => {
  history.redo();
  select(undefined);
  rerender();
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
    select(undefined);
    rerender();
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
