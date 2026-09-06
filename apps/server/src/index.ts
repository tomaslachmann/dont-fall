import { fileURLToPath } from "node:url";
import { startServer } from "./matchServer.js";

/**
 * The Match server's entry point, and nothing else (M4.5 ticket 09).
 *
 * Everything this process does lives behind `startServer` in `matchServer.ts`;
 * this file only decides whether it was run or imported, and how it stops. The
 * guard matters because the test suite imports `startServer` directly — without
 * it, importing this module would boot a real server on the default port.
 */
const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const server = await startServer();
  console.log(`DON'T FALL server listening on ws://localhost:${server.port}`);

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    console.log(`DON'T FALL: received ${signal}, shutting down...`);
    try {
      await server.close();
      console.log("DON'T FALL: server stopped");
      process.exit(0);
    } catch (err) {
      console.error("DON'T FALL: shutdown failed", err);
      process.exit(1);
    }
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });

  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

export { startServer } from "./matchServer.js";
export type { MatchServer, StartServerConfig } from "./matchServer.js";
