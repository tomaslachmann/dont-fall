import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { startApi, type ApiService } from "@dont-fall/api";
import { afterEach, beforeEach } from "vitest";
import { createTrackApi } from "../api.js";
import { createMcpServer } from "../server.js";
import type { ScreenshotDeps } from "../tools/screenshot.js";

/**
 * One MCP session over the real protocol (in-memory client↔server pair)
 * against a real API over real HTTP — every tool test drives the composition
 * a client session will: tools → API → SQLite. Registers its own
 * setup/teardown on import; a suite only declares `let h: Harness`.
 * `screenshot` stubs the headless renderer (real Chrome never boots in a
 * test); `callRaw` reads non-JSON answers (the screenshot's image block).
 */
export interface Harness {
  call: (name: string, args?: Record<string, unknown>) => Promise<{ json: any; isError: boolean }>;
  callRaw: (name: string, args?: Record<string, unknown>) => Promise<Awaited<ReturnType<Client["callTool"]>>>;
}

export const harness = (screenshot?: ScreenshotDeps): { current: Harness } => {
  const box: { current: Harness } = {
    current: {
      call: async () => ({ json: null, isError: true }),
      callRaw: async () => ({ content: [] }),
    },
  };
  let dir = "";
  let api: ApiService | null = null;
  let client: Client | null = null;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "mcp-test-"));
    api = await startApi({ port: 0, host: "127.0.0.1", dbPath: join(dir, "test.sqlite") });
    const server = createMcpServer(createTrackApi(`http://127.0.0.1:${api.port}`), screenshot);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    const held = client;
    box.current = {
      callRaw: (name: string, args: Record<string, unknown> = {}) => held.callTool({ name, arguments: args }),
      // Never throws for an error: a protocol rejection and a non-JSON text
      // payload (the SDK's own arg-validation refusal) both arrive as
      // `{ error }` with `isError` — success paths still assert `false`, so
      // nothing failing can read as passing.
      call: async (name: string, args: Record<string, unknown> = {}) => {
        let result: Awaited<ReturnType<Client["callTool"]>>;
        try {
          result = await held.callTool({ name, arguments: args });
        } catch (err) {
          return { json: { error: (err as Error).message }, isError: true };
        }
        const text = (result.content as { type: string; text?: string }[])[0]!;
        if (text.type !== "text" || text.text === undefined) {
          return { json: { error: `${name} answered no text payload` }, isError: true };
        }
        try {
          return { json: JSON.parse(text.text), isError: result.isError === true };
        } catch {
          return { json: { error: text.text }, isError: true };
        }
      },
    };
  });

  afterEach(async () => {
    await client?.close();
    await api?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  return box;
};
