import { trapDoorCurveSeconds, type TrapDoorCycle } from "@dont-fall/shared";
import css from "./TrapDoorPanel.module.css";
import { InspectorSection } from "../InspectorSection/InspectorSection";
import { Kicker } from "../Kicker/Kicker";
import { Stepper } from "../Stepper/Stepper";
import { UndoIcon } from "../icons/Icons";
import type { BuilderEngine } from "../../engine.js";
import { useEngineVersion } from "../../hooks/useEngine.js";
import { TRAPDOOR_PHASE_STEP } from "../../track/trackEdit.js";

/** Four phases round a cycle — a row of doors that open one after another, in one click each. */
const PHASES = [0, 0.25, 0.5, 0.75] as const;

/**
 * How often this trap door runs (CONTEXT.md: Trap Door, ADR 0117) — shown
 * only on a Segment whose Asset has leaves, because a trap door is a shape,
 * never a switch.
 *
 * The shape of the swing is not here on purpose: it is keyframed in the GLB
 * and replayed sample for sample, so retuning how the leaves fall means
 * re-exporting the Asset. What an author sets is *when* it runs — the period,
 * and the phase that staggers a row of them.
 */
export function TrapDoorPanel({ engine }: { engine: BuilderEngine }) {
  useEngineVersion(engine);
  const primary = engine.primary;
  const segment = primary !== undefined ? engine.track[primary] : undefined;
  const cycle = segment ? trapDoorOf(engine, segment.moduleId) : undefined;
  if (!segment || !cycle) return null;

  const swing = trapDoorCurveSeconds(cycle);
  const period = segment.trapdoor?.period ?? cycle.period;
  const phase = segment.trapdoor?.phase ?? cycle.phase ?? 0;
  const authored = segment.trapdoor !== undefined;
  const shut = Math.max(0, period - swing);

  return (
    <InspectorSection id="trapdoor" title="TRAP DOOR" defaultOpen summary={`every ${period.toFixed(1)} s`}>
      <div className={css.root}>
        <div className={css.row}>
          <Kicker>EVERY · at least {swing.toFixed(1)} s</Kicker>
          {authored && (
            <button type="button" className={css.reset} title={`back to this Asset's own ${cycle.period} s`}
              aria-label="reset trap door timing" onClick={() => engine.setSegmentTrapDoor(undefined)}>
              <UndoIcon size={12} />
            </button>
          )}
        </div>

        <Stepper value={period.toFixed(1)} onStep={(delta, fine) => engine.stepTrapDoorPeriod(delta, fine)}
          onCommit={(committed) => engine.setSegmentTrapDoor({ period: committed, phase })} />

        <Kicker>HEAD START</Kicker>
        <div className={css.presets}>
          {PHASES.map((preset) => (
            <button key={preset} type="button" title={`${(preset * period).toFixed(1)} s into the cycle`}
              className={[css.preset, Math.abs(preset - phase) < TRAPDOOR_PHASE_STEP / 2 ? css.presetOn : ""].join(" ")}
              onClick={() => engine.setSegmentTrapDoor({ period, phase: preset })}>
              {preset === 0 ? "NONE" : `${Math.round(preset * 100)}%`}
            </button>
          ))}
        </div>

        <p className={css.hint}>
          Shut for {shut.toFixed(1)} s, then {swing.toFixed(1)} s of swing · the leaves hold nobody once they move
          {authored ? "" : " · this Asset's own default"}.
        </p>
      </div>
    </InspectorSection>
  );
}

/** The authored swing of the selected Module's leaves, if it has any. */
const trapDoorOf = (engine: BuilderEngine, moduleId: string): TrapDoorCycle | undefined =>
  engine.library[moduleId]?.parts?.find((part) => part.trapDoor !== undefined)?.trapDoor;
