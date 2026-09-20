import { useEffect, useState } from "react";

/**
 * The wall clock (ms epoch), re-read every `everyMs` while `active` — for a
 * label that counts on its own, like a Party invite's INVITED · 0:42 (ADR
 * 0112). Inactive, it sets no timer and keeps the last reading, so a Screen
 * with nothing counting pays nothing for it.
 */
export const useNow = (everyMs: number, active = true): number => {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs, active]);
  return now;
};
