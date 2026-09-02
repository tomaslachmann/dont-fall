import { MODULE_LIBRARY, type Track } from "@dont-fall/shared";
import { loadTrack, saveTrack } from "./api.js";
import { startPlaytest, type Playtest } from "./playtest.js";
import { appendModule, removeLast } from "./trackState.js";
import { createModulePreview, createTrackViewport } from "./viewport.js";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const paletteList = $("palette-list");
const serviceUrlInput = $<HTMLInputElement>("service-url");
const trackNameInput = $<HTMLInputElement>("track-name");
const trackIdInput = $<HTMLInputElement>("track-id");
const statusEl = $("status");
const playtestButton = $("playtest");
const viewportContainer = $("viewport");

let currentTrack: Track = [];
const previewRenders: (() => void)[] = [];

const viewport = createTrackViewport(viewportContainer);
// The edit viewport's own canvas is the only child right now — hidden/shown
// when toggling playtest mode (ticket 05), never recreated.
const editCanvas = viewportContainer.querySelector("canvas")!;

let mode: "edit" | "playtest" = "edit";
let playtest: Playtest | undefined;

const setStatus = (text: string): void => {
  statusEl.textContent = text;
};

const rerender = (): void => {
  viewport.setTrack(MODULE_LIBRARY, currentTrack);
  setStatus(`${currentTrack.length} Segment(s)`);
};

// Module palette — one entry per Module in the library, each with its own
// live visual preview (ticket 04). Clicking appends it to the Track.
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
    currentTrack = appendModule(currentTrack, moduleId, MODULE_LIBRARY);
    rerender();
  });

  paletteList.appendChild(entry);
  previewRenders.push(createModulePreview(canvas, module));
}

$("remove-last").addEventListener("click", () => {
  if (mode !== "edit") return;
  currentTrack = removeLast(currentTrack);
  rerender();
});

$("save").addEventListener("click", () => {
  void (async () => {
    try {
      const { id } = await saveTrack(serviceUrlInput.value, trackNameInput.value.trim(), currentTrack);
      trackIdInput.value = id;
      setStatus(`saved as "${id}"`);
    } catch (err) {
      setStatus(`save failed: ${(err as Error).message}`);
    }
  })();
});

$("load").addEventListener("click", () => {
  void (async () => {
    try {
      const stored = await loadTrack(serviceUrlInput.value, trackIdInput.value.trim() || "m1-playground");
      currentTrack = stored.track;
      trackNameInput.value = stored.name ?? "";
      rerender();
      setStatus(`loaded "${stored.id}" (${currentTrack.length} Segment(s))`);
    } catch (err) {
      setStatus(`load failed: ${(err as Error).message}`);
    }
  })();
});

// Local single-player playtest (ticket 05) — the same shared Rapier sim the
// live game runs, no networking, no auth. Toggles the viewport between the
// edit overview and a walkable version of the in-progress Track.
playtestButton.addEventListener("click", () => {
  if (mode === "edit") {
    if (currentTrack.length === 0) {
      setStatus("cannot playtest an empty Track — place a Module first");
      return;
    }
    void (async () => {
      editCanvas.style.display = "none";
      mode = "playtest";
      playtestButton.textContent = "Stop playtest";
      setStatus("playtest — WASD move · Space jump · Shift dash");
      playtest = await startPlaytest(viewportContainer, MODULE_LIBRARY, currentTrack);
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
