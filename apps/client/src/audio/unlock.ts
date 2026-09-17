/** What resuming needs from an `AudioContext`. */
export interface ResumableContext {
  readonly state: string;
  resume(): Promise<void>;
}

const GESTURES = ["pointerdown", "keydown", "click"] as const;

/**
 * Resumes `context` on the first user gesture on `target` (ADR 0087; Chrome's
 * autoplay policy starts a context created before one as `suspended`).
 * Nothing plays before then, and nothing queues up to burst out after. Returns
 * a cleanup that removes the listeners if no gesture ever came.
 */
export const resumeOnFirstGesture = (context: ResumableContext, target: EventTarget): (() => void) => {
  const remove = (): void => {
    for (const type of GESTURES) target.removeEventListener(type, onGesture, true);
  };
  const onGesture = (): void => {
    if (context.state === "running") {
      remove();
      return;
    }
    context.resume().then(remove, () => {
      // Refused (not a gesture the browser counts): keep listening for the next one.
    });
  };
  if (context.state !== "running") {
    for (const type of GESTURES) target.addEventListener(type, onGesture, true);
  }
  return remove;
};
