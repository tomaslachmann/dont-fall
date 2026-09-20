import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TRACK_THUMBNAIL_DATA_URL_PREFIX } from "@dont-fall/shared";

/**
 * Headless draft rendering (ADR 0114, D10): the thumbnail pipeline's
 * machinery (`apps/track-builder/scripts/render-thumbnails.ts`) as a
 * single-shot function — headless Chrome over raw CDP opens the builder's
 * `thumbnail.html?draft=…`, waits for its capture, and hands back the same
 * 1280×720 JPEG data URL a builder save stores. One Chrome per call: a
 * screenshot an hour apart must never share a browser.
 */

export interface ChromeRenderConfig {
  /** `thumbnail.html` without query — served by the builder's dev server (`pnpm --filter @dont-fall/track-builder dev`). */
  pageUrl: string;
  /** The API the page fetches the draft from — the same base this server's tools use. */
  apiUrl: string;
  chromePath: string;
  timeoutMs: number;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface Cdp {
  send: (method: string, params?: Record<string, unknown>, sessionId?: string) => Promise<any>;
  evaluate: (sessionId: string, expression: string) => Promise<unknown>;
  close: () => void;
}

const connectBrowser = async (socketUrl: string): Promise<Cdp> => {
  const socket = new WebSocket(socketUrl);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("could not reach Chrome's DevTools socket")), { once: true });
  });
  let nextId = 0;
  const pending = new Map<number, { resolve: (value: any) => void; reject: (err: Error) => void }>();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message: string } };
    if (message.id === undefined) return;
    const waiter = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) waiter?.reject(new Error(message.error.message));
    else waiter?.resolve(message.result);
  });
  const send = (method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<any> =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId === undefined ? {} : { sessionId }) }));
    });
  return {
    send,
    evaluate: async (sessionId, expression) => {
      const outcome = (await send("Runtime.evaluate", { expression, returnByValue: true }, sessionId)) as {
        result?: { value?: unknown };
        exceptionDetails?: { text: string };
      };
      if (outcome.exceptionDetails) throw new Error(outcome.exceptionDetails.text);
      return outcome.result?.value;
    },
    close: () => socket.close(),
  };
};

const browserSocketUrl = async (
  profile: string,
  chromePath: string,
  timeoutMs: number,
  spawnFailed: () => Error | null,
): Promise<string> => {
  const portFile = join(profile, "DevToolsActivePort");
  const started = Date.now();
  for (;;) {
    // A missing binary must fail the call, not crash the server (an unhandled
    // child 'error' would) and not burn the whole timeout waiting for a port.
    const failed = spawnFailed();
    if (failed) throw new Error(`Chrome did not start (${chromePath}): ${failed.message}`);
    if (existsSync(portFile)) {
      const [port, path] = readFileSync(portFile, "utf8").trim().split("\n");
      if (port && path) return `ws://127.0.0.1:${port}${path}`;
    }
    if (Date.now() - started > timeoutMs) throw new Error(`Chrome never opened its DevTools port (${chromePath})`);
    await sleep(100);
  }
};

/**
 * Renders one draft to its JPEG data URL. Throws naming the leg that failed
 * (Chrome missing, page unreachable, draft unfetchable, capture empty) — the
 * tool surfaces it as a tool error the LLM can act on.
 */
export const captureDraftScreenshot = async (draftId: string, config: ChromeRenderConfig): Promise<string> => {
  const profile = mkdtempSync(join(tmpdir(), "dont-fall-draft-shot-"));
  let chrome: ChildProcess | null = null;
  let cdp: Cdp | null = null;
  try {
    chrome = spawn(
      config.chromePath,
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
    let failed: Error | null = null;
    chrome.on("error", (err) => {
      failed = err;
    });
    cdp = await connectBrowser(await browserSocketUrl(profile, config.chromePath, config.timeoutMs, () => failed));
    const { targetId } = (await cdp.send("Target.createTarget", { url: "about:blank" })) as { targetId: string };
    try {
      const { sessionId } = (await cdp.send("Target.attachToTarget", { targetId, flatten: true })) as {
        sessionId: string;
      };
      await cdp.send("Runtime.enable", {}, sessionId);
      await cdp.send(
        "Emulation.setDeviceMetricsOverride",
        { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false },
        sessionId,
      );
      const url = `${config.pageUrl}?draft=${encodeURIComponent(draftId)}&api=${encodeURIComponent(config.apiUrl)}`;
      await cdp.send("Page.navigate", { url }, sessionId);
      const started = Date.now();
      for (;;) {
        await sleep(250);
        const state = (await cdp.evaluate(
          sessionId,
          "window.dontFallThumbnail ? JSON.parse(JSON.stringify(window.dontFallThumbnail)) : null",
        )) as { ready: boolean; error?: string } | null;
        if (state?.error) throw new Error(`thumbnail page: ${state.error}`);
        if (state?.ready) break;
        if (Date.now() - started > config.timeoutMs) throw new Error(`thumbnail page never finished drawing ${url}`);
      }
      const dataUrl = (await cdp.evaluate(sessionId, "window.dontFallThumbnail.capture()")) as unknown;
      if (typeof dataUrl !== "string" || !dataUrl.startsWith(TRACK_THUMBNAIL_DATA_URL_PREFIX)) {
        throw new Error("the canvas gave no JPEG back");
      }
      return dataUrl;
    } finally {
      await cdp.send("Target.closeTarget", { targetId }).catch(() => undefined);
    }
  } finally {
    cdp?.close();
    chrome?.kill();
    rmSync(profile, { recursive: true, force: true });
  }
};

/** `createChromeRenderer`'s knobs, all with production defaults in `../tools/screenshot.ts`. */
export const createChromeRenderer = (config: ChromeRenderConfig): ((draftId: string) => Promise<string>) => {
  return (draftId) => captureDraftScreenshot(draftId, config);
};
