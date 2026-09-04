import type { CSSProperties } from "react";

/**
 * §2.5's own entrance spec: list rows land staggered ~40ms per row, top to
 * bottom, rather than every row appearing simultaneously (which reads as a
 * static table snapping into place). Spread the result onto the row's own
 * `style` alongside the `landIn` class from `./landIn.module.css`.
 */
export function staggerDelay(index: number, stepMs = 40): CSSProperties {
  return { animationDelay: `${index * stepMs}ms` };
}
