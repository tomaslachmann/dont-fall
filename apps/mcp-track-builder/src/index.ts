import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createTrackApi } from "./api.js";
import { createMcpServer } from "./server.js";
import { screenshotDepsFromEnv } from "./tools/screenshot.js";

/**
 * stdio entry: one server per client session. `TRACK_API_URL` points at the
 * always-on API (default localhost:8081) — drafts live there (ADR 0114, D9),
 * so unfinished work survives these restarts. `screenshot_draft` additionally
 * wants the builder's dev server (`THUMBNAIL_PAGE_URL`) and headless Chrome
 * (`CHROME_PATH`) — without them that one tool answers how to set it up.
 * stdout is the protocol: all logging goes to stderr.
 */
const apiUrl = process.env.TRACK_API_URL ?? "http://localhost:8081";
const server = createMcpServer(createTrackApi(apiUrl), screenshotDepsFromEnv(apiUrl));
await server.connect(new StdioServerTransport());
console.error(`mcp-track-builder: serving stdio over ${apiUrl}`);
