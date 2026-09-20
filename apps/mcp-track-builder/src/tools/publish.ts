import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { StoredTrack, TrackDraft } from "@dont-fall/shared";
import { z } from "zod";
import type { TrackApi } from "../api.js";
import { jsonTool } from "../tools.js";
import { validateTrackForRound } from "./validate.js";

/**
 * Free publish (ADR 0114, D7): a valid draft becomes a Revision — a new Track
 * id, or a new Revision of an existing one. The gate runs first (the same
 * verdict `validate_draft` reports), then the draft's Segments and publish
 * metadata are copied into `POST /tracks`, which re-checks everything from
 * its side. No confirmation, no thumbnail (framing one is the builder's
 * capture, not this tool's) — revisions are cheap and the draft survives to
 * publish again.
 */
export const registerPublishTools = (server: McpServer, api: TrackApi): void => {
  jsonTool(
    server,
    "publish_draft",
    "Publish a draft as a Track Revision: invalid drafts refuse with validate's own errors, valid ones land ready to open in the builder or play.",
    {
      draftId: z.string().min(1).describe("Draft id from create_draft (or list_drafts to resume)."),
      trackId: z
        .string()
        .min(1)
        .optional()
        .describe("Track id to publish under — an existing id writes a new Revision of it. Defaults to the draft's own id."),
      name: z.string().optional().describe("Display name; defaults to the draft's."),
    },
    async ({ draftId, trackId, name }) => {
      const draft = await api.get<TrackDraft>(`/drafts/${draftId}`);
      const verdict = validateTrackForRound(draft.track, draft.roundType);
      if (!verdict.valid) {
        throw new Error(`draft "${draftId}" is not publishable:\n- ${verdict.errors.join("\n- ")}`);
      }
      const id = trackId ?? draftId;
      const publishedName = name ?? draft.name;
      await api.post<{ id: string }>("/tracks", {
        id,
        ...(publishedName === null ? {} : { name: publishedName }),
        track: draft.track,
        timeLimitMs: draft.timeLimitMs,
        survivorTarget: draft.survivorTarget,
        environment: draft.environment,
      });
      const stored = await api.get<StoredTrack>(`/tracks/${id}`);
      return { trackId: stored.id, revision: stored.revision, name: stored.name, warnings: verdict.warnings };
    },
  );
};
