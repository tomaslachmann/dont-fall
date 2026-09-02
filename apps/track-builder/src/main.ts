import { MODULE_LIBRARY, type Track } from "@dont-fall/shared";
import { loadTrack, saveTrack } from "./api.js";
import { appendModule, removeLast } from "./trackState.js";
import { createModulePreview, createTrackViewport } from "./viewport.js";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const paletteList = $("palette-list");
const serviceUrlInput = $<HTMLInputElement>("service-url");
const trackNameInput = $<HTMLInputElement>("track-name");
const trackIdInput = $<HTMLInputElement>("track-id");
const statusEl = $("status");

let currentTrack: Track = [];
const previewRenders: (() => void)[] = [];

const viewport = createTrackViewport(document.getElementById("viewport")!);

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
    currentTrack = appendModule(currentTrack, moduleId);
    rerender();
  });

  paletteList.appendChild(entry);
  previewRenders.push(createModulePreview(canvas, module));
}

$("remove-last").addEventListener("click", () => {
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

rerender();

const frame = (): void => {
  for (const render of previewRenders) render();
  viewport.render();
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
