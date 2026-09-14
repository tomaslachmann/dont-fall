/**
 * Marks an *expected* connectivity failure (a refused lobby welcome, a
 * dropped socket, the API unreachable) — the kind of failure a Player can
 * sensibly retry. The app-wide `ErrorBoundary` renders these as the
 * connection `ErrorScreen`, everything else as a crash. Throw one wherever
 * a connection dies; never invent a second per-component error UI for it.
 */
export class ConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectionError";
  }
}
