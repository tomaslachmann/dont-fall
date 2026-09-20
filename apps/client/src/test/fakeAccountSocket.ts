import type { AccountServerMessage } from "@dont-fall/shared";
import { startAccountSocket, type AccountSocketLike } from "../lib/social/accountSocket.js";

/**
 * Test-only: an Account socket (ADR 0112) the test drives by hand — what the
 * page said on it, and what the API "pushes" back. Stands in for the browser's
 * `WebSocket` through `startAccountSocket`'s own seam, so the store under test
 * is the real one.
 */
export interface FakeAccountSocket extends AccountSocketLike {
  url: string;
  readyState: number;
  /** Every message the client sent, parsed. */
  sent: unknown[];
  closed: boolean;
  /** The browser opened it. */
  open: () => void;
  /** The API pushed this. */
  deliver: (message: AccountServerMessage) => void;
  /** The connection dropped, with the API's close code. */
  drop: (code?: number) => void;
}

export const fakeAccountSockets = () => {
  const sockets: FakeAccountSocket[] = [];
  const createSocket = (url: string): FakeAccountSocket => {
    const listeners = new Map<string, Set<EventListener>>();
    const dispatch = (type: string, event: Record<string, unknown> = {}): void => {
      for (const listener of [...(listeners.get(type) ?? [])]) listener({ type, ...event } as unknown as Event);
    };
    const socket: FakeAccountSocket = {
      url,
      sent: [],
      closed: false,
      readyState: 0,
      send: (data) => {
        socket.sent.push(JSON.parse(data));
      },
      close: () => {
        socket.closed = true;
      },
      addEventListener: (type, listener) => {
        const set = listeners.get(type) ?? new Set();
        set.add(listener);
        listeners.set(type, set);
      },
      removeEventListener: (type, listener) => {
        listeners.get(type)?.delete(listener);
      },
      open: () => {
        socket.readyState = 1;
        dispatch("open");
      },
      deliver: (message) => dispatch("message", { data: JSON.stringify(message) }),
      drop: (code = 1006) => {
        socket.readyState = 3;
        dispatch("close", { code });
      },
    };
    sockets.push(socket);
    return socket;
  };
  return { sockets, createSocket, latest: (): FakeAccountSocket => sockets.at(-1)! };
};

/**
 * Starts the real store on a fake socket and signs it in as `accountId` —
 * opened, `auth` sent, `ready` answered. `stop` is the sign-out.
 */
export const connectFakeAccountSocket = (accountId = "me") => {
  const fakes = fakeAccountSockets();
  const stop = startAccountSocket({ createSocket: fakes.createSocket, url: "ws://test/account", getToken: () => "tok-1" });
  const socket = fakes.latest();
  socket.open();
  socket.deliver({ type: "ready", accountId });
  return { ...fakes, socket, stop };
};
