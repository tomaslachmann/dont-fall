/**
 * Bakes the authored BLIP ragdoll spec (`.scratch/physical-ragdoll`, ticket
 * 01) into `packages/shared/src/simulation/ragdoll/blipRagdollSpec.ts`.
 *
 * It serves this app's dev-only `bake-ragdoll.html` (Vite), opens it in
 * headless Chrome over the DevTools protocol, and saves what the page baked:
 * the hulls, the resolved joints, the rest-overlap pairs and the get-up
 * targets (see `src/bake/bakeRagdollPage.ts`). The same pattern as
 * `pnpm render:thumbnails`.
 *
 * Usage:  pnpm bake:ragdoll
 *         pnpm bake:ragdoll --chrome "/path/to/chrome"
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

// Here rather than in the root `scripts/`: `vite` resolves from the client.
const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const outFile = join(repo, "packages/shared/src/simulation/ragdoll/blipRagdollSpec.ts");

const argValue = (name: string): string | undefined => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
};
const chromePath = argValue("chrome") ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const vite = await createServer({
  root: join(repo, "apps/client"),
  configFile: join(repo, "apps/client/vite.config.ts"),
  logLevel: "warn",
  server: { port: 5198, strictPort: false },
});
await vite.listen();
const origin = vite.resolvedUrls!.local[0]!.replace(/\/$/, "");

const profile = mkdtempSync(join(tmpdir(), "dont-fall-ragdoll-bake-"));
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
  // The page's own complaints, so a broken bake says why.
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

try {
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Runtime.enable", {}, sessionId);
  await send("Page.navigate", { url: `${origin}/bake-ragdoll.html` }, sessionId);

  let state: { ready: boolean; error?: string; spec?: unknown } | null = null;
  for (let waited = 0; waited < 120_000 && !state?.ready && !state?.error; waited += 250) {
    await sleep(250);
    state = (await evaluate(
      sessionId,
      "window.dontFallRagdollBake ? JSON.parse(JSON.stringify(window.dontFallRagdollBake)) : null",
    )) as typeof state;
  }
  await send("Target.closeTarget", { targetId });
  if (!state?.ready || state.spec === undefined) {
    throw new Error(state?.error ?? "the page never finished baking");
  }

  const spec = state.spec as { bones: { bone: string; hull: unknown[] }[]; restTouching: [string, string][] };
  const header = [
    "// GENERATED by `pnpm bake:ragdoll` — do not edit by hand.",
    "// Inputs: apps/client/public/models/BLIP.glb + blip_with_coliders.glb;",
    "// the recipe lives in apps/client/src/bake/bakeRagdollPage.ts.",
    'import type { BlipRagdollSpec } from "./spec.js";',
    "",
    "export const BLIP_RAGDOLL_SPEC: BlipRagdollSpec = ",
  ].join("\n");
  writeFileSync(outFile, `${header}${JSON.stringify(state.spec)};\n`);
  console.log(
    `baked ${spec.bones.length} bones (${spec.bones.map((b) => b.hull.length).join("/")} hull points), ` +
      `${spec.restTouching.length} rest-touching pairs → ${outFile}`,
  );
} finally {
  socket.close();
  await cleanUp();
}
