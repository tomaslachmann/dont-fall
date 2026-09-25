/**
 * The Bot track worker's entry point (M17 ticket 05, ADR 0129): plain
 * JavaScript that registers `tsx` and only then imports the worker, for the
 * reason `apps/api/src/voice/voiceWorker.mjs` gives. A `worker_thread` does
 * not inherit the parent's module hooks, so a worker started on a `.ts` file
 * fails on the first `./x.js` specifier this repo writes.
 */
import { register } from "tsx/esm/api";

register();
await import("./botTrackWorker.ts");
