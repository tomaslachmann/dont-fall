import { useEffect, useRef } from "react";
import css from "../MotionPanel/MotionPanel.module.css";
import { InspectorSection } from "../InspectorSection/InspectorSection";
import type { BuilderEngine } from "../../engine.js";
import { useEngineVersion } from "../../hooks/useEngine.js";
import { motionKindsOf } from "../../motion/motionSummary.js";

/**
 * The Motion editor's React mount: the panel itself stays an imperative
 * island (dozens of mutually-writing fields, canvas strips, scrub) exactly
 * like the 3D viewport — React owns the card it lives in, never its inputs.
 * The card is one inspector section, so folding Motion away leaves the
 * imperative panel attached and only hides it.
 */
export function MotionPanelView({ engine }: { engine: BuilderEngine }) {
  useEngineVersion(engine);
  const ref = useRef<HTMLDivElement | null>(null);
  const primary = engine.primary;
  const segment = primary !== undefined ? engine.track[primary] : undefined;

  useEffect(() => {
    if (!ref.current) return;
    ref.current.replaceChildren();
    engine.attachMotionPanel(ref.current);
    return () => engine.detachMotionPanel();
  }, [engine]);

  // The whole Segment's Motion and each Part's own (ADR 0124), every kind once.
  const kinds = [
    ...new Set([segment?.motion, ...Object.values(segment?.partMotions ?? {})].flatMap((motion) => motionKindsOf(motion))),
  ];

  return (
    <InspectorSection id="motion" title="MOTION" defaultOpen
      summary={kinds.length === 0 ? undefined : kinds.map((kind) => kind.toUpperCase()).join(" · ")}>
      <div ref={ref} className={css.root} />
    </InspectorSection>
  );
}
