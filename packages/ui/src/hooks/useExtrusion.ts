import { useLayoutEffect, useRef } from "react";

/**
 * Builds a real connected text extrusion: many same-color text-shadow steps
 * at sub-pixel increments so they visually overlap into one continuous
 * "side" face connecting the front glyph to a grounding shadow, instead of
 * a single offset shadow (which reads as a detached drop-shadow, not depth
 * — there's a visible gap along the diagonal between the front face and the
 * copy). See docs/research/design-system.md §1.6a / §2 for the reasoning:
 * this is the same technique used for the wordmark, the Results
 * QUALIFIED/ELIMINATED banner, and the Countdown numeral.
 *
 * depthColor should be a darker shade of the SAME hue as the element's own
 * text color, not a neutral — a lit 3D object's shaded side is a darker
 * version of its own color. Recomputed on resize since callers typically
 * size this text with a clamp(), and the extrusion's own reach must track
 * the rendered font-size, not a fixed px.
 */
export function useExtrusion<T extends HTMLElement>(depthColor: string, steps = 32) {
  const ref = useRef<T | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    const build = () => {
      const fontSizePx = parseFloat(getComputedStyle(el).fontSize);
      const depthX = fontSizePx * 0.05;
      const depthY = fontSizePx * 0.065;
      const layers: string[] = [];
      for (let i = 1; i <= steps; i += 1) {
        const t = i / steps;
        layers.push(`${(depthX * t).toFixed(2)}px ${(depthY * t).toFixed(2)}px 0 ${depthColor}`);
      }
      // Grounding shadow, same contact-shadow construction as the rest of
      // this system's elevation tokens — placed just past the last solid
      // extrusion step.
      layers.push(
        `${(depthX * 2.1).toFixed(2)}px ${(depthY * 2.3).toFixed(2)}px ${(fontSizePx * 0.09).toFixed(2)}px rgba(0, 0, 0, 0.5)`,
      );
      el.style.textShadow = layers.join(", ");
    };

    build();
    window.addEventListener("resize", build);
    return () => window.removeEventListener("resize", build);
  }, [depthColor, steps]);

  return ref;
}
