import {
  AUTHORED_TRACKS,
  BOUNCE_TEXTURE_FILE,
  DEFAULT_ENVIRONMENT_ID,
  ENVIRONMENT_PRESETS,
  ICE_TEXTURE_FILE,
} from "@dont-fall/shared";
import { loadDeckTexture } from "@dont-fall/render";
import { builderLibrary, loadAssetVisuals } from "../assets/assets.js";
import { createTrackViewport } from "../scene/viewport.js";
import { THUMBNAIL_FRAMES } from "./frames.js";

/**
 * One authored Track, drawn as the builder's capture mode draws a save (ADR
 * 0085): its Environment, Motions posed, Impact tints lit, no authoring
 * overlay, framed from `THUMBNAIL_FRAMES` (ADR 0105). `pnpm render:thumbnails`
 * opens this page, waits for `window.dontFallThumbnail.ready`, and takes
 * `capture()`, the same 1280×720 JPEG data URL a builder save stores.
 *
 * `?track=<authored id>`, and `?assets=<base URL>` for the GLBs and deck
 * textures (the API's `/assets` by default).
 */
interface ThumbnailPage {
  ready: boolean;
  error?: string;
  capture?: () => string | undefined;
}

declare global {
  interface Window {
    dontFallThumbnail: ThumbnailPage;
  }
}

const page: ThumbnailPage = { ready: false };
window.dontFallThumbnail = page;

const fetchBytes = async (url: string): Promise<Uint8Array> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} answered ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
};

const draw = async (): Promise<void> => {
  const params = new URLSearchParams(location.search);
  const id = params.get("track");
  const assets = params.get("assets") ?? "http://localhost:8081/assets";
  const authored = AUTHORED_TRACKS.find((candidate) => candidate.id === id);
  if (!authored) throw new Error(`no authored Track "${id}" — have ${AUTHORED_TRACKS.map((a) => a.id).join(", ")}`);
  const frame = THUMBNAIL_FRAMES[authored.id];
  if (!frame) throw new Error(`no THUMBNAIL_FRAMES entry for "${authored.id}"`);

  const moduleIds = [...new Set(authored.track.map((segment) => segment.moduleId))];
  const [parsed, ice, bounce] = await Promise.all([
    loadAssetVisuals(fetchBytes, assets, moduleIds),
    loadDeckTexture(fetchBytes, assets, ICE_TEXTURE_FILE),
    loadDeckTexture(fetchBytes, assets, BOUNCE_TEXTURE_FILE),
  ]);
  const templates = Object.fromEntries(Object.entries(parsed).map(([moduleId, asset]) => [moduleId, asset.template]));
  const deckPlans = Object.fromEntries(Object.entries(parsed).map(([moduleId, asset]) => [moduleId, asset.plan]));

  const viewport = createTrackViewport(document.getElementById("view")!, () => {});
  viewport.setEnvironment(ENVIRONMENT_PRESETS[authored.environment ?? DEFAULT_ENVIRONMENT_ID]);
  viewport.setTrack(builderLibrary(), authored.track, templates, { ice, bounce }, deckPlans);
  viewport.setCourseVisible(false);
  viewport.setMotionTime(frame.tick ?? 0);
  viewport.setView(frame);
  viewport.render();

  page.capture = () => viewport.capturePreview();
  page.ready = true;
};

draw().catch((err: unknown) => {
  page.error = err instanceof Error ? err.message : String(err);
});
