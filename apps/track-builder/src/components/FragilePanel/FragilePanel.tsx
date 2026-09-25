import css from "./FragilePanel.module.css";
import { InspectorSection } from "../InspectorSection/InspectorSection";
import { Kicker } from "../Kicker/Kicker";
import { Stepper } from "../Stepper/Stepper";
import { UndoIcon } from "../icons/Icons";
import type { BuilderEngine } from "../../engine.js";
import { useEngineVersion } from "../../hooks/useEngine.js";

/**
 * How long this floor stays gone once it breaks (CONTEXT.md: Fragile, ADR
 * 0118) — shown only on a Segment whose Asset is one, because a floor that
 * breaks is a shape, never a switch.
 *
 * How many arrivals it takes is not here: it is one per authored look, and
 * the looks are in the GLB. `0` never brings it back, which eats a course
 * as it is played — an arena's choice, and a Race author's risk.
 */
export function FragilePanel({ engine }: { engine: BuilderEngine }) {
  useEngineVersion(engine);
  const primary = engine.primary;
  const segment = primary !== undefined ? engine.track[primary] : undefined;
  const def = segment ? engine.library[segment.moduleId]?.fragile : undefined;
  if (!segment || !def) return null;

  const seconds = segment.fragile?.returnSeconds ?? def.returnSeconds;
  const authored = segment.fragile !== undefined;

  return (
    <InspectorSection id="fragile" title="FRAGILE" defaultOpen summary={seconds > 0 ? `back in ${seconds} s` : "gone for good"}>
      <div className={css.root}>
        <div className={css.row}>
          <Kicker>BACK AFTER · 0 = never</Kicker>
          {authored && (
            <button type="button" className={css.reset} title={`back to this Asset's own ${def.returnSeconds} s`}
              aria-label="reset return delay" onClick={() => engine.setSegmentFragile(undefined)}>
              <UndoIcon size={12} />
            </button>
          )}
        </div>

        <Stepper value={seconds.toFixed(1)} onStep={(delta, fine) => engine.stepFragileReturn(delta, fine)}
          onCommit={(committed) => engine.setSegmentFragile(committed)} />

        <p className={css.hint}>
          {def.entries} arrivals break it — a landing and a walk-on count alike, standing still never does
          {seconds > 0 ? ` · back intact ${seconds} s later` : " · gone for the rest of the Round"}
          {authored ? "" : " · this Asset's own default"}.
        </p>
      </div>
    </InspectorSection>
  );
}
