import { useCallback, useState } from "react";

/**
 * Throws an async failure into the nearest `ErrorBoundary`. React boundaries
 * only catch render-time throws — a rejection in an event handler, a
 * timeout, or a `.catch()` never reaches them on its own. Route those
 * through the returned function instead of growing a local error state:
 *
 * ```tsx
 * const throwAsync = useAsyncError();
 * const onSave = () => save().catch(throwAsync); // -> boundary, not a banner
 * ```
 *
 * Failures already held as render state need no helper — `throw` them
 * directly during render. Mark connectivity failures with
 * `ConnectionError` so the boundary shows the connection screen rather
 * than the crash one.
 */
export const useAsyncError = (): ((error: unknown) => void) => {
  const [, setError] = useState<unknown>(null);
  return useCallback((error: unknown) => {
    // Throwing inside the updater runs on the next render, which is exactly
    // where a boundary can catch it. The state itself is never read.
    setError(() => {
      throw error instanceof Error ? error : new Error(String(error));
    });
  }, []);
};
