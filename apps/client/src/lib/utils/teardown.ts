/**
 * A LIFO registry of disposers, so a bootstrap that acquires resources one
 * after another can release them all through a single call.
 *
 * The game owns a renderer, a WebGL context, a Rapier world, window/document
 * listeners, a WebSocket, an interval and an animation frame — and from M4 it
 * is mounted and unmounted repeatedly as React routes into and out of the Play
 * route (ADR 0008). "Start and stop twice leaves nothing behind" only holds if
 * every acquisition registers its own release *at the point it succeeds*,
 * which is what this is for: a `finally`-shaped list rather than one big
 * `stop()` that has to remember what did and didn't get built.
 *
 * Newest-first, because a resource is generally built from the one before it
 * (the speed-lines composer from the renderer, the stage from the model) and
 * must be gone before its foundation is.
 */
export interface Teardown {
  /**
   * Register a disposer. Runs newest-first on {@link Teardown.run}; runs
   * immediately if this Teardown has already run, so a resource that finished
   * arriving after teardown began (an in-flight `await`) still can't leak.
   */
  add: (dispose: () => void) => void;
  /**
   * Release everything, newest-first. Idempotent — every disposer runs exactly
   * once no matter how often this is called. A disposer that throws is
   * reported and skipped rather than stranding the ones behind it: teardown is
   * usually running because something already went wrong.
   */
  run: () => void;
  /** Whether {@link Teardown.run} has happened — lets a bootstrap abandon work mid-flight. */
  readonly done: boolean;
}

export const createTeardown = (): Teardown => {
  const disposers: (() => void)[] = [];
  let done = false;

  const dispose = (fn: () => void): void => {
    try {
      fn();
    } catch (err) {
      console.error("DON'T FALL: teardown step failed", err);
    }
  };

  return {
    add: (fn) => {
      if (done) dispose(fn);
      else disposers.push(fn);
    },
    run: () => {
      if (done) return;
      done = true;
      while (disposers.length > 0) dispose(disposers.pop()!);
    },
    get done() {
      return done;
    },
  };
};
