/**
 * The slice of `window` / `document` / an element / a WebSocket that the
 * client's event plumbing uses. Narrower than the real thing on purpose: it is
 * what lets a test drive these without a DOM, and what makes "did teardown
 * actually remove the listener?" an assertion rather than an assumption
 * (M4 ticket 01).
 */
export interface ListenerTarget {
  addEventListener: (type: string, listener: EventListener) => void;
  removeEventListener: (type: string, listener: EventListener) => void;
}

/**
 * Register `handler` on `target` and return the one function that removes it.
 *
 * The pairing is the point. Written out longhand, the `removeEventListener`
 * call is a separate site holding its own copy of the target, the type string
 * and the handler reference — three chances to drift from what was added, and
 * a drifted remove fails silently, leaving a listener alive for the rest of
 * the page session. Here they can't drift: there is one call site.
 */
export const listen = (target: ListenerTarget, type: string, handler: EventListener): (() => void) => {
  target.addEventListener(type, handler);
  return () => target.removeEventListener(type, handler);
};
