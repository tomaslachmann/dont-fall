import {
  AUTHORED_TRACKS,
  BOUNCE_TEXTURE_FILE,
  DEFAULT_ENVIRONMENT_ID,
  ENVIRONMENT_PRESETS,
  type EnvironmentId,
  type Track,
  type TrackDraft,
} from "@dont-fall/shared";
import { loadDeckTexture } from "@dont-fall/render";
import { builderLibrary, loadAssetVisuals } from "../assets/assets.js";
import { createTrackViewport } from "../scene/viewport.js";
import { frameTrackAuto, THUMBNAIL_FRAMES, type ThumbnailFrame } from "./frames.js";

/**
 * One Track, drawn as the builder's capture mode draws a save (ADR 0085):
 * its Environment, Motions posed, Impact tints lit, no authoring overlay.
 * `pnpm render:thumbnails` opens this page per authored Track, waits for
 * `window.dontFallThumbnail.ready`, and takes `capture()`, the same 1280×720
 * JPEG data URL a builder save stores.
 *
 * `?track=<authored id>` frames from `THUMBNAIL_FRAMES` (ADR 0105);
 * `?draft=<draft id>&api=<base URL>` (ADR 0114, D10) fetches the draft from
 * the API and auto-frames it — the MCP server's visual backstop.
 * `?assets=<base URL>` carries the GLBs and deck textures (the API's
 * `/assets` by default).
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

interface DrawSource {
  track: Track;
  environment: EnvironmentId;
  frame: ThumbnailFrame;
}

const authoredSource = (id: string | null): DrawSource => {
  const authored = AUTHORED_TRACKS.find((candidate) => candidate.id === id);
  if (!authored) throw new Error(`no authored Track "${id}" — have ${AUTHORED_TRACKS.map((a) => a.id).join(", ")}`);
  const frame = THUMBNAIL_FRAMES[authored.id];
  if (!frame) throw new Error(`no THUMBNAIL_FRAMES entry for "${authored.id}"`);
  return { track: authored.track, environment: authored.environment ?? DEFAULT_ENVIRONMENT_ID, frame };
};

const draftSource = async (draftId: string, api: string): Promise<DrawSource> => {
  const res = await fetch(`${api}/drafts/${draftId}`);
  if (!res.ok) throw new Error(`GET ${api}/drafts/${draftId} answered ${res.status}`);
  const draft = (await res.json()) as TrackDraft;
  return { track: draft.track, environment: draft.environment, frame: frameTrackAuto(draft.track) };
};

const draw = async (): Promise<void> => {
  const params = new URLSearchParams(location.search);
  const assets = params.get("assets") ?? "http://localhost:8081/assets";
  const draftId = params.get("draft");
  const source =
    draftId === null
      ? authoredSource(params.get("track"))
      : await draftSource(draftId, params.get("api") ?? "http://localhost:8081");

  const moduleIds = [...new Set(source.track.map((segment) => segment.moduleId))];
  const [parsed, bounce] = await Promise.all([
    loadAssetVisuals(fetchBytes, assets, moduleIds),
    loadDeckTexture(fetchBytes, assets, BOUNCE_TEXTURE_FILE),
  ]);
  const templates = Object.fromEntries(Object.entries(parsed).map(([moduleId, asset]) => [moduleId, asset.template]));
  const deckPlans = Object.fromEntries(Object.entries(parsed).map(([moduleId, asset]) => [moduleId, asset.plan]));

  const viewport = createTrackViewport(document.getElementById("view")!, () => {});
  viewport.setEnvironment(ENVIRONMENT_PRESETS[source.environment]);
  viewport.setTrack(builderLibrary(), source.track, templates, { bounce }, deckPlans);
  viewport.setCourseVisible(false);
  viewport.setMotionTime(source.frame.tick ?? 0);
  viewport.setView(source.frame);
  viewport.render();

  page.capture = () => viewport.capturePreview();
  page.ready = true;
};

draw().catch((err: unknown) => {
  page.error = err instanceof Error ? err.message : String(err);
});
