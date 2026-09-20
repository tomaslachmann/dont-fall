import { STATUS_CODES, type IncomingMessage } from "node:http";
import { connect } from "node:net";
import type { Duplex } from "node:stream";
import { Worker } from "node:worker_threads";
import { VOICE_SOCKET_PATH } from "@dont-fall/shared";
import type { VoiceHostMessage, VoiceWorkerMessage } from "./voiceMessages.js";

/**
 * The voice relay's main-thread half (ADR 0111): it starts the worker,
 * feeds it what only this thread knows — who is seated in which Lobby, whose
 * Party is whose, who has Muted whom, and whether a session token is real —
 * and, where there is no nginx in front, hands it the upgrade.
 *
 * Nothing here ever sees a voice frame. That is the point: the frames live
 * on the worker's own port and never touch the loop every Lobby Ticks on
 * (ADR 0054/0109).
 */

/** The slice of a `worker_threads` `Worker` this service uses — what a test's fake stands in for. */
export interface VoiceWorkerLike {
  postMessage: (message: VoiceHostMessage) => void;
  on: (event: "message" | "error" | "exit", listener: (payload: never) => void) => void;
  terminate: () => Promise<number> | void;
}

export interface VoiceDeps {
  /** The Account a session token signs in as — `undefined` for an unknown or expired one. */
  authenticate: (token: string) => string | undefined;
  /** Whom this Account has Muted (ADR 0111) — read once per socket, and pushed again on every change. */
  mutesOf: (accountId: string) => string[];
  /** The Party this Account is in (ADR 0112), or `null` — what the PARTY scope links by. */
  partyOf: (accountId: string) => string | null;
  /** The relay's port. `0` asks the OS for one, which is what a test wants. */
  port?: number;
  /** Test seam: builds the worker. Production spawns the real `voiceRelay` thread. */
  spawn?: () => VoiceWorkerLike;
}

/**
 * The relay's entry point — plain JavaScript, because a worker thread starts
 * with none of this thread's module hooks. See `voiceWorker.mjs`.
 */
const relayEntry = (): URL => new URL("./voiceWorker.mjs", import.meta.url);

export class VoiceService {
  private worker: VoiceWorkerLike | null = null;
  private port = 0;
  /** Every roster said before the worker was listening — replayed once it is, so nothing is lost to the boot race. */
  private readonly backlog: VoiceHostMessage[] = [];
  private closed = false;

  constructor(private readonly deps: VoiceDeps) {}

  /**
   * Starts the relay and resolves with the port it bound. A relay that will
   * not start is reported and then let be: voice chat is unavailable, and
   * nothing else about the API is.
   */
  async start(): Promise<number> {
    if (this.worker !== null || this.closed) return this.port;
    const worker = this.deps.spawn?.() ?? spawnRelay(this.deps.port ?? 0);
    this.worker = worker;
    worker.on("error", ((err: Error) => console.error("voice relay failed:", err)) as (payload: never) => void);
    return new Promise<number>((resolve) => {
      let settled = false;
      worker.on("message", ((message: VoiceWorkerMessage) => {
        if (message.type === "listening") {
          this.port = message.port;
          for (const held of this.backlog.splice(0)) worker.postMessage(held);
          if (!settled) {
            settled = true;
            resolve(message.port);
          }
          return;
        }
        // The one thing the worker cannot answer itself: the database is here.
        const accountId = this.deps.authenticate(message.token) ?? null;
        worker.postMessage({
          type: "authResult",
          requestId: message.requestId,
          accountId,
          partyId: accountId === null ? null : this.deps.partyOf(accountId),
          muted: accountId === null ? [] : this.deps.mutesOf(accountId),
        });
      }) as (payload: never) => void);
      worker.on("exit", (() => {
        this.worker = null;
        if (!settled) {
          settled = true;
          resolve(0);
        }
      }) as (payload: never) => void);
    });
  }

  /** Who is seated in the Lobby on this port, as its own Match server says — never as a client claims. */
  setRoster(lobbyPort: number, accountIds: readonly string[]): void {
    this.send({ type: "roster", roomId: String(lobbyPort), accountIds: [...accountIds] });
  }

  /** That Lobby's Match server is gone. Its voice room stays with the members it had, through the podium. */
  endRoom(lobbyPort: number): void {
    this.send({ type: "roomEnded", roomId: String(lobbyPort) });
  }

  setParty(accountId: string, partyId: string | null): void {
    this.send({ type: "party", accountId, partyId });
  }

  setMutes(accountId: string, muted: readonly string[]): void {
    this.send({ type: "mutes", accountId, muted: [...muted] });
  }

  /** Whether an upgrade's URL is the voice socket's — the API's one `upgrade` handler routes on it. */
  static isVoicePath(url: string | undefined): boolean {
    try {
      return new URL(url ?? "", "http://api").pathname === VOICE_SOCKET_PATH;
    } catch {
      return false;
    }
  }

  /**
   * Carries one voice socket to the worker's port, the way a Lobby socket is
   * carried to its Match server (ADR 0107). Only for a stack without nginx:
   * online, nginx routes `/api/voice` to the worker directly and these bytes
   * never reach this thread at all.
   */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    if (this.port === 0) {
      refuse(socket, 503);
      return;
    }
    const upstream = connect(this.port, "127.0.0.1", () => {
      const lines = [`${req.method ?? "GET"} ${VOICE_SOCKET_PATH} HTTP/${req.httpVersion}`];
      for (let i = 0; i + 1 < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (head.length > 0) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    const closeBoth = (): void => {
      upstream.destroy();
      socket.destroy();
    };
    upstream.on("error", () => (upstream.connecting ? refuse(socket, 502) : closeBoth()));
    socket.on("error", closeBoth);
    upstream.on("close", () => socket.destroy());
    socket.on("close", () => upstream.destroy());
  }

  async close(): Promise<void> {
    this.closed = true;
    const worker = this.worker;
    this.worker = null;
    this.backlog.length = 0;
    if (worker) await worker.terminate();
  }

  private send(message: VoiceHostMessage): void {
    if (this.closed) return;
    if (this.worker === null || this.port === 0) {
      this.backlog.push(message);
      return;
    }
    this.worker.postMessage(message);
  }
}

const spawnRelay = (port: number): VoiceWorkerLike =>
  new Worker(relayEntry(), { workerData: { port } }) as unknown as VoiceWorkerLike;

const refuse = (socket: Duplex, status: number): void => {
  if (socket.destroyed) return;
  socket.end(`HTTP/1.1 ${status} ${STATUS_CODES[status]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
};
