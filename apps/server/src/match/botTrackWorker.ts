import { parentPort } from "node:worker_threads";
import { buildBotTrackData, initNavigation, initPhysics, unpackBotStillWorld } from "@dont-fall/shared";
import type { BotTrackReply, BotTrackRequest } from "./botTracks.js";

/**
 * Builds every Match's Bot navmesh off the loop they all Tick on (M17 ticket
 * 05, ADR 0129): Recast's build and the link proofs played in Rapier. One
 * request at a time, in order; the links a Track was proven with stay cached
 * here for the process's life (`provenNavLinks`), so a Track's second Round
 * costs only its navmesh.
 */
const port = parentPort!;
const ready = Promise.all([initNavigation(), initPhysics()]);

port.on("message", (request: BotTrackRequest) => {
  void ready.then(() => {
    let reply: BotTrackReply;
    try {
      reply = { id: request.id, data: buildBotTrackData(unpackBotStillWorld(request.world)) };
    } catch (error) {
      reply = { id: request.id, error: (error as Error).message };
    }
    port.postMessage(reply);
  });
});
