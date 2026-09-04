import type { HTMLAttributes, ReactNode } from "react";
import { useExtrusion } from "../../hooks/useExtrusion";

export interface ExtrudedTextProps extends Omit<HTMLAttributes<HTMLSpanElement>, "color"> {
  children: ReactNode;
  /** Front-face text color. */
  color: string;
  /** A darker shade of the SAME hue as `color` — not a neutral. */
  depthColor: string;
}

/**
 * The chunky "game logo" text treatment — wordmark, the Results
 * QUALIFIED/ELIMINATED banner, the Countdown numeral. Renders a plain
 * `<span>`; size/weight/layout are the caller's concern (each of those
 * three usages sizes this completely differently), only the extrusion
 * effect itself is shared. See useExtrusion for the technique.
 */
export function ExtrudedText({ children, color, depthColor, style, ...rest }: ExtrudedTextProps) {
  const ref = useExtrusion<HTMLSpanElement>(depthColor);
  return (
    <span ref={ref} style={{ ...style, color }} {...rest}>
      {children}
    </span>
  );
}
