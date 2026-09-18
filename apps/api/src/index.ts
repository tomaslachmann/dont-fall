import { fileURLToPath } from "node:url";
import { resolveConfig } from "./config.js";
import { startApi } from "./app.js";

// Programmatic surface (ADR 0058): the match-server suites boot the API over
// real HTTP; route tests use `buildApp` + `inject` and never touch the network.
export { buildApp, startApi, type ApiService } from "./app.js";
export { resolveConfig, type ApiConfig } from "./config.js";

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const config = resolveConfig();
  const service = await startApi(config);
  console.log(`DON'T FALL api listening on http://localhost:${service.port}`);

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    console.log(`DON'T FALL api: received ${signal}, shutting down...`);
    try {
      await service.close();
      console.log("DON'T FALL api: stopped");
      process.exit(0);
    } catch (err) {
      console.error("DON'T FALL api: shutdown failed", err);
      process.exit(1);
    }
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}
