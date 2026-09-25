import { Worker } from "node:worker_threads";
import { botStillWorldOf, packBotStillWorld, type PackedBotStillWorld, type ResolvedTrack, type TrackNavData } from "@dont-fall/shared";

/**
 * Where a Match gets its Bots' navmesh from (M17 ticket 05, ADR 0129):
 * asynchronously, because building it and proving its links costs 0.2–1.1 s
 * the first time a process sees a Track (and ~0.2 s after, from the cache),
 * and every Lobby in the API's process Ticks on the same loop (ADR 0054).
 */
export type BotTrackBuilder = (resolved: ResolvedTrack) => Promise<TrackNavData>;

export interface BotTrackRequest {
  id: number;
  world: PackedBotStillWorld;
}

export type BotTrackReply = { id: number; data: TrackNavData; error?: undefined } | { id: number; error: string; data?: undefined };

const workerEntry = (): URL => new URL("./botTrackWorker.mjs", import.meta.url);

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, { resolve: (data: TrackNavData) => void; reject: (error: Error) => void }>();

/** Every waiting build fails, and the next one starts a fresh worker. */
const lose = (error: Error): void => {
  worker = null;
  for (const job of pending.values()) job.reject(error);
  pending.clear();
};

const workerOf = (): Worker => {
  if (worker !== null) return worker;
  const started = new Worker(workerEntry());
  started.on("message", (reply: BotTrackReply) => {
    const job = pending.get(reply.id);
    if (job === undefined) return;
    pending.delete(reply.id);
    if (reply.error !== undefined) job.reject(new Error(reply.error));
    else job.resolve(reply.data);
    // Nothing to wait for: the worker must not keep the process alive.
    if (pending.size === 0) started.unref();
  });
  started.on("error", (error) => {
    if (worker === started) lose(error);
  });
  started.on("exit", (code) => {
    if (worker === started) lose(new Error(`Bot track worker exited (${code})`));
  });
  worker = started;
  return started;
};

/**
 * The process's one Bot track worker, shared by every Match in it and
 * started on first use. Builds queue in it in order.
 */
export const workerBotTrackBuilder: BotTrackBuilder = (resolved) =>
  new Promise((resolve, reject) => {
    const id = (nextId += 1);
    pending.set(id, { resolve, reject });
    const target = workerOf();
    target.ref();
    // Only the still world, packed and transferred: cloning the whole resolved
    // Track cost the loop 12–38 ms, about a Tick.
    const { world, transfer } = packBotStillWorld(botStillWorldOf(resolved));
    target.postMessage({ id, world } satisfies BotTrackRequest, transfer);
  });

/** Stops the worker (the process closing, or a suite's end). Waiting builds fail. */
export const closeBotTrackWorker = async (): Promise<void> => {
  const current = worker;
  if (current === null) return;
  lose(new Error("Bot track worker closed"));
  await current.terminate();
};
