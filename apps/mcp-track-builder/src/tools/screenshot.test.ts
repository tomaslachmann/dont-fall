import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { TRACK_THUMBNAIL_DATA_URL_PREFIX, TRACK_THUMBNAIL_MIME } from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import { createTrackApi } from "../api.js";
import { createMcpServer } from "../server.js";
import { harness } from "../test/harness.js";

/**
 * The visual backstop over the real protocol against a real API — with the
 * headless renderer stubbed (real Chrome never boots in a test): the tool
 * answers the JPEG as an image block plus a caption, fails a typo'd id
 * before rendering, and without deps answers how to set it up.
 */
const STILL = `${TRACK_THUMBNAIL_DATA_URL_PREFIX}/9j/4AAQSkZJRg==`;
let rendered = 0;
let lastOpts: { navmesh?: boolean } | undefined;
const h = harness({
  render: async (_draftId: string, opts?: { navmesh?: boolean }) => {
    rendered += 1;
    lastOpts = opts;
    return STILL;
  },
});

describe("screenshot_draft", () => {
  it("answers the render as an image block with a caption", async () => {
    rendered = 0;
    const draftId = (
      await h.current.call("create_draft", {
        roundType: "survival",
        track: [{ moduleId: "kaykit_platform_6x6x1_red", position: { x: 0, y: 0, z: 0 }, rotation: 0 }],
      })
    ).json.id as string;
    const shot = await h.current.callRaw("screenshot_draft", { draftId });
    expect(shot.isError).not.toBe(true);
    expect(rendered).toBe(1);
    const [image, caption] = shot.content as [
      { type: string; data: string; mimeType: string },
      { type: string; text: string },
    ];
    expect(image.type).toBe("image");
    expect(image.mimeType).toBe(TRACK_THUMBNAIL_MIME);
    expect(image.data).toBe("/9j/4AAQSkZJRg==");
    expect(caption.type).toBe("text");
    expect(caption.text).toMatch(/1 Segments, survival/);
  });

  it("is off by default, and threads a `navmesh: true` ask to the renderer (M17 ticket 02)", async () => {
    const draftId = (
      await h.current.call("create_draft", {
        roundType: "survival",
        track: [{ moduleId: "kaykit_platform_6x6x1_red", position: { x: 0, y: 0, z: 0 }, rotation: 0 }],
      })
    ).json.id as string;

    await h.current.callRaw("screenshot_draft", { draftId });
    expect(lastOpts?.navmesh).toBeUndefined();

    const withNav = await h.current.callRaw("screenshot_draft", { draftId, navmesh: true });
    expect(lastOpts?.navmesh).toBe(true);
    const caption = (withNav.content as { type: string; text: string }[])[1]!;
    expect(caption.text).toMatch(/NAVMESH overlay on/);
  });

  it("fails a typo'd id before rendering anything", async () => {
    rendered = 0;
    const missing = await h.current.call("screenshot_draft", { draftId: "ghost" });
    expect(missing.isError).toBe(true);
    expect(missing.json.error).toMatch(/no draft with id "ghost"/);
    expect(rendered).toBe(0);
  });

  it("without a renderer answers how to set one up", async () => {
    const server = createMcpServer(createTrackApi("http://127.0.0.1:1"));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    try {
      const shot = await client.callTool({ name: "screenshot_draft", arguments: { draftId: "whatever" } });
      expect(shot.isError).toBe(true);
      const text = (shot.content as { type: string; text: string }[])[0]!.text;
      expect(JSON.parse(text).error).toMatch(/CHROME_PATH/);
    } finally {
      await client.close();
    }
  });
});
