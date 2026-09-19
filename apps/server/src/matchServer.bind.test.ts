import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { startApi, type ApiService } from "@dont-fall/api";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { startTickScheduler } from "./match/tickScheduler.js";
import { startServer, type MatchServer } from "./matchServer.js";

// The real scheduler, counted: the only way to see whether `startServer`
// started a Match loop it then had no handle left to stop.
vi.mock("./match/tickScheduler.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./match/tickScheduler.js")>();
  return { ...actual, startTickScheduler: vi.fn(actual.startTickScheduler) };
});

// `startServer` fetches its boot Track from the API before it binds (ADR 0028).
let api: ApiService;

beforeAll(async () => {
  api = await startApi({ port: 0, dbPath: ":memory:" });
  process.env.TRACK_SERVICE_URL = `http://localhost:${api.port}`;
});

afterAll(async () => {
  await api.close();
  delete process.env.TRACK_SERVICE_URL;
});

afterEach(() => {
  vi.mocked(startTickScheduler).mockClear();
});

const takePort = (): Promise<Server> =>
  new Promise((resolve) => {
    const blocker = createServer();
    blocker.listen(0, () => resolve(blocker));
  });

describe("startServer — the Match loop starts only once the port is bound", () => {
  it("leaves no Match loop ticking when the bind fails", async () => {
    // Every Lobby is an in-process `startServer` inside the always-on API (ADR
    // 0054/0058), so a loop started before a failed bind — a used-up Docker
    // port range — kept a Rapier world ticking at 30 Hz for the life of the
    // process, with nothing holding the handle that could stop it.
    const blocker = await takePort();
    try {
      const { port } = blocker.address() as AddressInfo;
      await expect(startServer({ port, playersToStart: 1, countdownMs: 0 })).rejects.toThrow(/EADDRINUSE/);
      expect(startTickScheduler).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve, reject) => blocker.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it("starts exactly one once the bind succeeds", async () => {
    let server: MatchServer | undefined;
    try {
      server = await startServer({ port: 0, playersToStart: 1, countdownMs: 0 });
      expect(startTickScheduler).toHaveBeenCalledTimes(1);
    } finally {
      await server?.close();
    }
  });
});
