import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TrackApi } from "./api.js";
import { registerDiscoveryTools } from "./tools/discovery.js";
import { registerDraftTools } from "./tools/drafts.js";
import { registerMechanicsTools } from "./tools/mechanics.js";
import { registerPublishTools } from "./tools/publish.js";
import { registerScreenshotTools, type ScreenshotDeps } from "./tools/screenshot.js";
import { registerSugarTools } from "./tools/sugar.js";
import { registerValidateTools } from "./tools/validate.js";

/**
 * The track-builder MCP server (ADR 0114): stdio, tools-only, no
 * client-specific features — any MCP client drives it. A thin client over
 * the track API for stored data (Tracks, drafts) plus the version-locked
 * `@dont-fall/shared` registry for discovery. `screenshot` carries the
 * headless renderer (tests stub it; production shells Chrome).
 */
export const createMcpServer = (api: TrackApi, screenshot?: ScreenshotDeps): McpServer => {
  const server = new McpServer({ name: "dont-fall-track-builder", version: "0.0.0" });
  registerDiscoveryTools(server, api);
  registerMechanicsTools(server);
  registerDraftTools(server, api);
  registerSugarTools(server, api);
  registerValidateTools(server, api);
  registerPublishTools(server, api);
  registerScreenshotTools(server, api, screenshot);
  return server;
};
