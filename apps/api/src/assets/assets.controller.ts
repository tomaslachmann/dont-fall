import type { FastifyInstance } from "fastify";
import { parseAssetFileName, readAssetFile } from "./assets.service.js";

/**
 * Served Module art (M8 ticket 02, ADR 0050 as amended) — the one pipe every
 * loader fetches GLB bytes through. Floating revisions, binary body, exact
 * bytes; a missing file is a 404 naming it, never an HTML error page a GLB
 * parser would choke on downstream.
 */
export const registerAssetRoutes = (app: FastifyInstance, assetsDir: string): void => {
  app.get("/assets/*", async (request, reply) => {
    const { "*": rest } = request.params as { "*": string };
    const fileName = parseAssetFileName(`/assets/${rest}`);
    if (!fileName) return reply.code(400).send({ error: "path must be /assets/<moduleId>.glb" });
    try {
      const { bytes, contentType } = await readAssetFile(assetsDir, fileName);
      return reply.header("Content-Type", contentType).header("Content-Length", bytes.length).send(Buffer.from(bytes));
    } catch (err) {
      return reply.code(404).send({ error: (err as Error).message });
    }
  });
};
