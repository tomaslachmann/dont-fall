import { useEffect, useRef } from "react";
import css from "../MotionPanel/MotionPanel.module.css";
import type { BuilderEngine } from "../../engine.js";

/**
 * The Motion editor's React mount: the panel itself stays an imperative
 * island (dozens of mutually-writing fields, canvas strips, scrub) exactly
 * like the 3D viewport — React owns the card it lives in, never its inputs.
 */
export function MotionPanelView({ engine }: { engine: BuilderEngine }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.replaceChildren();
    engine.attachMotionPanel(ref.current);
    return () => engine.detachMotionPanel();
  }, [engine]);

  return <div ref={ref} className={css.root} />;
}
