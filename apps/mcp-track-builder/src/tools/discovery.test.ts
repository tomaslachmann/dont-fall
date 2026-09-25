import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ASSET_MODULE_DEFS, assetPaletteIds, canonicalPaletteId, BASE_RACE_TRACK_ID } from "@dont-fall/shared";
import { startApi, type ApiService } from "@dont-fall/api";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTrackApi } from "../api.js";
import { createMcpServer } from "../server.js";

/**
 * Discovery over the real protocol (in-memory client↔server pair) against a
 * real API over real HTTP — the tools compose exactly as a client session
 * will drive them: categories → modules → full defs, then stored tracks.
 */
let dir: string;
let api: ApiService;
let client: Client;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "mcp-test-"));
  api = await startApi({ port: 0, host: "127.0.0.1", dbPath: join(dir, "test.sqlite") });
  const server = createMcpServer(createTrackApi(`http://127.0.0.1:${api.port}`));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
});

afterEach(async () => {
  await client.close();
  await api.close();
  rmSync(dir, { recursive: true, force: true });
});

const call = async (name: string, args: Record<string, unknown> = {}): Promise<{ json: any; isError: boolean }> => {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { type: string; text: string }[])[0]!.text;
  return { json: JSON.parse(text), isError: result.isError === true };
};

describe("discovery", () => {
  it("walks categories → modules → full def, staged", async () => {
    const categories = await call("list_categories");
    expect(categories.isError).toBe(false);
    expect(categories.json.categories.map((c: { id: string }) => c.id)).toEqual([
      "floor",
      "structure",
      "sweeper",
      "launcher",
      "gate",
      "prop",
      "scenery",
    ]);
    // Shapes, not files: the counts match what list_modules lists (ADR 0113 —
    // color is an Attachment), so they come in under the registry's file count.
    const shapes = categories.json.categories.reduce((n: number, c: { moduleCount: number }) => n + c.moduleCount, 0);
    expect(shapes).toBe(assetPaletteIds().length);
    expect(shapes).toBeLessThan(ASSET_MODULE_DEFS.length);

    const modules = await call("list_modules", { category: "floor", limit: 2 });
    expect(modules.json.items).toHaveLength(2);
    expect(modules.json.total).toBeGreaterThan(2);
    expect(Object.keys(modules.json.items[0]).sort()).toEqual([
      "id",
      "paintable",
      "shape",
      "size",
      "sockets",
      "top",
    ]);

    // A family lists once, under its canonical: the LLM never sees the same
    // shape four times, and a lone `_blue` (the quarter pack, no family) still
    // lists as itself.
    const floors = await call("list_modules", { category: "floor", limit: 200 });
    const listed = floors.json.items as { id: string; shape: string; paintable: boolean }[];
    for (const m of listed) expect(m.id).toBe(canonicalPaletteId(m.id));
    expect(listed.map((m) => m.id)).not.toContain("kaykit_platform_6x6x1_blue");
    // A shape whose colorless twin is its own file lists twice — same
    // geometry, different art — and `paintable` is what tells them apart.
    // A barrier is Structure, not Floor (ADR 0122): it walls the route in.
    const structure = await call("list_modules", { category: "structure", limit: 200 });
    const barriers = (structure.json.items as typeof listed).filter((m) => m.shape === "kaykit_barrier_1x1x1");
    expect(barriers.map((m) => [m.id, m.paintable])).toEqual([
      ["kaykit_barrier_1x1x1", false],
      ["kaykit_barrier_1x1x1_red", true],
    ]);
    expect(listed.find((m) => m.id === "kaykit_platform_6x6x1_red")).toMatchObject({
      shape: "kaykit_platform_6x6x1",
      paintable: true,
    });

    const full = await call("get_module", { id: "kaykit_platform_6x6x1_red" });
    expect(full.json.footprint.bounds).toBeDefined();
    expect(full.json.sockets).toBeDefined();
    expect(full.json.family).toEqual({
      stem: "kaykit_platform_6x6x1",
      color: "red",
      canonicalId: "kaykit_platform_6x6x1_red",
    });
  });

  it("lists the legacy procedural modules apart, and errors unknown ids loudly", async () => {
    const procedural = await call("list_procedural_modules");
    expect(procedural.json.modules).toHaveLength(10);
    expect(procedural.json.modules.every((m: { legacy: boolean }) => m.legacy)).toBe(true);

    const unknown = await call("get_module", { id: "nope" });
    expect(unknown.isError).toBe(true);
    expect(unknown.json).toMatchObject({});
  });

  it("references every attachment with its storable shape", async () => {
    const attachments = await call("list_attachments");
    expect(Object.keys(attachments.json).sort()).toEqual([
      "bomb",
      "bounce",
      "checkpoint",
      "color",
      "conveyor",
      "fragile",
      "ice",
      "launch",
      "motion",
      "mud",
      "partMotions",
      "prop",
      "punch",
      "shooter",
      "start",
      "trapdoor",
    ]);
    expect(attachments.json.motion.value).toMatch(/spin.*swing.*slide.*ramp/s);
    expect(attachments.json.partMotions.value).toMatch(/sweeper_3arms/);
    expect(attachments.json.color.value).toMatch(/pink/);
  });

  it("reads stored tracks paged, pinned or latest", async () => {
    const tracks = await call("list_tracks");
    expect(tracks.json.tracks.map((t: { id: string }) => t.id)).toContain(BASE_RACE_TRACK_ID);

    const first = await call("get_track", { id: BASE_RACE_TRACK_ID, limit: 5 });
    expect(first.json.segments.items).toHaveLength(5);
    expect(first.json.segments.total).toBeGreaterThan(5);
    expect(first.json.revision).toBe(1);

    const pinned = await call("get_track", { id: BASE_RACE_TRACK_ID, revision: 1, limit: 1 });
    expect(pinned.json.revision).toBe(1);

    const missing = await call("get_track", { id: "ghost" });
    expect(missing.isError).toBe(true);
  });
});
