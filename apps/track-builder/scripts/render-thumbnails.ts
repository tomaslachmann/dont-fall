/**
 * Renders each code-authored Track's Thumbnail (ADR 0105) to `assets/<file>`,
 * the way the base race carries `assets/base_race.jpg`. `pnpm publish:tracks`
 * then sends it with the Track.
 *
 * It serves the Track builder's dev-only `thumbnail.html` (Vite, with the
 * repo's `assets/` beside it), opens it in headless Chrome over the DevTools
 * protocol once per Track, and saves the page's own capture: the same 1280×720
 * JPEG a builder save stores. The framing is `THUMBNAIL_FRAMES` in
 * `apps/track-builder/src/thumbnail/frames.ts`. Look at every render before
 * keeping it.
 *
 * Usage:  pnpm render:thumbnails
 *         pnpm render:thumbnails --only spin-cycle
 *         pnpm render:thumbnails --chrome "/path/to/chrome"
 */
import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { AUTHORED_TRACKS, TRACK_THUMBNAIL_DATA_URL_PREFIX } from "../../../packages/shared/src/index.js";

// Here rather than in the root `scripts/`: `vite` resolves from the builder, not the repo root.
const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const assetsDir = join(repo, "assets");

const argValue = (name: string): string | undefined => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
};
const only = argValue("only");
const chromePath = argValue("chrome") ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const wanted = only === undefined ? AUTHORED_TRACKS : AUTHORED_TRACKS.filter((authored) => authored.id === only);
if (wanted.length === 0) {
  console.error(`no authored Track with id "${only}" — have ${AUTHORED_TRACKS.map((a) => a.id).join(", ")}`);
  process.exit(1);
}

const CONTENT_TYPES: Record<string, string> = { ".glb": "model/gltf-binary", ".jpg": "image/jpeg", ".png": "image/png" };

// ---- the page: the builder's Vite dev server, with the repo's assets at /__assets ----
const vite = await createServer({
  root: join(repo, "apps/track-builder"),
  configFile: join(repo, "apps/track-builder/vite.config.ts"),
  logLevel: "warn",
  server: { port: 5199, strictPort: false },
  plugins: [
    {
      name: "dont-fall-thumbnail-assets",
      configureServer(server) {
        server.middlewares.use("/__assets", (req, res) => {
          const file = normalize(join(assetsDir, decodeURIComponent((req.url ?? "/").split("?")[0]!)));
          if (!file.startsWith(assetsDir) || !existsSync(file) || !statSync(file).isFile()) {
            res.statusCode = 404;
            res.end();
            return;
          }
          res.setHeader("Content-Type", CONTENT_TYPES[extname(file)] ?? "application/octet-stream");
          createReadStream(file).pipe(res);
        });
      },
    },
  ],
});
await vite.listen();
const origin = vite.resolvedUrls!.local[0]!.replace(/\/$/, "");

// ---- the browser: headless Chrome, driven over a plain WebSocket ----
const profile = mkdtempSync(join(tmpdir(), "dont-fall-thumbnails-"));
const chrome = spawn(
  chromePath,
  [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--window-size=1280,720",
    "about:blank",
  ],
  { stdio: "ignore" },
);

const cleanUp = async (): Promise<void> => {
  chrome.kill();
  await vite.close();
  rmSync(profile, { recursive: true, force: true });
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const browserSocketUrl = async (): Promise<string> => {
  const portFile = join(profile, "DevToolsActivePort");
  for (let waited = 0; waited < 15_000; waited += 100) {
    if (existsSync(portFile)) {
      const [port, path] = readFileSync(portFile, "utf8").trim().split("\n");
      if (port && path) return `ws://127.0.0.1:${port}${path}`;
    }
    await sleep(100);
  }
  throw new Error(`Chrome never opened its DevTools port (${chromePath})`);
};

const socket = new WebSocket(await browserSocketUrl());
await new Promise<void>((resolve, reject) => {
  socket.addEventListener("open", () => resolve(), { once: true });
  socket.addEventListener("error", () => reject(new Error("could not reach Chrome's DevTools socket")), { once: true });
});

let nextId = 0;
const pending = new Map<number, { resolve: (value: any) => void; reject: (err: Error) => void }>();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  if (message.id !== undefined) {
    const waiter = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) waiter?.reject(new Error(message.error.message));
    else waiter?.resolve(message.result);
    return;
  }
  // The page's own complaints, so a broken render says why.
  if (message.method === "Runtime.exceptionThrown") {
    console.error("  page:", message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
  }
  if (message.method === "Runtime.consoleAPICalled" && (message.params.type === "error" || message.params.type === "warning")) {
    console.error("  page:", message.params.args.map((arg: { value?: unknown; description?: string }) => arg.value ?? arg.description).join(" "));
  }
});
const send = (method: string, params: object = {}, sessionId?: string): Promise<any> =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

const evaluate = async (sessionId: string, expression: string): Promise<unknown> => {
  const { result, exceptionDetails } = await send("Runtime.evaluate", { expression, returnByValue: true }, sessionId);
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result.value;
};

let failed = 0;
try {
  for (const authored of wanted) {
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    await send("Runtime.enable", {}, sessionId);
    await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false }, sessionId);
    const url = `${origin}/thumbnail.html?track=${encodeURIComponent(authored.id)}&assets=${encodeURIComponent(`${origin}/__assets`)}`;
    await send("Page.navigate", { url }, sessionId);

    let state: { ready: boolean; error?: string } | null = null;
    for (let waited = 0; waited < 180_000 && !state?.ready && !state?.error; waited += 250) {
      await sleep(250);
      state = (await evaluate(sessionId, "window.dontFallThumbnail ? JSON.parse(JSON.stringify(window.dontFallThumbnail)) : null")) as typeof state;
    }
    if (!state?.ready) {
      console.error(`${authored.id}: ${state?.error ?? "the page never finished drawing"}`);
      failed += 1;
      await send("Target.closeTarget", { targetId });
      continue;
    }
    const dataUrl = (await evaluate(sessionId, "window.dontFallThumbnail.capture()")) as string | undefined;
    await send("Target.closeTarget", { targetId });
    if (typeof dataUrl !== "string" || !dataUrl.startsWith(TRACK_THUMBNAIL_DATA_URL_PREFIX)) {
      console.error(`${authored.id}: the canvas gave no JPEG back`);
      failed += 1;
      continue;
    }
    const bytes = Buffer.from(dataUrl.slice(TRACK_THUMBNAIL_DATA_URL_PREFIX.length), "base64");
    writeFileSync(join(assetsDir, authored.thumbnailFile), bytes);
    console.log(`rendered "${authored.name}" → assets/${authored.thumbnailFile} (${Math.round(bytes.length / 1024)} KB)`);
  }
} finally {
  socket.close();
  await cleanUp();
}
if (failed > 0) process.exit(1);
