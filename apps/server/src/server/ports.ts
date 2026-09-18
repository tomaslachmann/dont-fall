import { DEFAULT_SERVER_PORT } from "@dont-fall/shared";
import type { Server } from "node:http";
import type { PortRange, StartServerConfig } from "./config.js";

/** Port binding, kept out of the bootstrap: one call in, the port actually bound out. */

const validPortRange = (range: PortRange): boolean =>
  Number.isInteger(range.min) &&
  Number.isInteger(range.max) &&
  range.min >= 1 &&
  range.max <= 65535 &&
  range.min <= range.max;

/** Throws before anything expensive (physics init, the Track fetch) rather than at bind time. */
export const assertValidPortRange = (range: PortRange | undefined): void => {
  if (range !== undefined && !validPortRange(range)) {
    throw new RangeError(`portRange must be { min, max } within 1..65535 with min <= max, got ${JSON.stringify(range)}`);
  }
};

/**
 * Listens on the first free port in `[min, max]`, skipping `EADDRINUSE`
 * collisions. Two near-simultaneous boots may both try the same candidate —
 * the loser just moves to the next one, so no cross-process lock is needed at
 * dev scale. Throws the last bind error when the whole range is taken.
 */
const listenFirstFree = async (server: Server, min: number, max: number): Promise<number> => {
  let lastError: unknown = new Error(`no free port in [${min}, ${max}]`);
  for (let port = min; port <= max; port++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const cleanup = (): void => {
          server.removeListener("listening", onListening);
          server.removeListener("error", onError);
        };
        const onListening = (): void => {
          cleanup();
          resolve();
        };
        const onError = (err: unknown): void => {
          cleanup();
          reject(err);
        };
        server.once("listening", onListening);
        server.once("error", onError);
        server.listen(port);
      });
      return port;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
};

/** Binds one fixed port, resolving to whatever the OS actually gave (`port: 0` asks it to choose). */
const listenOne = (server: Server, port: number): Promise<number> =>
  new Promise((resolve, reject) => {
    server.once("listening", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : port);
    });
    server.once("error", reject); // e.g. EADDRINUSE — reject instead of hanging forever
    server.listen(port);
  });

/** Binds per the config: a range scan when one is given, otherwise the single port. */
export const listen = async (server: Server, config: StartServerConfig): Promise<number> =>
  config.portRange !== undefined
    ? listenFirstFree(server, config.portRange.min, config.portRange.max)
    : listenOne(server, config.port ?? DEFAULT_SERVER_PORT);
