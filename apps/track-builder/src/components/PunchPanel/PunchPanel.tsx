import { punchSeconds, punchCycleOf } from "@dont-fall/shared";
import css from "./PunchPanel.module.css";
import { InspectorSection } from "../InspectorSection/InspectorSection";
import { Kicker } from "../Kicker/Kicker";
import { Stepper } from "../Stepper/Stepper";
import { UndoIcon } from "../icons/Icons";
import type { BuilderEngine } from "../../engine.js";
import { useEngineVersion } from "../../hooks/useEngine.js";

/** Four phases round a cycle — a row of gloves punching one after another, one click each. */
const PHASES = [0, 0.25, 0.5, 0.75] as const;

/**
 * When this glove swings (CONTEXT.md: Punching Glove, ADR 0121) — shown only
 * on a Segment whose Asset is one, because a punch is a shape, never a switch.
 *
 * How it swings is keyframed in the Asset and is not here. What an author sets
 * is how often, how far ahead of its neighbours, and how much faster than
 * authored it goes — which is what decides whether it knocks a Character down
 * or only shoves, through the rule every Moving Segment goes through.
 */
export function PunchPanel({ engine }: { engine: BuilderEngine }) {
  useEngineVersion(engine);
  const primary = engine.primary;
  const segment = primary !== undefined ? engine.track[primary] : undefined;
  const authored = segment ? engine.library[segment.moduleId]?.punch : undefined;
  if (!segment || !authored) return null;

  const cycle = punchCycleOf(authored, segment.punch);
  const own = segment.punch !== undefined;
  const swing = punchSeconds(cycle);
  const set = (next: { period?: number; phase?: number; rate?: number }) =>
    engine.setSegmentPunch({ period: cycle.period, phase: cycle.phase ?? 0, rate: cycle.rate, ...next });

  return (
    <InspectorSection id="punch" title="PUNCH" defaultOpen summary={`every ${cycle.period.toFixed(1)} s`}>
      <div className={css.root}>
        <div className={css.row}>
          <Kicker>EVERY · at least {swing.toFixed(1)} s</Kicker>
          {own && (
            <button type="button" className={css.reset} title={`back to this Asset's own ${authored.period} s`}
              aria-label="reset punch timing" onClick={() => engine.setSegmentPunch(undefined)}>
              <UndoIcon size={12} />
            </button>
          )}
        </div>
        <Stepper value={cycle.period.toFixed(1)} onStep={(delta, fine) => engine.stepPunch("period", delta, fine)}
          onCommit={(committed) => set({ period: committed })} />

        <Kicker>SPEED · × the authored swing</Kicker>
        <Stepper value={cycle.rate.toFixed(1)} onStep={(delta, fine) => engine.stepPunch("rate", delta, fine)}
          onCommit={(committed) => set({ rate: committed })} />

        <Kicker>HEAD START</Kicker>
        <div className={css.presets}>
          {PHASES.map((preset) => (
            <button key={preset} type="button" title={`${(preset * cycle.period).toFixed(1)} s into the cycle`}
              className={[css.preset, Math.abs(preset - (cycle.phase ?? 0)) < 0.125 ? css.presetOn : ""].join(" ")}
              onClick={() => set({ phase: preset })}>
              {preset === 0 ? "NONE" : `${Math.round(preset * 100)}%`}
            </button>
          ))}
        </div>

        <p className={css.hint}>
          The fist is out for {swing.toFixed(1)} s and there is no glove at all in between · at {cycle.rate.toFixed(1)}× it
          {cycle.rate >= 2.5 ? " knocks a Character down" : " only shoves"}
          {own ? "" : " · this Asset's own default"}.
        </p>
      </div>
    </InspectorSection>
  );
}
