import { useEffect, useState } from "react";

/**
 * Every motion primitive in this library (press/release, toggle-snap,
 * land-in, the extrusion's own idle Wobble) is expected to check this and
 * skip straight to its resting state — see docs/research/design-system.md
 * §1.7 for which motions exist, all of them gated on this same query.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : false,
  );

  useEffect(() => {
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
