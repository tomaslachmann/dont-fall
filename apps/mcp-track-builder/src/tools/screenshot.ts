import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TRACK_THUMBNAIL_DATA_URL_PREFIX, TRACK_THUMBNAIL_MIME, type TrackDraft } from "@dont-fall/shared";
import { z } from "zod";
import type { TrackApi } from "../api.js";
import { createChromeRenderer } from "../screenshot/chrome.js";

/**
 * The visual backstop (ADR 0114, D10): renders the draft through the
 * thumbnail page's own machinery and hands the JPEG to the LLM as an image —
 * the one tool that answers in pixels rather than JSON. Needs the builder's
 * dev server (it serves the page) and headless Chrome; without them the tool
 * stays listed and answers how to set it up.
 */

/** Renders a draft to its JPEG data URL — Chrome in production, a stub in tests. */
export interface ScreenshotDeps {
  render: (draftId: string) => Promise<string>;
}

export const DEFAULT_THUMBNAIL_PAGE_URL = "http://localhost:5174/thumbnail.html";
export const DEFAULT_CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const SCREENSHOT_TIMEOUT_MS = 120_000;

/** Production deps from the environment — the same API base the tools use, the builder's page, Chrome. */
export const screenshotDepsFromEnv = (apiUrl: string): ScreenshotDeps => ({
  render: createChromeRenderer({
    pageUrl: process.env.THUMBNAIL_PAGE_URL ?? DEFAULT_THUMBNAIL_PAGE_URL,
    apiUrl,
    chromePath: process.env.CHROME_PATH ?? DEFAULT_CHROME_PATH,
    timeoutMs: SCREENSHOT_TIMEOUT_MS,
  }),
});

const SETUP_HINT =
  "screenshot rendering is not set up: run the API this server points at, serve the thumbnail page " +
  "(`pnpm --filter @dont-fall/track-builder dev`, then THUMBNAIL_PAGE_URL if it is not " +
  `${DEFAULT_THUMBNAIL_PAGE_URL}), and point CHROME_PATH at headless Chrome (default ${DEFAULT_CHROME_PATH}).`;

export const registerScreenshotTools = (server: McpServer, api: TrackApi, deps?: ScreenshotDeps): void => {
  server.tool(
    "screenshot_draft",
    "Render the draft as the builder's capture sees it (its Environment, Motions posed mid-swing, auto-framed) and look at the JPEG. The visual backstop beside validate_draft — a long Race reads as an overview.",
    { draftId: z.string().min(1).describe("Draft id from create_draft (or list_drafts to resume).") },
    async ({ draftId }) => {
      if (!deps) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: SETUP_HINT }) }], isError: true };
      }
      try {
        // The draft is read first so a typo'd id fails naming the miss before Chrome boots.
        const draft = await api.get<TrackDraft>(`/drafts/${draftId}`);
        const dataUrl = await deps.render(draftId);
        const caption =
          `draft "${draftId}" (${draft.track.length} Segments, ${draft.roundType}) as the builder's capture sees it — ` +
          "check placements, gaps and overlaps against what was meant.";
        return {
          content: [
            {
              type: "image" as const,
              data: dataUrl.startsWith(TRACK_THUMBNAIL_DATA_URL_PREFIX)
                ? dataUrl.slice(TRACK_THUMBNAIL_DATA_URL_PREFIX.length)
                : dataUrl,
              mimeType: TRACK_THUMBNAIL_MIME,
            },
            { type: "text" as const, text: caption },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: (err as Error).message }) }],
          isError: true,
        };
      }
    },
  );
};
